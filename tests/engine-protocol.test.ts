import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { parseRequest, ProtocolError, engineAddress, PROTOCOL_VERSION, MAX_LINE_BYTES } from "../src/protocol/messages.js";
import { startEngineServer, storeHandler, EngineRunning, type Handler } from "../src/engine/server.js";
import { callEngine, EngineUnreachable } from "../src/engine/client.js";
import { Store, storeFile } from "../src/store/store.js";
import { openDriver, StoreUnavailable } from "../src/store/driver.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-eng-"));
// Unix socket paths are limited to ~104 bytes on macOS; keep them short.
const sockIn = (dir: string) => (process.platform === "win32" ? `\\\\.\\pipe\\asw-test-${path.basename(dir)}` : path.join(dir, "e.sock"));

test("parseRequest accepts the v1 shape and names what is wrong otherwise", () => {
  assert.deepEqual(parseRequest('{"id":1,"op":"hello"}'), { id: 1, op: "hello" });
  assert.deepEqual(parseRequest('{"id":"a","op":"sessions","idem":"k","params":{}}'), { id: "a", op: "sessions", idem: "k", params: {} });
  const code = (l: string) => {
    try {
      parseRequest(l);
    } catch (e) {
      return (e as ProtocolError).code;
    }
    return "ok";
  };
  assert.equal(code("nope"), "bad_json");
  assert.equal(code("[1]"), "bad_json");
  assert.equal(code('{"op":"hello"}'), "bad_request");
  assert.equal(code('{"id":1,"op":"rm -rf"}'), "unknown_op");
  assert.equal(code('{"id":1,"op":"hello","idem":""}'), "bad_request");
  assert.equal(code('{"id":1,"op":"hello","params":[1]}'), "bad_request");
});

test("engineAddress: a socket in the root, a per-user pipe on Windows", () => {
  assert.equal(engineAddress("/home/u/.agent-switch/", "linux"), "/home/u/.agent-switch/engine.sock");
  assert.equal(engineAddress("C:\\x", "win32", "Ann Lee"), "\\\\.\\pipe\\agent-switch-Ann_Lee");
});

