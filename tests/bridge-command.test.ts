import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, "../../tests/fixtures/timeline");
const mod = new URL("../src/commands/bridge.js", import.meta.url).href;
const leaseMod = new URL("../src/host/lease.js", import.meta.url).href;

/** A home with one Claude account holding the fixture transcript, and a fake `claude` that only says it ran. */
function home() {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-bridge-")));
  const cfg = path.join(h, "claude", "work", "config");
  fs.mkdirSync(path.join(cfg, "projects", "-work-fx"), { recursive: true });
  fs.writeFileSync(path.join(cfg, ".claude.json"), "{}");
  fs.copyFileSync(path.join(FIX, "claude-2.1.316.jsonl"), path.join(cfg, "projects", "-work-fx", "9f640d3b-0a51-47b5-944c-934d3148a098.jsonl"));
  const fake = path.join(h, "fake-claude.mjs");
  fs.writeFileSync(fake, `#!${process.execPath}\nprocess.stdin.on('data',()=>{});process.stdin.on('end',()=>process.exit(0));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: fake } }));
  return h;
}

function run(h: string, code: string, input = "") {
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, AGENT_SWITCH_HOME: h }, encoding: "utf8", input, timeout: 20_000 });
}

test("timeline --json: the fixture transcript's last page, with its version", () => {
  const h = home();
  const r = run(h, `const { cmdTimeline } = await import(${JSON.stringify(mod)}); await cmdTimeline("9f640d3b-0a51-47b5-944c-934d3148a098", { json: true, limit: "20" });`);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual([o.key, o.provider, o.version, o.newerThanFixtures, o.events.length], ["claude/work/9f640d3b-0a51-47b5-944c-934d3148a098", "claude", "2.1.316", false, 20]);
  assert.equal(o.from + o.events.length, o.total, "the last page ends at the newest event");
});

test("bridge: a second writer is refused while the lease is held; the holder's bridge starts and releases it", () => {
  const h = home();
  const key = "claude/work/9f640d3b-0a51-47b5-944c-934d3148a098";
  // Someone else (a live process: this test runner) holds the session.
  const hold = run(h, `const { InputLeases } = await import(${JSON.stringify(leaseMod)}); new InputLeases(process.env.AGENT_SWITCH_HOME).acquire(${JSON.stringify(key)}, { id: "app:other", pid: ${process.pid}, kind: "app" });`);
  assert.equal(hold.status, 0, hold.stderr);
  const refused = run(h, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", "9f640d3b-0a51-47b5-944c-934d3148a098", {}); process.exit(process.exitCode ?? 0);`);
  assert.equal(refused.status, 3);
  assert.match(JSON.parse(refused.stdout.trim()).message, /being typed into by app app:other/);

  const free = home();
  const ok = run(free, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", "9f640d3b-0a51-47b5-944c-934d3148a098", {}); const { InputLeases } = await import(${JSON.stringify(leaseMod)}); console.log(JSON.stringify({ after: new InputLeases(process.env.AGENT_SWITCH_HOME).read(${JSON.stringify(key)}) }));`, "");
  assert.equal(ok.status, 0, ok.stderr);
  const lines = ok.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { bridge: "ready", key, mode: "default" });
  assert.ok(lines.some((l) => l.bridge === "exit"));
  assert.deepEqual(lines.at(-1), { after: null }, "the lease is released when the bridge ends");
});

test("bridge: an agent binary that cannot start ends the bridge instead of hanging", () => {
  const h = home();
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: path.join(h, "no-such-claude") } }));
  const r = run(h, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", "9f640d3b-0a51-47b5-944c-934d3148a098", {});`, "");
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.match(lines[1].message, /ENOENT/);
  assert.deepEqual(lines[2], { bridge: "exit", code: null });
});

test("bridge refuses a bypass mode before it starts anything", () => {
  const h = home();
  const r = run(h, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", "9f640d3b-0a51-47b5-944c-934d3148a098", { mode: "bypassPermissions" });`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /approvals are never bypassed/);
});
