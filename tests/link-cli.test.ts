import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The built CLI, as agent-config calls it: `limits --json`, `switch … --json`.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function home(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "asw-linkcli-"));
  const account = (provider: string, name: string, fills: number[]) => {
    const dir = path.join(h, provider, name, "config");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, provider === "claude" ? ".claude.json" : "auth.json"), "{}");
    const windows = fills.map((u, k) => ({ key: k ? "seven_day" : "five_hour", label: "", utilization: u, resetsAt: new Date(Date.now() + (k ? 72 : 2) * 3_600_000).toISOString() }));
    fs.writeFileSync(path.join(h, provider, name, "usage-latest.json"), JSON.stringify({ windows, routines: null, capturedAt: new Date().toISOString() }));
  };
  account("claude", "work", [93, 40]);
  account("claude", "home", [10, 20]);
  account("codex", "cx", [5, 5]);
  return h;
}

const run = (h: string, args: string[]) =>
  JSON.parse(execFileSync("node", [CLI, ...args, "--json"], { env: { ...process.env, AGENT_SWITCH_HOME: h }, encoding: "utf8" }));
const fail = (h: string, args: string[]) => spawnSync("node", [CLI, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: h }, encoding: "utf8" });

test("limits --json reports every account with schema 1", gate, () => {
  const h = home();
  const r = run(h, ["limits"]);
  assert.equal(r.v, 1);
  assert.deepEqual(r.accounts.map((a: { id: string; usable: boolean }) => [a.id, a.usable]), [["claude/home", true], ["claude/work", true], ["codex/cx", true]]);
});

test("switch request → decide in one front door → the other reads the decision", gate, () => {
  const h = home();
  const raised = run(h, ["switch", "request", "--session", "claude/work/sid-1", "--by", "ac"]);
  assert.equal(raised.created, true);
  assert.equal(raised.request.raisedBy, "ac");
  assert.equal(raised.request.reason.fill, 93);
  assert.deepEqual(raised.request.candidates.map((c: { target: string }) => c.target), ["claude/home", "codex/cx"]);
  const id = raised.request.id;

  assert.equal(run(h, ["switch", "request", "--session", "claude/work/sid-1"]).created, false, "raising again returns the same request");
  assert.equal(run(h, ["switch", "list"]).length, 1);

  const first = run(h, ["switch", "decide", id, "approve", "--by", "ac:claude"]);
  assert.equal(first.applied, true);
  assert.equal(first.request.decision.target, "claude/home");
  assert.equal(first.request.decision.how, "after-turn");

  const second = run(h, ["switch", "decide", id, "decline", "--by", "as-gui"]);
  assert.equal(second.applied, false);
  assert.equal(second.request.state, "approved");
  assert.equal(run(h, ["switch", "show", id]).decision.by, "ac:claude");
});

test("bad input fails with one sentence and a non-zero exit", gate, () => {
  const h = home();
  const r1 = fail(h, ["switch", "request", "--account", "claude/nobody"]);
  assert.notEqual(r1.status, 0);
  assert.match(r1.stderr, /no such account/);
  const r2 = fail(h, ["switch", "request", "--session", "claude/work"]);
  assert.match(r2.stderr, /not a session key/);
  const r3 = fail(h, ["switch", "decide", "nope", "maybe"]);
  assert.match(r3.stderr, /usage: agent-switch switch/);
});
