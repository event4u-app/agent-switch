import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The v3.2 agent registry and the ACP bridge over the BUILT CLI, against a
// scripted ACP agent (tests/fixtures/acp/fake-agent.mjs): add, list, a new
// session with one approval, and a resume through session/load.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../../dist/index.js");
const FAKE = path.resolve(HERE, "../../tests/fixtures/acp/fake-agent.mjs");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-acp-")));
  const work = path.join(home, "work");
  fs.mkdirSync(work);
  const env = { ...process.env, AGENT_SWITCH_HOME: home };
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", cwd: home });
  return { home, work, env, run };
}

/** Run a bridge, feed it commands as events arrive, collect every line. */
function bridge(env: NodeJS.ProcessEnv, args: string[], onLine: (o: Record<string, any>, write: (c: object) => void) => void): Promise<Record<string, any>[]> {
  const p = spawn(process.execPath, [CLI, "bridge", ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
  const lines: Record<string, any>[] = [];
  const write = (c: object) => p.stdin.write(JSON.stringify(c) + "\n");
  let buf = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const o = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      lines.push(o);
      onLine(o, write);
    }
  });
  const timer = setTimeout(() => p.kill(), 10_000);
  return new Promise((res) => p.on("exit", () => (clearTimeout(timer), res(lines))));
}

test("agents: built-ins, an added ACP agent, and argv-only validation", gate, () => {
  const { run } = setup();
  const list = JSON.parse(run("agents", "--json").stdout).agents;
  assert.deepEqual(list.map((a: { id: string; cls: string }) => [a.id, a.cls]), [["claude", "deep"], ["codex", "deep"], ["antigravity", "terminal"]]);
  const add = run("agents", "add", "fake", "--name", "Fake", "--binary", process.execPath, "--", FAKE);
  assert.equal(add.status, 0, add.stderr);
  const fake = JSON.parse(run("agents", "--json").stdout).agents.find((a: { id: string }) => a.id === "fake");
  assert.deepEqual([fake.cls, fake.args, fake.installed], ["acp", [FAKE], true]);
  const bad = run("agents", "add", "evil", "--binary", "sh -c id");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /binary/);
  const sug = JSON.parse(run("agents", "suggest", "--json").stdout).suggestions.map((s: { id: string }) => s.id);
  assert.deepEqual(sug, ["gemini", "opencode", "goose", "qwen-code"]);
  assert.match(run("agents", "local", "fake", "ollama:qwen3-coder:30b").stdout, /local · ollama · qwen3-coder:30b/);
  assert.equal(run("agents", "off", "fake").status, 0);
  const off = run("bridge", "--new", "--agent", "fake", "--cwd", "/");
  assert.match(off.stderr, /switched off/);
  assert.match(run("bridge", "--new", "--agent", "antigravity").stderr, /terminal only, not an ACP agent/);
});

test("bridge --agent: a turn with an approval answered, then a resume by key", gate, async () => {
  const { work, env, run } = setup();
  assert.equal(run("agents", "add", "fake", "--binary", process.execPath, "--", FAKE).status, 0);
  let sent = false;
  const lines = await bridge(env, ["--new", "--agent", "fake", "--cwd", work], (o, write) => {
    if (o.bridge === "ready" && !sent) (sent = true), write({ cmd: "send", text: "go" });
    if (o.event?.t === "approval.requested") write({ cmd: "approve", id: o.event.id });
    if (o.event?.t === "turn.end") write({ cmd: "close" });
  });
  const session = lines.find((o) => o.bridge === "session");
  assert.equal(session?.key, "acp/fake/fake-1");
  const kinds = lines.flatMap((o) => (o.event ? [o.event.t] : []));
  assert.deepEqual(kinds, ["turn", "message", "tool.started", "approval.requested", "approval.resolved", "tool.finished", "message.delta", "message", "turn.end"]);
  assert.equal(lines.find((o) => o.event?.t === "message" && o.event.role === "assistant")?.event.text, "you picked ok");

  const resumed = await bridge(env, ["acp/fake/fake-1"], (o, write) => o.bridge === "ready" && write({ cmd: "close" }));
  assert.deepEqual(resumed.flatMap((o) => (o.event ? [o.event.t] : [])), ["turn", "message"]);
  assert.match(run("bridge", "acp/fake/unknown-9").stderr, /not started by Agent Switch/);
  assert.match(run("bridge", "acp/fake/..%2f").stderr, /not an ACP session key/);
});

test("an approval answered from outside the chat: needs deny, then remote rpc over the same bridge decision", gate, async () => {
  const { work, env, run } = setup();
  assert.equal(run("agents", "add", "fake", "--binary", process.execPath, "--", FAKE).status, 0);
  const outside: { status: number | null; stdout: string }[] = [];
  let turns = 0;
  const lines = await bridge(env, ["--new", "--agent", "fake", "--cwd", work], (o, write) => {
    if (o.bridge === "ready") write({ cmd: "send", text: "go" });
    if (o.event?.t === "approval.requested") {
      // Answered by another process, through the bridge's inbox — never by this chat.
      const r = spawn(process.execPath, [CLI, "needs", "deny", "acp/fake/fake-1", o.event.id, "--json"], { env });
      let out = "";
      r.stdout.on("data", (d) => (out += d));
      r.on("exit", (status) => outside.push({ status, stdout: out }));
    }
    if (o.event?.t === "turn.end" && ++turns === 1) write({ cmd: "close" });
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(outside.map((x) => [x.status, JSON.parse(x.stdout)]), [[0, { status: "applied", reason: "denied" }]]);
  assert.equal(lines.find((o) => o.event?.t === "message" && o.event.role === "assistant")?.event.text, "you picked no");

  const late = run("needs", "allow", "acp/fake/fake-1", "t1", "--json");
  assert.equal(late.status, 2);
  assert.equal(JSON.parse(late.stdout).status, "no-bridge", "no bridge, nothing applied");

  const rpcRun = (input: string) => spawnSync(process.execPath, [CLI, "remote", "rpc"], { env, input, encoding: "utf8" });
  const off = rpcRun(JSON.stringify({ id: 1, method: "needs.list" }) + "\n");
  assert.equal(JSON.parse(off.stdout).error.code, "off");
  assert.equal(run("remote", "ssh", "on").status, 0);
  const res = rpcRun([{ id: 1, method: "needs.list" }, { id: 2, method: "settings.set", params: { mode: "bypassPermissions" } }].map((x) => JSON.stringify(x)).join("\n") + "\n").stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(res[0].ok, true);
  assert.deepEqual(res[1].error.code, "not_implemented");
  assert.deepEqual(JSON.parse(run("remote", "--json").stdout), { remoteControlAccounts: [], ssh: true });
});
