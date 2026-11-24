import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
  const r = run(h, `const { cmdTimeline } = await import(${JSON.stringify(mod)}); await cmdTimeline("9f640d3b-0a51-47b5-944c-934d3148a098", { json: true, limit: "3" });`);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual([o.key, o.provider, o.version, o.newerThanFixtures], ["claude/work/9f640d3b-0a51-47b5-944c-934d3148a098", "claude", "2.1.316", false]);
  assert.equal(o.from + o.events.length, o.total, "the last page ends at the newest event");
  assert.ok(o.from > 0 && o.earlierPrompts === 1, "three rows reach back into the second prompt's turn; the first prompt is earlier");
  assert.ok(!o.events.some((e: { t: string }) => e.t === "unknown"), "bookkeeping lines are not sent");
  assert.ok(o.hidden.attachment > 0, "but they are counted");
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
  // The fixture session last ran in acceptEdits: the chat takes that mode over.
  assert.deepEqual(lines[0], { bridge: "ready", key, mode: "acceptEdits" });
  assert.ok(lines.some((l) => l.bridge === "exit"));
  assert.deepEqual(lines.at(-1), { after: null }, "the lease is released when the bridge ends");
});

test("bridge: SIGTERM mid-turn lets the turn finish, then closes and releases the lease", { skip: process.platform === "win32" ? "POSIX signals, and the fake agent is a script with a shebang" : false }, async () => {
  const h = home();
  const key = "claude/work/9f640d3b-0a51-47b5-944c-934d3148a098";
  // An agent whose turn takes a while: it answers the user's message after 1.5 s.
  const slow = path.join(h, "slow-claude.mjs");
  fs.writeFileSync(
    slow,
    `#!${process.execPath}\nlet done=false;process.stdin.on('data',(d)=>{if(done||!String(d).includes('"type":"user"'))return;done=true;setTimeout(()=>process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:1,total_cost_usd:0})+'\\n'),1500)});process.stdin.on('end',()=>process.exit(0));\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: slow } }));
  // The agent starts in the session's folder: the fixture's own one does not exist here.
  const tr = path.join(h, "claude", "work", "config", "projects", "-work-fx", "9f640d3b-0a51-47b5-944c-934d3148a098.jsonl");
  fs.writeFileSync(tr, fs.readFileSync(tr, "utf8").replaceAll('"/work/fx"', JSON.stringify(h)));
  const code = `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", "9f640d3b-0a51-47b5-944c-934d3148a098", {}); const { InputLeases } = await import(${JSON.stringify(leaseMod)}); console.log(JSON.stringify({ after: new InputLeases(process.env.AGENT_SWITCH_HOME).read(${JSON.stringify(key)}) }));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, AGENT_SWITCH_HOME: h }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
  const until = async (f: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    return f();
  };
  try {
    assert.ok(await until(() => out.includes('"bridge":"ready"'), 10_000), out);
    child.stdin.write(JSON.stringify({ cmd: "send", text: "hi" }) + "\n");
    await new Promise((r) => setTimeout(r, 300));
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(child.exitCode, null, "still running: the turn is not cut off");
    assert.equal(await exited, 0);
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    const end = lines.findIndex((l) => l.event?.t === "turn.end");
    const exit = lines.findIndex((l) => l.bridge === "exit");
    assert.ok(end >= 0 && exit > end, "the turn ended, then the bridge closed");
    assert.deepEqual(lines.at(-1), { after: null }, "the lease is released");
  } finally {
    child.kill("SIGKILL");
  }
});

test("bridge: a close or handover that arrives the moment it says ready still ends it cleanly, lease released", { skip: process.platform === "win32" ? "POSIX signals, and the fake agent is a script with a shebang" : false }, async () => {
  const h = home();
  const id = "9f640d3b-0a51-47b5-944c-934d3148a098";
  const key = `claude/work/${id}`;
  // The agent must really start, or the bridge ends on its own.
  const tr = path.join(h, "claude", "work", "config", "projects", "-work-fx", `${id}.jsonl`);
  fs.writeFileSync(tr, fs.readFileSync(tr, "utf8").replaceAll('"/work/fx"', JSON.stringify(h)));
  const code = `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, {});`;
  const once = (signal: NodeJS.Signals) =>
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
      const c = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, AGENT_SWITCH_HOME: h }, stdio: ["pipe", "pipe", "pipe"] });
      let sent = false;
      c.stdout.on("data", (d: Buffer) => {
        if (!sent && d.toString().includes('"bridge":"ready"')) {
          sent = true;
          c.kill(signal);
        }
      });
      c.on("close", (code, sig) => res({ code, signal: sig }));
    });
  // Measured before the handlers moved ahead of the start: 30 of 30 such runs were killed outright.
  for (let i = 0; i < 10; i++) {
    const r = await once(i % 2 ? "SIGTERM" : "SIGUSR2");
    assert.deepEqual(r, { code: 0, signal: null }, `run ${i}: ended by the signal itself, not by a clean close`);
  }
  const lease = run(h, `const { InputLeases } = await import(${JSON.stringify(leaseMod)}); console.log(JSON.stringify(new InputLeases(process.env.AGENT_SWITCH_HOME).read(${JSON.stringify(key)})));`);
  assert.equal(JSON.parse(lease.stdout), null);
});

