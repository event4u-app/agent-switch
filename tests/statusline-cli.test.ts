import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { statuslineCheck } from "../src/doctor.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../../dist/index.js");
const FIX = path.resolve(HERE, "../../tests/fixtures/statusline-stdin.json");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function home(): { root: string; cfg: (n: string) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-slcli-"));
  const cfg = (n: string) => {
    const d = path.join(root, "claude", n, "config");
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  return { root, cfg };
}

const run = (root: string, args: string[], input = "", env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: root, HOME: root, ...env }, input, encoding: "utf8", timeout: 20_000 });

test("__statusline prints nothing and exits 0 on every path; writes the cache for a registered profile", gate, () => {
  const { root, cfg } = home();
  const dir = cfg("work");
  fs.writeFileSync(path.join(root, "claude", "work", "statusline-installed"), "/opt/bin/agent-switch __statusline\n");
  const text = fs.readFileSync(FIX, "utf8");
  for (const [input, env] of [
    [text, { CLAUDE_CONFIG_DIR: dir }],
    ["{broken", { CLAUDE_CONFIG_DIR: dir }],
    ["", { CLAUDE_CONFIG_DIR: dir }],
    [text, { CLAUDE_CONFIG_DIR: path.join(root, "unknown") }],
  ] as const) {
    const r = run(root, ["__statusline"], input, env);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  }
  const cache = JSON.parse(fs.readFileSync(path.join(root, "claude", "work", "usage-statusline.json"), "utf8"));
  assert.deepEqual(cache.snapshot.windows.map((w: any) => [w.key, w.utilization]), [["five_hour", 7], ["seven_day", 3]]);
});

test("statusline on/status/off: absolute command, refuses a user's own bar, off removes only ours", gate, () => {
  const { root, cfg } = home();
  const work = cfg("work");
  const own = cfg("own");
  fs.writeFileSync(path.join(own, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "my-bar" } }));
  const on = run(root, ["statusline", "on"]);
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /claude\/own: left alone/);
  assert.match(on.stdout, /claude\/work: on/);
  const cmd = JSON.parse(fs.readFileSync(path.join(work, "settings.json"), "utf8")).statusLine.command as string;
  assert.ok(path.isAbsolute(cmd.replace(/^'/, "").split(/'? __statusline$/)[0]), cmd);
  assert.match(cmd, / __statusline$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(own, "settings.json"), "utf8")).statusLine.command, "my-bar");
  assert.match(run(root, ["statusline", "status", "work"]).stdout, /claude\/work: on · no sample yet/);
  const off = run(root, ["statusline", "off"]);
  assert.match(off.stdout, /claude\/own: left alone/);
  assert.match(off.stdout, /claude\/work: off/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, "settings.json"), "utf8")), {});
});

test("statusline on names every profile a shared settings.json serves", { ...gate, skip: gate.skip || (process.platform === "win32" ? "symlinks" : false) }, () => {
  const { root, cfg } = home();
  const shared = path.join(root, "shared-settings.json");
  fs.writeFileSync(shared, "{}");
  for (const n of ["a", "b"]) fs.symlinkSync(shared, path.join(cfg(n), "settings.json"));
  const r = run(root, ["statusline", "on", "a"]);
  assert.match(r.stdout, /claude\/a, claude\/b share one settings\.json/);
  assert.equal(fs.existsSync(path.join(root, "claude", "b", "statusline-installed")), true);
});

test("doctor: present / displaced / missing; nothing when never turned on; newer Claude Code is noted", () => {
  assert.equal(statuslineCheck("w", "off", null), null);
  assert.equal(statuslineCheck("w", "present", "2.1.316")?.status, "ok");
  assert.equal(statuslineCheck("w", "present", "2.2.0")?.status, "info");
  assert.equal(statuslineCheck("w", "displaced", null)?.status, "warn");
  assert.match(statuslineCheck("w", "displaced", null)!.title, /displaced/);
  assert.equal(statuslineCheck("w", "missing", null)?.fix, "agent-switch statusline on w");
});
