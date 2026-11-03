import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { startEngineServer, storeHandler } from "../src/engine/server.js";
import { callEngine } from "../src/engine/client.js";
import { Store, importEventRings, storeFile } from "../src/store/store.js";
import { openDriver, StoreUnavailable } from "../src/store/driver.js";
import { buildHookEntry, hookCommand, hooksInstalled, hooksNeedMigration, relayPath, withHooksInstalled } from "../src/hooks.js";
import { takeInHook } from "../src/hook-intake.js";

const storeSkip = await openDriver(":memory:").then(
  (d) => (d.close(), false as const),
  (e) => (e instanceof StoreUnavailable ? e.message : (() => { throw e; })()),
);

// Short roots: a Unix socket path must stay under ~104 bytes.
function root(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "r-"));
  fs.mkdirSync(path.join(r, "claude", "work", "config"), { recursive: true });
  return r;
}
const cfgOf = (r: string) => path.join(r, "claude", "work", "config");
const ring = (r: string) => {
  try {
    return fs.readFileSync(path.join(r, "events", "claude-work.jsonl"), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
const stop = (id: string) => ({ hook_event_name: "Stop", session_id: id, last_assistant_message: "secret answer" });

test("takeInHook: one ring line for an account here, nothing for a config dir elsewhere", () => {
  const r = root();
  const t = takeInHook(stop("s1"), { CLAUDE_CONFIG_DIR: cfgOf(r) }, r, new Date("2026-11-03T08:00:00Z"));
  assert.equal(t?.provider, "claude");
  assert.equal(t?.account, "work");
  assert.deepEqual(ring(r), [t!.line]);
  assert.ok(!t!.line.includes("secret answer"), "answer text never reaches the ring");
  assert.equal(takeInHook(stop("s2"), { CLAUDE_CONFIG_DIR: "/somewhere/else" }, r), null);
  assert.equal(takeInHook(stop("s3"), {}, r), null);
  assert.equal(ring(r).length, 1);
});

test("engine `hook`: answers stored only after the ring line and the store row; a later ring import adds nothing", { skip: storeSkip }, async () => {
  const r = root();
  const store = await Store.open(storeFile(r));
  const addr = process.platform === "win32" ? `\\\\.\\pipe\\asw-hook-${path.basename(r)}` : path.join(r, "e.sock");
  const server = await startEngineServer(addr, storeHandler(store, r));
  try {
    const env = { CLAUDE_CONFIG_DIR: cfgOf(r), AGENT_SWITCH_HOST_PANE: "claude/work/parent", PATH: "/must/not/matter" };
    const res = await callEngine(addr, [
      { op: "hook", params: { payload: { hook_event_name: "SessionStart", session_id: "s1", source: "startup" }, env } },
      { op: "hook", params: { payload: stop("s1"), env } },
      { op: "hook", params: { payload: stop("x"), env: { CLAUDE_CONFIG_DIR: "/elsewhere" } } },
    ]);
    assert.deepEqual(res.map((x) => x.ok && (x.result as any).stored), [true, true, false]);
    const lines = ring(r);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).lineage?.parent, "claude/work/parent", "the forwarded lineage env is used");
    assert.equal(store.eventCount(), 2);
    assert.equal(importEventRings(store, r).stored, 0, "the engine's own write and the ring are one row");
  } finally {
    await new Promise((x) => server.close(x));
    store.close();
  }
});

test("an engine without a root refuses hook events instead of guessing where they go", { skip: storeSkip }, async () => {
  const r = root();
  const store = await Store.open(storeFile(r));
  const addr = process.platform === "win32" ? `\\\\.\\pipe\\asw-hook0-${path.basename(r)}` : path.join(r, "e.sock");
  const server = await startEngineServer(addr, storeHandler(store));
  try {
    const [res] = await callEngine(addr, [{ op: "hook", params: { payload: stop("s1"), env: { CLAUDE_CONFIG_DIR: cfgOf(r) } } }]);
    assert.equal(!res.ok && res.error.code, "rejected");
    assert.equal(ring(r).length, 0);
  } finally {
    await new Promise((x) => server.close(x));
    store.close();
  }
});

test("hook command: the relay runs first when installed, and an install moves to it and back", () => {
  assert.equal(hookCommand("agent-switch"), "agent-switch __hook-event");
  assert.equal(hookCommand("agent-switch", "/r/bin/as-hook"), "'/r/bin/as-hook' agent-switch __hook-event");
  assert.equal(hookCommand("x", "/o'brien/as-hook"), "'/o'\\''brien/as-hook' x __hook-event");

  const plain = withHooksInstalled({ hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } });
  const viaRelay = hookCommand("agent-switch", "/r/bin/as-hook");
  assert.ok(hooksInstalled(plain) && hooksInstalled(plain, "agent-switch __hook-event"));
  assert.ok(!hooksInstalled(plain, viaRelay) && hooksNeedMigration(plain, viaRelay), "a relay that appeared later is picked up");
  const moved = withHooksInstalled(plain, "agent-switch", "/r/bin/as-hook");
  assert.ok(hooksInstalled(moved, viaRelay));
  assert.equal(moved.hooks.Stop[0].hooks[0].command, "mine", "the user's own entry stays first and unchanged");
  assert.equal(moved.hooks.Stop.length, 2);
  assert.ok(hooksNeedMigration(moved, "agent-switch __hook-event"), "and a removed relay moves the install back");
  assert.deepEqual(buildHookEntry("b", null), buildHookEntry("b"));

  const r = root();
  assert.equal(relayPath(r), null);
  const bin = path.join(r, "bin", process.platform === "win32" ? "as-hook.exe" : "as-hook");
  fs.mkdirSync(path.dirname(bin));
  fs.writeFileSync(bin, "");
  assert.equal(relayPath(r), bin);
});