test("bridge: a close while the chat waits for an approval nobody sees denies it, so the turn ends and the bridge closes", { skip: process.platform === "win32" ? "POSIX signals, and the fake agent is a script with a shebang" : false }, async () => {
  const h = home();
  const id = "9f640d3b-0a51-47b5-944c-934d3148a098";
  const key = `claude/work/${id}`;
  const tr = path.join(h, "claude", "work", "config", "projects", "-work-fx", `${id}.jsonl`);
  fs.writeFileSync(tr, fs.readFileSync(tr, "utf8").replaceAll('"/work/fx"', JSON.stringify(h)));
  const answers = path.join(h, "answers");
  // An agent that asks to run a command and waits for the answer before it ends the turn.
  const asking = path.join(h, "asking-claude.mjs");
  fs.writeFileSync(
    asking,
    `#!${process.execPath}
import fs from "node:fs";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "user") out({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "tail daemon.log" } } });
    if (m.type === "control_response") {
      fs.appendFileSync(${JSON.stringify(answers)}, JSON.stringify(m.response) + "\\n");
      out({ type: "result", subtype: "success", is_error: false, duration_ms: 1, total_cost_usd: 0 });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: asking } }));
  const code = `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, {});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, AGENT_SWITCH_HOME: h }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((r) => child.once("close", (c) => r(c)));
  const until = async (f: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    return f();
  };
  try {
    assert.ok(await until(() => out.includes('"bridge":"ready"'), 10_000), out);
    child.stdin.write(JSON.stringify({ cmd: "send", text: "check the log" }) + "\n");
    assert.ok(await until(() => out.includes('"approval.requested"') || out.includes("r1"), 5_000), out);
    child.kill("SIGTERM");
    const ended = await Promise.race([exited, new Promise((r) => setTimeout(() => r("hung"), 8_000))]);
    assert.equal(ended, 0, `the bridge closed instead of waiting forever: ${out}`);
    const answer = JSON.parse(fs.readFileSync(answers, "utf8").trim().split("\n")[0]);
    assert.equal(answer.request_id, "r1");
    assert.equal(answer.response.behavior, "deny");
    assert.equal(answer.response.message, "Closed for the terminal in Agent Switch");
    const lease = run(h, `const { InputLeases } = await import(${JSON.stringify(leaseMod)}); console.log(JSON.stringify(new InputLeases(process.env.AGENT_SWITCH_HOME).read(${JSON.stringify(key)})));`);
    assert.equal(JSON.parse(lease.stdout), null);
  } finally {
    child.kill("SIGKILL");
  }
});

