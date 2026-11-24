import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// State root for this file, set before the modules that read it at import.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-debuglog-")));
process.env.AGENT_SWITCH_HOME = HOME;
const { appendDebug, clean, DEBUG_LOG_FILE, DEBUG_LOG_KEEP, debugLogEnabled, formatDebug, readDebug, sanitize, setDebugLog } = await import("../src/debug-log.js");

test("clean: one line; no quoted text, paths, file names or secrets; short", () => {
  assert.equal(clean('nothing was sent: your draft is in the way ("fix the login bug")\nsend it'), 'nothing was sent: your draft is in the way ("…") send it');
  assert.equal(clean("opened “My secret title” there"), "opened “…” there");
  assert.equal(clean("can't open it, it's gone"), "can't open it, it's gone", "apostrophes are not quotes");
  assert.equal(clean("/Users/me/projects/acme-merger/src failed"), "<path> failed", "a project's folders say what it is");
  assert.equal(clean("cd ~/work/secret-client: no such dir"), "cd <path> no such dir");
  assert.equal(clean("open C:\\Users\\me\\plan failed"), "open <path> failed");
  assert.equal(clean("refused acquisition-plan.pdf: not a regular file"), "refused <file .pdf>: not a regular file", "an attachment's name is content");
  assert.equal(clean("Cannot read x (V3App.tsx:12)"), "Cannot read x (<file .tsx>:12)");
  assert.equal(clean("login failed: password=hunter2 token: abc123 Bearer xyz"), "login failed: password=[redacted] token: [redacted] Bearer [redacted]");
  assert.match(clean(`token sk-ant-${"a".repeat(30)} leaked`), /token \[redacted\] leaked/);
  assert.equal(clean("claude/work/4efe1c8b is busy"), "claude/work/4efe1c8b is busy", "session keys stay");
  assert.equal(clean("x".repeat(20) + " " + "y".repeat(10), 12).length, 12);
});

test("sanitize: only known kinds; a key that is not a key, unknown fields and odd detail are dropped", () => {
  const now = new Date("2026-11-24T08:00:00Z");
  assert.equal(sanitize({ kind: "nonsense", what: "x" }, now), null);
  assert.equal(sanitize({ kind: "call", what: "" }, now), null);
  const e = sanitize({ kind: "call", what: "view chat", key: "claude/work/4efe1c8b", ok: false, ms: 12.6, error: 'refused "draft"', prompt: "secret text", detail: { code: 2, step: "open", "bad key": 1, nested: { a: 1 }, flag: true } }, now)!;
  assert.deepEqual(e, { at: now.toISOString(), src: "app", kind: "call", what: "view chat", key: "claude/work/4efe1c8b", ok: false, ms: 13, error: 'refused "…"', detail: { code: 2, step: "open", flag: true } });
  assert.equal(sanitize({ kind: "view", what: "x", key: "/Users/me/project" }, now)!.key, undefined);
  assert.equal(sanitize({ kind: "view", what: "x", key: "codex/private/plan" }, now)!.key, undefined, "a title shaped like a key is not a key");
  assert.equal(sanitize({ kind: "view", what: "x", key: "claude/work/new" }, now)!.key, "claude/work/new");
  assert.equal(sanitize({ kind: "bridge", what: "x", src: "cli" }, now)!.src, "cli");
});

test("appendDebug keeps the newest 100, oldest first; formatDebug reads as one line", () => {
  fs.rmSync(DEBUG_LOG_FILE, { force: true });
  for (let i = 0; i < 250; i++) appendDebug([{ kind: "action", what: `a${i}` }]);
  const log = readDebug();
  assert.equal(log.length, DEBUG_LOG_KEEP);
  assert.equal(log[0].what, "a150");
  assert.equal(log.at(-1)!.what, "a249");
  assert.equal(fs.readFileSync(DEBUG_LOG_FILE, "utf8").split("\n").filter(Boolean).length, DEBUG_LOG_KEEP, "the file itself never holds more than 100");
  assert.equal(appendDebug([{ kind: "bogus", what: "x" }]), 0, "nothing valid: nothing written");
  assert.equal(formatDebug({ at: "t", src: "cli", kind: "view", what: "to terminal", key: "claude/w/s", ok: false, ms: 5, error: "refused", detail: { code: 2 } }), "t  cli  view  to terminal  claude/w/s  FAILED  5ms  code=2  — refused");
});