// The built relay, when this checkout has one (CI builds it before the tests).
const here = path.dirname(fileURLToPath(import.meta.url));
const relayBin =
  process.env.AS_HOOK_BIN ??
  [path.resolve(here, "../../relay/target/release"), path.resolve(here, "../relay/target/release")]
    .map((d) => path.join(d, process.platform === "win32" ? "as-hook.exe" : "as-hook"))
    .find((p) => fs.existsSync(p));
const relaySkip = relayBin ? false : "as-hook not built (cargo build --release --manifest-path relay/Cargo.toml)";

/** A stand-in CLI that records what the relay handed to it. */
function fakeCli(r: string): string[] {
  const script = path.join(r, "cli.cjs");
  fs.writeFileSync(script, `require("fs").appendFileSync(${JSON.stringify(path.join(r, "fallback.log"))}, require("fs").readFileSync(0, "utf8") + "\\n");`);
  return [process.execPath, script];
}
const fallbacks = (r: string) => {
  try {
    return fs.readFileSync(path.join(r, "fallback.log"), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

test("as-hook without an engine: hands the same stdin to the CLI and exits 0", { skip: relaySkip }, () => {
  const r = root();
  const input = JSON.stringify(stop("s1"));
  const out = spawnSync(relayBin!, fakeCli(r), { input, env: { ...process.env, AGENT_SWITCH_HOME: r, USERNAME: `nobody-${path.basename(r)}` }, timeout: 10_000 });
  assert.equal(out.status, 0);
  assert.deepEqual(fallbacks(r), [input]);
});

test("as-hook with an engine: the engine stores it once and the CLI is not run", { skip: relaySkip || storeSkip || (process.platform === "win32" && !process.env.CI ? "the engine pipe name is per user" : false) }, async () => {
  const { startEngine } = await import("../src/engine/run.js");
  const r = root();
  const engine = await startEngine(r, () => {});
  assert.ok(engine);
  try {
    const run = (id: string) =>
      new Promise<number | null>((resolve) => {
        const c = spawn(relayBin!, fakeCli(r), { env: { ...process.env, AGENT_SWITCH_HOME: r, CLAUDE_CONFIG_DIR: cfgOf(r) } });
        c.stdin.end(JSON.stringify(stop(id)));
        c.on("exit", resolve);
      });
    const codes = await Promise.all(Array.from({ length: 20 }, (_, i) => run(`s${i}`)));
    assert.deepEqual(new Set(codes), new Set([0]));
    assert.equal(fallbacks(r).length, 0, "no event went the fallback way");
    assert.equal(ring(r).length, 20, "20 parallel hooks, 20 ring lines");
    const [s] = await callEngine(engine!.address, [{ op: "sessions" }]);
    assert.equal(s.ok && (s.result as any[]).length, 20);
  } finally {
    await engine!.stop();
  }
});

test("hooks relay <file> moves installed profiles to the relay, and off moves them back", { skip: relaySkip }, () => {
  const r = root();
  const cli = path.resolve(here, "../../dist/index.js");
  const run = (...a: string[]) => spawnSync(process.execPath, [cli, ...a], { env: { ...process.env, AGENT_SWITCH_HOME: r }, encoding: "utf8", timeout: 20_000 });
  const settings = () => JSON.parse(fs.readFileSync(path.join(cfgOf(r), "settings.json"), "utf8"));
  assert.equal(run("hooks", "install", "work").status, 0);
  assert.equal(settings().hooks.Stop[0].hooks[0].command, "agent-switch __hook-event");

  const on = run("hooks", "relay", relayBin!);
  assert.equal(on.status, 0, on.stderr);
  const dest = relayPath(r);
  assert.ok(dest);
  assert.equal(settings().hooks.Stop[0].hooks[0].command, hookCommand("agent-switch", dest));

  const off = run("hooks", "relay", "off");
  assert.equal(off.status, 0, off.stderr);
  assert.equal(relayPath(r), null);
  assert.equal(settings().hooks.Stop[0].hooks[0].command, "agent-switch __hook-event");

  assert.notEqual(run("hooks", "relay", path.join(r, "missing")).status, 0);
});
