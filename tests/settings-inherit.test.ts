import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { mergePermissions, withInheritedPermissions, inheritPermissions } from "../src/settings-inherit.js";

test("mergePermissions unions allow (dedup, global-first), profile scalar wins", () => {
  const merged = mergePermissions(
    { allow: ["Bash(git *)", "Bash(npm *)"], defaultMode: "auto" },
    { allow: ["Bash(npm *)", "Read(**)"], defaultMode: "acceptEdits" },
  );
  assert.deepEqual(merged?.allow, ["Bash(git *)", "Bash(npm *)", "Read(**)"]); // deduped, order preserved
  assert.equal(merged?.defaultMode, "acceptEdits"); // profile wins
});

test("mergePermissions keeps a profile-only grant and takes the global defaultMode when profile has none", () => {
  const merged = mergePermissions({ allow: ["Bash(git *)"], defaultMode: "auto" }, { allow: ["Bash(docker *)"] });
  assert.deepEqual(merged?.allow, ["Bash(git *)", "Bash(docker *)"]);
  assert.equal(merged?.defaultMode, "auto"); // inherited
});

test("mergePermissions returns null when the global carries no permissions", () => {
  assert.equal(mergePermissions(undefined, { allow: ["Read(**)"] }), null);
  assert.equal(mergePermissions({}, { allow: ["Read(**)"] }), null);
});

test("mergePermissions unions deny lists too", () => {
  const merged = mergePermissions({ deny: ["Bash(rm *)"] }, { deny: ["Bash(curl *)"] });
  assert.deepEqual(merged?.deny, ["Bash(rm *)", "Bash(curl *)"]);
});

test("withInheritedPermissions preserves other profile settings and returns input unchanged when nothing to inherit", () => {
  const profile = { theme: "dark", model: "opus" };
  const seeded = withInheritedPermissions(profile, { permissions: { allow: ["Bash(git *)"] } });
  assert.equal(seeded.theme, "dark");
  assert.equal(seeded.model, "opus");
  assert.deepEqual((seeded.permissions as any).allow, ["Bash(git *)"]);
  // no global permissions → unchanged (same reference is fine)
  assert.equal(withInheritedPermissions(profile, { theme: "x" }), profile);
});

function mkConfig(settings: object | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-inherit-"));
  if (settings) fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  return dir;
}

test("inheritPermissions seeds a bare profile, keeps its theme, and never writes the global", () => {
  const global = mkConfig({ permissions: { allow: ["Bash(git *)", "Bash(npm *)"], defaultMode: "auto" }, theme: "light" });
  const profile = mkConfig({ theme: "dark" });
  const globalBefore = fs.readFileSync(path.join(global, "settings.json"), "utf8");

  const r = inheritPermissions(profile, global);
  assert.equal(r.changed, true);
  assert.equal(r.addedAllow, 2);
  assert.equal(r.allowCount, 2);

  const written = JSON.parse(fs.readFileSync(path.join(profile, "settings.json"), "utf8"));
  assert.deepEqual(written.permissions.allow, ["Bash(git *)", "Bash(npm *)"]);
  assert.equal(written.theme, "dark"); // profile-own setting preserved (not the global's "light")
  assert.equal(fs.readFileSync(path.join(global, "settings.json"), "utf8"), globalBefore); // source untouched
});

test("inheritPermissions is idempotent — a second run reports no change", () => {
  const global = mkConfig({ permissions: { allow: ["Bash(git *)"] } });
  const profile = mkConfig({ theme: "dark" });
  assert.equal(inheritPermissions(profile, global).changed, true);
  assert.equal(inheritPermissions(profile, global).changed, false);
});

test("inheritPermissions is a no-op when the global has no permissions or is missing", () => {
  const profile = mkConfig({ theme: "dark" });
  assert.equal(inheritPermissions(profile, mkConfig({ theme: "x" })).changed, false); // global without perms
  assert.equal(inheritPermissions(profile, mkConfig(null)).changed, false); // no global settings.json
});