test("bridge: the chat runs in the mode the session last ran in (auto), and says so; a mode that skips approvals is refused", { skip: process.platform === "win32" ? "fake binaries are POSIX shell scripts" : false }, () => {
  const h = home();
  const id = "9f640d3b-0a51-47b5-944c-934d3148a098";
  const tr = path.join(h, "claude", "work", "config", "projects", "-work-fx", `${id}.jsonl`);
  fs.writeFileSync(tr, fs.readFileSync(tr, "utf8").replaceAll('"/work/fx"', JSON.stringify(h)) + JSON.stringify({ type: "user", permissionMode: "auto", message: { role: "user", content: "x" } }) + "\n");
  const argv = path.join(h, "argv");
  const fake = path.join(h, "fake-claude-argv.mjs");
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(argv)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdin.on("data", () => {});\nprocess.stdin.on("end", () => process.exit(0));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: fake } }));
  const ok = run(h, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, {});`, "");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout.trim().split("\n")[0]).mode, "auto", "the chat shows the session's mode");
  const args: string[] = JSON.parse(fs.readFileSync(argv, "utf8"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "auto", "and runs Claude in it");
  const asked = run(h, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, { mode: "plan" });`, "");
  assert.equal(JSON.parse(asked.stdout.trim().split("\n")[0]).mode, "plan", "a mode asked for wins");
  const bypass = run(h, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, { mode: "bypassPermissions" });`, "");
  assert.notEqual(bypass.status, 0);
  assert.match(bypass.stderr, /approvals are never bypassed/);
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

test("bridge: a hosted session parked for the chat gets its terminal back when the chat's bridge ends", { skip: spawnSync("tmux", ["-V"]).status === 0 ? false : "tmux is not installed here" }, () => {
  const h = home();
  const id = "9f640d3b-0a51-47b5-944c-934d3148a098";
  const key = `claude/work/${id}`;
  const log = path.join(h, "runs");
  const fake = path.join(h, "fake-claude-log.mjs");
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\nprocess.stdin.on("data", () => {});\nprocess.stdin.on("end", () => process.exit(0));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: fake } }));
  const socket = `asw-bc-${process.pid}`;
  const env = { ...process.env, AGENT_SWITCH_HOME: h, AGENT_SWITCH_HOST_SOCKET: socket };
  const hostMod = new URL("../src/host/tmux-host.js", import.meta.url).href;
  const go = (code: string, input = "") => spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, encoding: "utf8", input, timeout: 20_000 });
  try {
    const started = go(`const { TmuxHost } = await import(${JSON.stringify(hostMod)}); const host = new TmuxHost(process.env.AGENT_SWITCH_HOME); host.start({ provider: "claude", account: "work", configDir: "/tmp", cwd: process.env.AGENT_SWITCH_HOME, bin: ${JSON.stringify(fake)}, sessionId: ${JSON.stringify(id)} }); host.park(${JSON.stringify(key)}, ["sh", "-c", "read x"]);`);
    assert.equal(started.status, 0, started.stderr);
    const bridged = go(`const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, {});`);
    assert.equal(bridged.status, 0, bridged.stderr);
    const end = Date.now() + 5000;
    const runs = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
    while (!runs().some((l) => l.includes(`--resume ${id}`) && !l.includes("-p")) && Date.now() < end) spawnSync("sleep", ["0.05"]);
    assert.ok(runs().some((l) => /--resume 9f640d3b/.test(l) && !/(^| )-p( |$)/.test(l)), `the window runs the program again, resuming: ${runs().join(" | ")}`);
    const reg = JSON.parse(fs.readFileSync(path.join(h, "host", "sessions.json"), "utf8"));
    assert.equal(reg[key].parked, undefined, "no longer parked");
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-server"]);
  }
});

test("bridge: handed over to a new chat (SIGUSR2), it closes and leaves the window parked for that chat", { skip: spawnSync("tmux", ["-V"]).status === 0 ? false : "tmux is not installed here" }, async () => {
  const h = home();
  const id = "9f640d3b-0a51-47b5-944c-934d3148a098";
  const key = `claude/work/${id}`;
  const log = path.join(h, "runs");
  const fake = path.join(h, "fake-claude-log.mjs");
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\nprocess.stdin.on("data", () => {});\nprocess.stdin.on("end", () => process.exit(0));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: fake } }));
  // The agent must really start (in the session's folder), or the bridge ends on its own before the handover.
  const tr = path.join(h, "claude", "work", "config", "projects", "-work-fx", `${id}.jsonl`);
  fs.writeFileSync(tr, fs.readFileSync(tr, "utf8").replaceAll('"/work/fx"', JSON.stringify(h)));
  const socket = `asw-bh-${process.pid}`;
  const env = { ...process.env, AGENT_SWITCH_HOME: h, AGENT_SWITCH_HOST_SOCKET: socket };
  const hostMod = new URL("../src/host/tmux-host.js", import.meta.url).href;
  try {
    const started = spawnSync(process.execPath, ["--input-type=module", "-e", `const { TmuxHost } = await import(${JSON.stringify(hostMod)}); const host = new TmuxHost(process.env.AGENT_SWITCH_HOME); host.start({ provider: "claude", account: "work", configDir: "/tmp", cwd: process.env.AGENT_SWITCH_HOME, bin: ${JSON.stringify(fake)}, sessionId: ${JSON.stringify(id)} }); host.park(${JSON.stringify(key)}, ["sh", "-c", "read x"]);`], { env, encoding: "utf8", timeout: 20_000 });
    assert.equal(started.status, 0, started.stderr);
    const child = spawn(process.execPath, ["--input-type=module", "-e", `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, {});`], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
    try {
      const end = Date.now() + 10_000;
      while (!out.includes('"bridge":"ready"') && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      assert.ok(out.includes('"bridge":"ready"'), out);
      child.kill("SIGUSR2");
      assert.equal(await exited, 0);
      assert.ok(!out.includes('"bridge":"error"'), out);
    } finally {
      child.kill("SIGKILL");
    }
    const reg = JSON.parse(fs.readFileSync(path.join(h, "host", "sessions.json"), "utf8"));
    assert.equal(reg[key].parked, true, "still parked: the new chat takes it");
    const runs = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
    assert.ok(!runs.some((l) => /--resume 9f640d3b/.test(l) && !/(^| )-p( |$)/.test(l)), `no terminal program came back: ${runs.join(" | ")}`);
    const lease = JSON.parse(spawnSync(process.execPath, ["--input-type=module", "-e", `const { InputLeases } = await import(${JSON.stringify(leaseMod)}); console.log(JSON.stringify(new InputLeases(process.env.AGENT_SWITCH_HOME).read(${JSON.stringify(key)})));`], { env, encoding: "utf8" }).stdout);
    assert.equal(lease, null, "the lease is free for the new chat");
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-server"]);
  }
});

test("bridge: chat → terminal, then a chat started again on the window running its program is refused — one program on the conversation", { skip: spawnSync("tmux", ["-V"]).status === 0 ? false : "tmux is not installed here" }, () => {
  const h = home();
  const id = "9f640d3b-0a51-47b5-944c-934d3148a098";
  const key = `claude/work/${id}`;
  const log = path.join(h, "runs");
  const fake = path.join(h, "fake-claude-log.mjs");
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\nprocess.stdin.on("data", () => {});\nprocess.stdin.on("end", () => process.exit(0));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: fake } }));
  const tr = path.join(h, "claude", "work", "config", "projects", "-work-fx", `${id}.jsonl`);
  fs.writeFileSync(tr, fs.readFileSync(tr, "utf8").replaceAll('"/work/fx"', JSON.stringify(h)));
  const socket = `asw-bt-${process.pid}`;
  const env = { ...process.env, AGENT_SWITCH_HOME: h, AGENT_SWITCH_HOST_SOCKET: socket };
  const hostMod = new URL("../src/host/tmux-host.js", import.meta.url).href;
  const go = (code: string, input = "") => spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, encoding: "utf8", input, timeout: 20_000 });
  const runs = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
  try {
    // The window runs the program again (the chat was closed for the terminal), not parked.
    const started = go(`const { TmuxHost } = await import(${JSON.stringify(hostMod)}); new TmuxHost(process.env.AGENT_SWITCH_HOME).start({ provider: "claude", account: "work", configDir: "/tmp", cwd: process.env.AGENT_SWITCH_HOME, bin: ${JSON.stringify(fake)}, sessionId: ${JSON.stringify(id)} });`);
    assert.equal(started.status, 0, started.stderr);
    const end = Date.now() + 5000;
    while (!runs().length && Date.now() < end) spawnSync("sleep", ["0.05"]);
    const before = runs().length;
    const again = go(`const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(id)}, {}); process.exit(process.exitCode ?? 0);`);
    assert.equal(again.status, 1);
    assert.match(JSON.parse(again.stdout.trim().split("\n")[0]).message, /open in its terminal in Agent Switch/);
    spawnSync("sleep", ["0.3"]);
    assert.equal(runs().length, before, `no second program started: ${runs().join(" | ")}`);
    const reg = JSON.parse(fs.readFileSync(path.join(h, "host", "sessions.json"), "utf8"));
    assert.equal(reg[key].parked, undefined, "the terminal keeps the window");
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-server"]);
  }
});

test("bridge: an unknown session is refused on stdout, where the app reads", () => {
  const h = home();
  const r = run(h, `const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", "claude/work/00000000-0000-4000-8000-000000000000", {});`);
  assert.notEqual(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { bridge: "error", message: "no Claude or Codex session claude/work/00000000-0000-4000-8000-000000000000" });
});

