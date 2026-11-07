import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { acLinkWired, chatHint, chatHookInstalled, withChatHook, withoutChatHook } from "../src/chat-hint.js";
import type { SwitchRequest } from "../src/link/requests.js";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

function req(over: Partial<SwitchRequest> = {}): SwitchRequest {
  return {
    v: 1, id: "abc123", rev: 1, session: "claude/work/s1", account: "claude/work",
    reason: { kind: "pace", window: "seven_day", fill: 60, resetsAt: iso(48), etaFull: 6, burnPerHour: 6 },
    raisedBy: "as-daemon", raisedAt: iso(-1), expiresAt: iso(48), state: "open",
    candidates: [{ target: "claude/home", provider: "claude", fill: 10, resetsAt: iso(100), how: ["after-turn", "now"], spareAtReset: 80 }],
    ...over,
  };
}
const base = { session: "claude/work/s1", linkConnected: false, paceOn: true, now: NOW };

test("an open request for this session → one context line with the summary and the decide command", () => {
  const line = chatHint({ ...base, requests: [req()] });
  assert.ok(line);
  assert.equal(line.split("\n").length, 1);
  assert.match(line, /claude\/work runs out in about 6 h/);
  assert.match(line, /agent-switch switch decide abc123 approve --to claude\/home/);
  assert.match(line, /never decide for the user/);
});

test("agent-config connected → nothing (it speaks for the request)", () => {
  assert.equal(chatHint({ ...base, linkConnected: true, requests: [req()] }), null);
});

test("no request, another session's, or a closed one → nothing", () => {
  assert.equal(chatHint({ ...base, requests: [] }), null);
  assert.equal(chatHint({ ...base, requests: [req({ session: "claude/work/other" })] }), null);
  assert.equal(chatHint({ ...base, requests: [req({ state: "declined" })] }), null);
});

test("pace off hides pace requests; a limit request still shows and comes first", () => {
  assert.equal(chatHint({ ...base, paceOn: false, requests: [req()] }), null);
  const limit = req({ id: "lim1", reason: { window: "five_hour", fill: 93, resetsAt: iso(2) } });
  assert.match(chatHint({ ...base, paceOn: false, requests: [req(), limit] })!, /lim1/);
  assert.match(chatHint({ ...base, requests: [req(), limit] })!, /lim1/);
});

test("the prompt hook installs once, keeps the user's own, and removes only itself", () => {
  const user = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "mine" }] }] }, theme: "dark" };
  const on = withChatHook(withChatHook(user));
  assert.equal(on.hooks.UserPromptSubmit.length, 2);
  assert.ok(chatHookInstalled(on));
  const off = withoutChatHook(on);
  assert.deepEqual(off, user);
  assert.deepEqual(withoutChatHook(withChatHook({})), {});
});

test("agent-config wiring is found in the profile's user scope, its folder entry, or the folder's .mcp.json", () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "asw-chat-cfg-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "asw-chat-cwd-"));
  const server = { command: "agent-switch", args: ["mcp", "serve"] };
  assert.equal(acLinkWired(cfg, cwd), false);
  fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ projects: { [cwd]: { mcpServers: { "agent-switch": server } } } }));
  assert.equal(acLinkWired(cfg, cwd), true);
  assert.equal(acLinkWired(cfg, "/elsewhere"), false);
  fs.writeFileSync(path.join(cfg, ".claude.json"), JSON.stringify({ mcpServers: { as: { command: "/usr/local/bin/agent-switch", args: ["mcp", "serve"] } } }));
  assert.equal(acLinkWired(cfg, null), true);
  fs.rmSync(path.join(cfg, ".claude.json"));
  fs.writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { x: server } }));
  assert.equal(acLinkWired(cfg, cwd), true);
});

// The built CLI as Claude Code runs the hook.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

test("`__chat-hint` never blocks: garbage, no profile, or an open request all exit 0", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-chat-home-"));
  const cfg = path.join(home, "claude", "work", "config");
  fs.mkdirSync(cfg, { recursive: true });
  const env = { ...process.env, AGENT_SWITCH_HOME: home, CLAUDE_CONFIG_DIR: cfg };
  const run = (input: string, e = env) => spawnSync("node", [CLI, "__chat-hint"], { input, env: e, encoding: "utf8" });
  assert.equal(run("not json").status, 0);
  assert.equal(run("not json").stdout, "");
  assert.equal(run(JSON.stringify({ session_id: "s1" }), { ...env, CLAUDE_CONFIG_DIR: "" }).status, 0);
  assert.equal(run(JSON.stringify({ session_id: "s1", cwd: home })).stdout, "", "no request → nothing");

  const dir = path.join(home, "switch-requests");
  fs.mkdirSync(dir, { recursive: true });
  const r = req({ expiresAt: new Date(Date.now() + 3_600_000).toISOString(), reason: { kind: "pace", window: "seven_day", fill: 60, resetsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), etaFull: 6, burnPerHour: 6 } });
  fs.writeFileSync(path.join(dir, `${r.id}.json`), JSON.stringify(r));
  const out = run(JSON.stringify({ session_id: "s1", cwd: home }));
  assert.equal(out.status, 0);
  assert.match(out.stdout, /\[Agent Switch\] claude\/work runs out/);
});