test("off: nothing is written and the log is removed; on again writes", () => {
  appendDebug([{ kind: "action", what: "before" }]);
  setDebugLog(false);
  assert.equal(debugLogEnabled(), false);
  assert.equal(fs.existsSync(DEBUG_LOG_FILE), false, "switching off removes what was kept");
  assert.equal(appendDebug([{ kind: "action", what: "while off" }]), 0);
  assert.equal(fs.existsSync(DEBUG_LOG_FILE), false);
  setDebugLog(true);
  assert.equal(appendDebug([{ kind: "action", what: "after" }]), 1);
  assert.deepEqual(readDebug().map((e) => e.what), ["after"]);
});

test("`debug-log add` takes the app's batch; `debug-log --json` returns it with its state", () => {
  const mod = new URL("../src/commands/debug-log.js", import.meta.url).href;
  const run = (code: string) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, AGENT_SWITCH_HOME: HOME }, encoding: "utf8" });
  fs.rmSync(DEBUG_LOG_FILE, { force: true });
  const batch = JSON.stringify([{ kind: "action", what: "view" }, { kind: "call", what: "view chat", ok: false, error: "x" }, { kind: "junk" }]);
  const add = run(`const { cmdDebugLog } = await import(${JSON.stringify(mod)}); cmdDebugLog("add", [${JSON.stringify(batch)}], {});`);
  assert.equal(add.status, 0, add.stderr);
  assert.deepEqual(JSON.parse(add.stdout), { ok: true, done: "2" });
  const read = run(`const { cmdDebugLog } = await import(${JSON.stringify(mod)}); cmdDebugLog(undefined, [], { json: true });`);
  const o = JSON.parse(read.stdout);
  assert.equal(o.enabled, true);
  assert.equal(o.keep, 100);
  assert.deepEqual(o.log.map((e: { what: string }) => e.what), ["view", "view chat"]);
});

test("a chat bridge that is refused says so in the debug log, with its key and why", () => {
  const mod = new URL("../src/commands/bridge.js", import.meta.url).href;
  fs.rmSync(DEBUG_LOG_FILE, { force: true });
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", "claude/nobody/0000aaaa", {});`], { env: { ...process.env, AGENT_SWITCH_HOME: HOME }, encoding: "utf8" });
  assert.match(r.stdout, /"bridge":"error"/);
  const e = readDebug().find((x) => x.kind === "bridge" && x.what === "refused");
  assert.ok(e, JSON.stringify(readDebug()));
  assert.equal(e.src, "cli");
  assert.equal(e.key, "claude/nobody/0000aaaa");
  assert.match(e.error ?? "", /no Claude or Codex session/);
});

const mod = new URL("../src/debug-log.js", import.meta.url).href;
/** Several real processes at once, each appending `n` entries (or, with `off`, switching the log off midway). */
function writers(count: number, n: number, off = false): Promise<void> {
  const one = (i: number) =>
    new Promise<void>((res, rej) => {
      const code = off && i === 0
        ? `const m = await import(${JSON.stringify(mod)}); await new Promise((r) => setTimeout(r, 60)); m.setDebugLog(false);`
        : `const m = await import(${JSON.stringify(mod)}); for (let k = 0; k < ${n}; k++) { m.appendDebug([{ kind: "action", what: "w${i}-" + k }]); await new Promise((r) => setImmediate(r)); }`;
      const c = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, AGENT_SWITCH_HOME: HOME }, stdio: "ignore" });
      c.on("exit", (code) => (code === 0 ? res() : rej(new Error(`writer ${i} exited ${code}`))));
    });
  return Promise.all(Array.from({ length: count }, (_, i) => one(i))).then(() => undefined);
}

test("processes writing at once lose nothing: every entry of 4 writers × 20 is kept", async () => {
  setDebugLog(true);
  fs.rmSync(DEBUG_LOG_FILE, { force: true });
  await writers(4, 20);
  const got = new Set(readDebug().map((e) => e.what));
  assert.equal(got.size, 80);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 20; k++) assert.ok(got.has(`w${i}-${k}`), `w${i}-${k} lost`);
});

test("off while others write: no writer brings the file back afterwards", async () => {
  setDebugLog(true);
  fs.rmSync(DEBUG_LOG_FILE, { force: true });
  await writers(5, 60, true);
  assert.equal(debugLogEnabled(), false);
  assert.equal(fs.existsSync(DEBUG_LOG_FILE), false);
  setDebugLog(true);
});
