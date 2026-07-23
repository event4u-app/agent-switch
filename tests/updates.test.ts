import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { parseVersion, compareVersions, isNewer, parseRelease, npmSearchPath } from "../src/updates.js";

test("parseVersion strips v-prefix and pre-release/build, pads missing with 0", () => {
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("1.2"), [1, 2]);
  assert.deepEqual(parseVersion("2.0.0-beta.1"), [2, 0, 0]);
  assert.deepEqual(parseVersion("garbage"), [0]);
});

test("compareVersions orders left-to-right, treats missing components as 0", () => {
  assert.equal(compareVersions("1.2.0", "1.2"), 0);
  assert.equal(compareVersions("1.2.1", "1.2.0"), 1);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
});

test("isNewer is strict-greater", () => {
  assert.equal(isNewer("1.0.1", "1.0.0"), true);
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", "1.0.1"), false);
  assert.equal(isNewer("v1.1.0", "1.0.9"), true);
});

test("parseRelease keeps a real release, rejects draft/prerelease/tagless", () => {
  const ok = parseRelease({ tag_name: "1.2.0", name: "1.2.0", html_url: "u", body: "notes", published_at: "t" });
  assert.equal(ok?.tag, "1.2.0");
  assert.equal(parseRelease({ tag_name: "1.2.0", draft: true }), null);
  assert.equal(parseRelease({ tag_name: "1.2.0", prerelease: true }), null);
  assert.equal(parseRelease({ name: "no tag" }), null);
  assert.equal(parseRelease(null), null);
});

test("parseRelease falls back name→tag and url→releases page", () => {
  const r = parseRelease({ tag_name: "1.2.0" });
  assert.equal(r?.name, "1.2.0");
  assert.match(r?.url ?? "", /\/releases$/);
});

test("npmSearchPath puts node's own bin dir first so a stripped GUI PATH still finds npm", () => {
  const p = npmSearchPath("/opt/homebrew/bin", "/usr/bin:/bin", "/Users/x");
  const parts = p.split(path.delimiter);
  assert.equal(parts[0], "/opt/homebrew/bin"); // node/npm co-located dir wins
  assert.ok(parts.includes("/usr/bin")); // inherited PATH preserved as fallback
  assert.ok(parts.includes("/Users/x/.npm-global/bin")); // common global-install fallback
  assert.ok(parts.includes("/usr/local/bin"));
});

test("npmSearchPath drops empty segments (e.g. an unset inherited PATH)", () => {
  const parts = npmSearchPath("/node/bin", "", "/home/y").split(path.delimiter);
  assert.ok(!parts.includes("")); // no empty segment → no accidental CWD-in-PATH
  assert.equal(parts[0], "/node/bin");
});