test("bridge: a hosted session before its first turn opens in the chat under its id, and its terminal comes back under the same id", { skip: spawnSync("tmux", ["-V"]).status === 0 ? false : "tmux is not installed here" }, () => {
  const h = home();
  const id = "1b2c3d4e-0000-4000-8000-00000000abcd";
  const key = `claude/work/${id}`;
  const log = path.join(h, "runs");
  const fake = path.join(h, "fake-claude-log.mjs");
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\nprocess.stdin.on("data", () => {});\nprocess.stdin.on("end", () => process.exit(0));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(h, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: fake } }));
  const socket = `asw-bn-${process.pid}`;
  const env = { ...process.env, AGENT_SWITCH_HOME: h, AGENT_SWITCH_HOST_SOCKET: socket };
  const hostMod = new URL("../src/host/tmux-host.js", import.meta.url).href;
  const go = (code: string, input = "") => spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, encoding: "utf8", input, timeout: 20_000 });
  try {
    const started = go(`const { TmuxHost } = await import(${JSON.stringify(hostMod)}); const host = new TmuxHost(process.env.AGENT_SWITCH_HOME); host.start({ provider: "claude", account: "work", configDir: "/tmp", cwd: process.env.AGENT_SWITCH_HOME, bin: ${JSON.stringify(fake)}, sessionId: ${JSON.stringify(id)} }); host.park(${JSON.stringify(key)}, ["sh", "-c", "read x"]);`);
    assert.equal(started.status, 0, started.stderr);
    const bridged = go(`const { cmdBridge } = await import(${JSON.stringify(mod)}); await cmdBridge("claude", ${JSON.stringify(key)}, {});`);
    assert.equal(bridged.status, 0, bridged.stderr);
    assert.deepEqual(JSON.parse(bridged.stdout.trim().split("\n")[0]), { bridge: "ready", key, mode: "default" });
    const runs = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
    const end = Date.now() + 5000;
    const isChat = (l: string) => /(^| )-p( |$)/.test(l);
    const after = () => runs().slice(runs().findIndex(isChat) + 1);
    while (!after().length && Date.now() < end) spawnSync("sleep", ["0.05"]);
    const chat = runs().find(isChat);
    assert.ok(chat?.includes(`--session-id ${id}`) && !chat.includes("--resume"), `the chat starts the conversation under its id: ${chat}`);
    const back = after()[0];
    assert.ok(back && !isChat(back), `the window runs the program again after the chat: ${runs().join(" | ")}`);
    assert.ok(back.includes(`--session-id ${id}`) && !back.includes("--resume"), `nothing to resume yet: ${back}`);
    const reg = JSON.parse(fs.readFileSync(path.join(h, "host", "sessions.json"), "utf8"));
    assert.equal(reg[key].parked, undefined, "no longer parked");
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-server"]);
  }
});