test("the server answers in order, keeps idempotent answers, and survives bad lines", async () => {
  const dir = tmp();
  const addr = sockIn(dir);
  let calls = 0;
  const handler: Handler = (req) => {
    if (req.op === "hello") return { n: ++calls };
    throw new ProtocolError("rejected", "nope");
  };
  const server = await startEngineServer(addr, handler);
  try {
    if (process.platform !== "win32") assert.equal(fs.statSync(addr).mode & 0o777, 0o600, "socket is private");
    const res = await callEngine(addr, [{ op: "hello" }, { op: "hello", idem: "k1" }, { op: "hello", idem: "k1" }, { op: "sessions" }]);
    assert.deepEqual(res.map((r) => r.id), [0, 1, 2, 3]);
    assert.deepEqual(res.slice(0, 3).map((r) => (r.ok ? r.result : null)), [{ n: 1 }, { n: 2 }, { n: 2 }], "same idem key, same answer, handler ran once");
    assert.equal(calls, 2);
    assert.deepEqual(res[3], { id: 3, ok: false, error: { code: "rejected", message: "nope" } });

    const raw = await new Promise<string>((resolve) => {
      const c = net.connect(addr);
      let b = "";
      c.setEncoding("utf8");
      c.on("data", (d: string) => {
        b += d;
        if (b.split("\n").length > 2) c.end();
      });
      c.on("close", () => resolve(b));
      c.write("garbage\n" + JSON.stringify({ id: 9, op: "hello" }) + "\n");
    });
    const [bad, good] = raw.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(bad.error.code, "bad_json");
    assert.equal(good.ok, true, "a bad line does not close the connection");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("an oversized line is refused without being parsed", async () => {
  const dir = tmp();
  const addr = sockIn(dir);
  const server = await startEngineServer(addr, () => "x");
  try {
    const reply = await new Promise<string>((resolve) => {
      const c = net.connect(addr);
      let b = "";
      c.setEncoding("utf8");
      c.on("data", (d: string) => (b += d));
      c.on("close", () => resolve(b));
      c.on("error", () => resolve(b));
      c.write("x".repeat(MAX_LINE_BYTES + 10));
    });
    assert.equal(JSON.parse(reply.trim()).error.code, "too_large");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("a second engine refuses to start; a stale socket is taken over", { skip: process.platform === "win32" ? "socket files are Unix-only" : false }, async () => {
  const dir = tmp();
  const addr = sockIn(dir);
  const first = await startEngineServer(addr, () => "first");
  await assert.rejects(startEngineServer(addr, () => "second"), EngineRunning);
  await new Promise((r) => first.close(r));
  fs.writeFileSync(addr, ""); // what a crash can leave: a path nobody listens on
  const second = await startEngineServer(addr, () => "second");
  try {
    const [r] = await callEngine(addr, [{ op: "hello" }]);
    assert.equal(r.ok && r.result, "second");
  } finally {
    await new Promise((r) => second.close(r));
  }
});

test("without an engine the client says so, quickly", async () => {
  const addr = sockIn(tmp());
  await assert.rejects(callEngine(addr, [{ op: "hello" }], 500), EngineUnreachable);
});

const storeSkip = await openDriver(":memory:").then(
  (d) => (d.close(), false as const),
  (e) => (e instanceof StoreUnavailable ? e.message : (() => { throw e; })()),
);

test("over the socket: hello, ingest with retry, sessions and children from the store", { skip: storeSkip }, async () => {
  const dir = tmp();
  const store = await Store.open(storeFile(dir));
  const addr = sockIn(dir);
  const server = await startEngineServer(addr, storeHandler(store));
  try {
    const ev = (event: string, extra = {}) => ({ producer: "hook:claude-work", provider: "claude", account: "work", record: { event, sessionId: "s1", at: "2026-11-02T10:00:00Z", ...extra } });
    const res = await callEngine(addr, [
      { op: "hello" },
      { op: "ingest", idem: "e1", params: { ...ev("SubagentStart", { agentId: "a1", agentType: "Explore" }), seq: 1 } },
      { op: "ingest", idem: "e1", params: { ...ev("SubagentStart", { agentId: "a1" }), seq: 1 } },
      { op: "ingest", params: { ...ev("Stop"), seq: 1 } },
      { op: "ingest", params: { producer: "x", seq: 2, provider: "claude", account: "work", record: { at: "2026" } } },
      { op: "sessions" },
      { op: "children", params: { provider: "claude", account: "work", sessionId: "s1" } },
      { op: "children", params: {} },
    ]);
    assert.ok(res[0].ok && (res[0].result as any).protocol === PROTOCOL_VERSION);
    assert.deepEqual(res.slice(1, 4).map((r) => r.ok && (r.result as any).stored), [true, true, false], "the retry is answered from the idem cache; the same seq again is not stored twice");
    assert.equal(!res[4].ok && res[4].error.code, "rejected");
    assert.equal(res[5].ok && (res[5].result as any[]).length, 1);
    assert.equal(res[6].ok && (res[6].result as any[])[0].agentType, "Explore");
    assert.equal(!res[7].ok && res[7].error.code, "bad_request");
    assert.equal(store.eventCount(), 1);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
  }
});

test("startEngine: imports the hook rings, answers on the root's socket, and a second one stays off", { skip: storeSkip || (process.platform === "win32" ? "Unix socket path" : false) }, async () => {
  const { startEngine } = await import("../src/engine/run.js");
  // A short root: the socket path must fit the Unix limit.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e-"));
  fs.mkdirSync(path.join(root, "events"));
  fs.writeFileSync(path.join(root, "events", "claude-work.jsonl"), JSON.stringify({ event: "SessionStart", sessionId: "s1", at: "2026-11-02T10:00:00Z" }) + "\n");
  const logs: string[] = [];
  const engine = await startEngine(root, (l) => logs.push(l));
  assert.ok(engine, logs.join("\n"));
  try {
    assert.equal(engine!.address, path.join(root, "engine.sock"));
    const [r] = await callEngine(engine!.address, [{ op: "sessions" }]);
    assert.deepEqual(r.ok && (r.result as any[]).map((s) => s.key), ["claude/work/s1"]);
    assert.ok(logs.some((l) => l.includes("imported 1 hook events")));
    const second = await startEngine(root, (l) => logs.push(l));
    assert.equal(second, null);
    assert.ok(logs.some((l) => /engine off: .*already listens/.test(l)));
  } finally {
    await engine!.stop();
  }
});

test("CLI `engine status --json`: stopped without an engine, running with one", { skip: storeSkip || (process.platform === "win32" ? "Unix socket path" : false) }, async () => {
  const { startEngine } = await import("../src/engine/run.js");
  const { execFile } = await import("node:child_process");
  const CLI = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../dist/index.js");
  if (!fs.existsSync(CLI)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e-"));
  // Async on purpose: the engine under test answers from this process's event loop.
  const status = () =>
    new Promise<any>((resolve, reject) =>
      execFile("node", [CLI, "engine", "status", "--json"], { env: { ...process.env, AGENT_SWITCH_HOME: root, AGENT_SWITCH_HOST_SOCKET: `as-test-es-${process.pid}` }, encoding: "utf8" }, (err, out) => (err ? reject(err) : resolve(JSON.parse(out)))),
    );
  const stopped = await status();
  assert.equal(stopped.running, false);
  assert.equal(stopped.service, "not-installed");
  assert.match(stopped.reason, /not reachable/);
  // The service runs another install (an older version, a dev checkout): a restart there cannot start this engine.
  fs.writeFileSync(path.join(root, "service-manifest.json"), JSON.stringify({ label: "x", files: ["/x.plist"], invocation: { exec: "/usr/bin/node", args: ["/elsewhere/dist/index.js", "service", "run"] } }));
  const elsewhere = await status();
  assert.equal(elsewhere.service, "other-cli");
  assert.equal(elsewhere.reason, "the background service runs another Agent Switch (/elsewhere/dist/index.js); restarting it does not start this engine");
  const engine = await startEngine(root, () => {});
  try {
    const s = await status();
    assert.equal(s.running, true);
    assert.equal(s.pid, process.pid);
  } finally {
    await engine!.stop();
  }
});

test("downReason: a service of another install is named first; otherwise the socket error stands", async () => {
  const { downReason } = await import("../src/commands/engine.js");
  assert.equal(downReason("other-cli", "ENOENT", "/a/index.js"), "the background service runs another Agent Switch (/a/index.js); restarting it does not start this engine");
  assert.equal(downReason("other-cli", "ENOENT", null), "the background service runs another Agent Switch; restarting it does not start this engine");
  assert.equal(downReason("this-cli", "ECONNREFUSED", "/a/index.js"), "ECONNREFUSED");
  assert.equal(downReason("not-installed", "ENOENT", null), "ENOENT");
});
