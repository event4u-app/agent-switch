import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-launchers-"));
process.env.AGENT_SWITCH_HOME = HOME;
const L = await import("../src/launchers.js");
const { findApp } = await import("../src/apps.js");

const claude = findApp("claude-desktop")!;

test("a launcher lives in ~/Applications/Agent Switch, named after app and profile", () => {
  assert.equal(L.launcherPath(claude, "MatneX", "/Users/x"), "/Users/x/Applications/Agent Switch/Claude Desktop – MatneX.app");
});

test("the launcher script runs this CLI's open with every path quoted, so spaces and quotes are safe", () => {
  const script = L.appleScriptFor('/opt/home brew/bin/node', '/Users/x/my "dev"/dist/index.js', "claude-desktop", "MatneX");
  assert.equal(
    script,
    'do shell script quoted form of "/opt/home brew/bin/node" & " " & quoted form of "/Users/x/my \\"dev\\"/dist/index.js" & " open " & quoted form of "claude-desktop" & " " & quoted form of "MatneX"',
  );
});

test("a custom AGENT_SWITCH_HOME travels with the launcher, so a Dock start finds the same profiles", () => {
  const script = L.appleScriptFor("/n", "/i.js", "claude-desktop", "Work", "/data/as home");
  assert.equal(
    script,
    'do shell script "AGENT_SWITCH_HOME=" & quoted form of "/data/as home" & " " & quoted form of "/n" & " " & quoted form of "/i.js" & " open " & quoted form of "claude-desktop" & " " & quoted form of "Work"',
  );
});

test("node is pinned to its stable symlink, not the versioned Cellar path a brew upgrade deletes", () => {
  const real = (p: string) => (p === "/opt/homebrew/bin/node" ? "/opt/homebrew/Cellar/node/26.7.0/bin/node" : p);
  assert.equal(L.stableNode("/opt/homebrew/Cellar/node/26.7.0/bin/node", ["/opt/homebrew/bin/node"], real), "/opt/homebrew/bin/node");
  // No symlink resolves to the running node → keep the running one.
  assert.equal(L.stableNode("/usr/bin/node", ["/opt/homebrew/bin/node"], real), "/usr/bin/node");
});

test("the running main process of a profile is found by its exact user-data dir, never a helper or a longer path", () => {
  const dir = "/Users/x/.agent-switch/claude/Work/gui/claude-desktop";
  const ps = [
    `  102 /Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer --user-data-dir=${dir}`,
    `  103 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=${dir}-old`,
    `  101 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=${dir}`,
    "  104 /Applications/Claude.app/Contents/MacOS/Claude",
  ].join("\n");
  assert.equal(L.findMainPid(ps, dir), 101);
  assert.equal(L.findMainPid(ps, "/Users/x/other"), null);
});

test("the manifest keeps one entry per app and profile, and finds a profile's launchers", () => {
  const e = (app: string, profile: string) => ({ app, provider: "claude" as const, profile, path: `/p/${app}-${profile}.app` });
  let m = L.upsertEntry([], e("claude-desktop", "Work"));
  m = L.upsertEntry(m, e("claude-desktop", "Work"));
  m = L.upsertEntry(m, e("claude-desktop", "Home"));
  assert.equal(m.length, 2);
  assert.deepEqual(
    L.entriesFor(m, "claude", "Work").map((x) => x.profile),
    ["Work"],
  );
  assert.deepEqual(L.withoutEntry(m, "claude-desktop", "Work").map((x) => x.profile), ["Home"]);
});
