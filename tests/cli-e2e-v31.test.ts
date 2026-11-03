import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The v3.1 commands over the BUILT CLI (`dist/index.js`): review, MCP listing,
// the view switch's refusal and the timeline, on a seeded home and a real repo.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };
const ID = "1b2c3d4e-0000-4000-8000-00000000abcd";

function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-e2e31-")));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.com");
  g("config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  g("add", ".");
  g("commit", "-qm", "base");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\nTWO\n");
  const cfg = path.join(home, "claude", "work", "config");
  const proj = path.join(cfg, "projects", "-repo");
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ mcpServers: { docs: { command: "npx", args: ["TOKEN-XYZ"] } } }));
  const ts = new Date(Date.now() - 60_000).toISOString();
  fs.writeFileSync(
    path.join(proj, `${ID}.jsonl`),
    [
      { type: "user", cwd: repo, sessionId: ID, timestamp: ts, uuid: "u1", message: { role: "user", content: "change a" } },
      { type: "assistant", cwd: repo, sessionId: ID, timestamp: ts, uuid: "a1", message: { role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n") + "\n",
  );
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", cwd: home });
  return { home, repo, run, g };
}

test("diff: the review as JSON and text, stage a change, a refused undo, a commit", gate, () => {
  const { run, g } = setup();
  const r = run("diff", ID, "--json");
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.scope, "worktree");
  assert.deepEqual(o.files.map((f: { path: string; hunks: { layer: string }[] }) => [f.path, f.hunks.map((h) => h.layer)]), [["a.txt", ["unstaged"]]]);
  assert.match(run("diff", ID).stdout, /^M a\.txt {2}\+1 -1$/m);
  const staged = run("diff", ID, "stage", "--file", "a.txt", "--json");
  assert.deepEqual(JSON.parse(staged.stdout), { ok: true, done: "staged a change in a.txt", undo: false });
  const undo = run("diff", ID, "undo", "--json");
  assert.equal(undo.status, 2);
  assert.deepEqual(JSON.parse(undo.stdout), { ok: false, error: "nothing to undo" });
  assert.match(run("diff", ID, "commit", "--message", "upper two").stdout, /^Committed [0-9a-f]+\.$/m);
  assert.match(g("log", "-1", "--format=%s"), /upper two/);
  assert.notEqual(run("diff", ID, "--scope", "nope").status, 0);
  for (const scope of ["session", "turn", "staged"]) {
    const sc = run("diff", ID, "--scope", scope, "--json");
    assert.equal(sc.status, 0, `${scope}: ${sc.stderr}`);
    assert.equal(JSON.parse(sc.stdout).scope, scope);
  }
  fs.writeFileSync(path.join(g("rev-parse", "--show-toplevel").trim(), "a.txt"), "one\nthree\n");
  assert.equal(JSON.parse(run("diff", ID, "discard", "--file", "a.txt", "--json").stdout).undo, true);
  assert.match(run("diff", ID, "undo").stdout, /^restored the last discard in a\.txt$/m);
});

test("mcp: the account's servers by name and transport, never their arguments", gate, () => {
  const { run } = setup();
  const text = run("mcp");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ {2}mcp docs \(stdio\)$/m);
  const json = run("mcp", "--json").stdout;
  assert.deepEqual(JSON.parse(json).map((a: { key: string; servers: unknown[] }) => [a.key, a.servers]), [["claude/work", [{ name: "docs", transport: "stdio", scope: "user" }]]]);
  assert.doesNotMatch(text.stdout + json, /TOKEN-XYZ/);
  assert.notEqual(run("mcp", "open", "claude/nobody").status, 0);
});

test("view: a session in no Agent Switch window cannot switch to chat", gate, () => {
  const { run } = setup();
  const r = run("view", ID, "chat", "--json");
  const said = `${r.stdout}${r.stderr}`;
  assert.notEqual(r.status, 0);
  assert.match(said, /Chat needs a session hosted in Agent Switch/);
  assert.notEqual(run("view", ID, "sideways").status, 0);
});

test("timeline and files: the session as AS events; repository files by query", gate, () => {
  const { run } = setup();
  const t = run("timeline", ID, "--json");
  assert.equal(t.status, 0, t.stderr);
  const o = JSON.parse(t.stdout);
  assert.equal(o.key, `claude/work/${ID}`);
  assert.ok(o.events.some((e: { t: string; text?: string }) => e.t === "message" && e.text === "Done."));
  const f = run("files", ID, "--query", "a", "--json");
  assert.equal(f.status, 0, f.stderr);
  assert.ok(JSON.parse(f.stdout).files.includes("a.txt"));
});

test("bridge: a session driven over stdin — attachments, model, mode, interrupt, an unknown approval, close", gate, () => {
  const { home, repo, run } = setup();
  const seen = path.join(home, "agent-stdin");
  const fake = path.join(home, "fake-claude.mjs");
  // A stand-in Claude: records what the bridge writes to it, ends when its stdin does.
  fs.writeFileSync(fake, `#!${process.execPath}\nimport fs from "node:fs";\nprocess.stdin.on("data", (d) => fs.appendFileSync(${JSON.stringify(seen)}, d));\nprocess.stdin.on("end", () => process.exit(0));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(home, "state.json"), JSON.stringify({ active: {}, binaryPaths: { claude: fake } }));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString("base64");
  const input = [
    { cmd: "send", text: "look", attachments: [{ image: { mediaType: "image/png", data: png } }, { file: { name: "notes.txt", data: Buffer.from("hi").toString("base64") } }, { path: path.join(repo, "a.txt") }] },
    { cmd: "set-model", model: "sonnet" },
    { cmd: "set-mode", mode: "plan" },
    { cmd: "set-mode", mode: "bypassPermissions" },
    { cmd: "approve", id: "nope" },
    { cmd: "interrupt" },
    { cmd: "close" },
  ]
    .map((c) => JSON.stringify(c))
    .join("\n") + "\n";
  const r = spawnSync(process.execPath, [CLI, "bridge", ID, "--mode", "acceptEdits"], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8", input, timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(out[0], { bridge: "ready", key: `claude/work/${ID}`, mode: "acceptEdits" });
  assert.ok(out.some((o) => o.bridge === "error" && /no open approval nope/.test(o.message)));
  assert.ok(out.some((o) => o.bridge === "error" && /bypassPermissions|mode/.test(o.message)), "a bypass mode is refused");
  assert.ok(out.some((o) => o.bridge === "exit"));
  const toAgent = fs.readFileSync(seen, "utf8");
  assert.match(toAgent, /"type":"image"/);
  assert.match(toAgent, /@a\.txt/);
  assert.match(toAgent, /notes\.txt/);
  assert.match(toAgent, /"subtype":"set_model"/);
  assert.match(toAgent, /"subtype":"set_permission_mode"/);
  assert.match(toAgent, /"subtype":"interrupt"/);
  assert.equal(run("bridge", ID, "--mode", "bypassPermissions").status !== 0, true, "never bypasses approvals");
});
