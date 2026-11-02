import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TmuxHost, HOST_SESSION } from "../src/host/tmux-host.js";
import { HOOK_EVENTS } from "../src/hooks.js";

const gate = { skip: TmuxHost.available() ? false : "tmux is not installed here" };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-host-"));

/** A stand-in for `claude`: records argv, cwd and env, then waits for input. */
function stubBin(dir: string): string {
  const bin = path.join(dir, "fake-claude");
  fs.writeFileSync(
    bin,
    `#!/bin/sh
out="$AS_STUB_OUT/$$.json"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd(), cfg: process.env.CLAUDE_CONFIG_DIR, pane: process.env.AGENT_SWITCH_HOST_PANE, parent: process.env.AGENT_SWITCH_PARENT_SESSION || null}))' "$out" "$@"
while IFS= read -r line; do echo "got: $line"; done
`,
    { mode: 0o755 },
  );
  return bin;
}

const waitFor = (pred: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    spawnSync("sleep", ["0.05"]);
  }
  return pred();
};

test("programArgv: claude gets a chosen session id and the hook settings; a resume keeps its own id", () => {
  const o = { provider: "claude", account: "work", configDir: "/c", cwd: "/w", bin: "claude" };
  assert.deepEqual(TmuxHost.programArgv(o, "u-1", "/h.json"), ["claude", "--session-id", "u-1", "--settings", "/h.json"]);
  assert.deepEqual(TmuxHost.programArgv({ ...o, args: ["--resume", "old"] }, "u-1", "/h.json"), ["claude", "--settings", "/h.json", "--resume", "old"]);
  assert.deepEqual(TmuxHost.programArgv({ ...o, provider: "codex", bin: "codex" }, "u-1", null), ["codex"]);
});

test("start refuses names that could break out of argv or env", () => {
  const host = new TmuxHost(tmp(), { socket: "never-used" });
  const base = { provider: "claude", account: "work", configDir: "/c", cwd: "/w", bin: "claude" };
  assert.throws(() => host.start({ ...base, account: "a/b" }));
  assert.throws(() => host.start({ ...base, provider: "x;y" }));
  assert.throws(() => host.start({ ...base, sessionId: "$(rm -rf ~)" }));
  assert.throws(() => host.start({ ...base, env: { "A=B": "x" } }));
});

test("the host runs several sessions per account by argv, on its own server, and finds them again after a restart", gate, () => {
  const root = tmp();
  const out = path.join(root, "out");
  fs.mkdirSync(out);
  const bin = stubBin(root);
  const socket = `as-test-${process.pid}`;
  const host = new TmuxHost(root, { socket });
  const before = spawnSync("tmux", ["ls"], { encoding: "utf8" }).stdout;
  try {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "asw-cwd-"));
    const env = { AS_STUB_OUT: out, AGENT_SWITCH_PARENT_SESSION: "claude/work/parent" };
    const a = host.start({ provider: "claude", account: "work", configDir: "/cfg/work", cwd, bin, env }, "asw-test-hook");
    const b = host.start({ provider: "claude", account: "work", configDir: "/cfg/work", cwd, bin, env: { AS_STUB_OUT: out } }, "asw-test-hook");
    const c = host.start({ provider: "claude", account: "side", configDir: "/cfg/side", cwd, bin, env: { AS_STUB_OUT: out } }, "asw-test-hook");
    assert.notEqual(a.sessionId, b.sessionId);
    assert.ok(waitFor(() => fs.readdirSync(out).length === 3), "three programs started");

    const seen = fs.readdirSync(out).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")));
    const ofA = seen.find((s) => s.argv.includes(a.sessionId))!;
    assert.deepEqual(ofA.argv, ["--session-id", a.sessionId, "--settings", host.settingsFile]);
    assert.equal(fs.realpathSync(ofA.cwd), fs.realpathSync(cwd));
    assert.equal(ofA.cfg, "/cfg/work");
    assert.equal(ofA.pane, "1");
    assert.equal(ofA.parent, "claude/work/parent", "lineage env reaches the program");
    assert.equal(seen.find((s) => s.argv.includes(c.sessionId))!.cfg, "/cfg/side");

    const settings = JSON.parse(fs.readFileSync(host.settingsFile, "utf8"));
    assert.deepEqual(Object.keys(settings.hooks).sort(), [...HOOK_EVENTS].sort());
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "asw-test-hook __hook-event");
    if (process.platform !== "win32") assert.equal(fs.statSync(host.settingsFile).mode & 0o777, 0o600);

    // "App restart": a fresh Host object on the same root sees all three, alive.
    const again = new TmuxHost(root, { socket });
    assert.deepEqual(again.list().map((s) => [s.account, s.alive]).sort(), [["side", true], ["work", true], ["work", true]]);
    assert.equal(spawnSync("tmux", ["-L", socket, "list-windows", "-t", `=${HOST_SESSION}`], { encoding: "utf8" }).stdout.trim().split("\n").length, 3);

    // Ending is explicit and touches only that session.
    assert.equal(again.end(b.key), true);
    assert.deepEqual(again.list().map((s) => s.key).sort(), [a.key, c.key].sort());
    assert.equal(again.end(b.key), false);
  } finally {
    host.killServer();
  }
  assert.equal(spawnSync("tmux", ["ls"], { encoding: "utf8" }).stdout, before, "the user's default server is untouched");
});

test("a finished program is reported as not alive and its last screen stays readable", gate, () => {
  const root = tmp();
  const bin = path.join(root, "quick");
  fs.writeFileSync(bin, "#!/bin/sh\necho bye from the program\n", { mode: 0o755 });
  const host = new TmuxHost(root, { socket: `as-test-q-${process.pid}` });
  try {
    const s = host.start({ provider: "codex", account: "work", configDir: "/cfg", cwd: root, bin });
    assert.ok(waitFor(() => host.list()[0]?.alive === false), "pane is dead after exit");
    assert.match(host.capture(s.key) ?? "", /bye from the program/);
  } finally {
    host.killServer();
  }
});

test("2.x per-profile tmux names are listed, read-only", () => {
  const host = new TmuxHost(tmp(), { socket: "never-used" });
  assert.deepEqual(host.legacy({ "asw-claude-work": { provider: "claude", profile: "work" } }), [{ name: "asw-claude-work", provider: "claude", profile: "work", legacy: true }]);
});
