import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpHandler, type McpDeps, type Rpc } from "../src/link/mcp.js";
import { RequestStore } from "../src/link/requests.js";

const T0 = Date.parse("2026-11-05T12:00:00Z");

function deps(over: Partial<McpDeps> = {}): McpDeps {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-mcp-"));
  const store = new RequestStore(dir, () => T0);
  return {
    version: "9.9.9",
    now: () => T0,
    enabled: () => true,
    status: () => ({ enabled: true, contract: 1 }),
    limits: () => ({ v: 1, at: new Date(T0).toISOString(), accounts: [] }),
    whoami: () => ({ account: "claude/work", session: "claude/work/sid-1", source: "CLAUDE_CONFIG_DIR" }),
    store: () => store,
    request: (s, a) =>
      s.raise({
        account: a.account ?? a.session!.split("/").slice(0, 2).join("/"),
        session: a.session ?? null,
        reason: { window: "five_hour", fill: 91, resetsAt: new Date(T0 + 3_600_000).toISOString() },
        raisedBy: a.raisedBy,
        candidates: [{ target: "claude/home", provider: "claude", fill: 5, resetsAt: null, how: ["after-turn", "now"] }],
      }),
    decide: (s, a) => s.decide(a.id, a.decision === "approve" ? { kind: "approve", target: a.target ?? "claude/home", how: a.how ?? "after-turn", by: a.by } : { kind: a.decision, by: a.by }),
    ...over,
  };
}

const call = (h: (m: Rpc) => unknown, id: number, name: string, args: Record<string, unknown> = {}) =>
  h({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) as { result: { isError: boolean; structuredContent: any; content: { text: string }[] } };

test("initialize echoes a supported protocol version and names the server", () => {
  const h = createMcpHandler(deps());
  const r = h({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", clientInfo: { name: "claude-code" } } }) as any;
  assert.equal(r.result.protocolVersion, "2025-03-26");
  assert.deepEqual(r.result.serverInfo, { name: "agent-switch", version: "9.9.9" });
  assert.ok(r.result.capabilities.tools);
  const unknown = h({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }) as any;
  assert.equal(unknown.result.protocolVersion, "2025-06-18");
});

test("notifications get no answer; unknown methods get -32601", () => {
  const h = createMcpHandler(deps());
  assert.equal(h({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal((h({ jsonrpc: "2.0", id: 3, method: "resources/list" }) as any).error.code, -32601);
  assert.equal((h({ jsonrpc: "1.0", id: 4, method: "ping" }) as any).error.code, -32600);
});

test("tools/list offers the seven tools; only reads are read-only", () => {
  const h = createMcpHandler(deps());
  const tools = (h({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as any).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
  assert.deepEqual(tools.map((t) => t.name).sort(), ["limits_get", "link_status", "session_whoami", "switch_decide", "switch_list", "switch_request", "switch_status"]);
  const writes = tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort();
  assert.deepEqual(writes, ["switch_decide", "switch_request"]);
});

test("with the link off: no tools, and a call is refused", () => {
  const h = createMcpHandler(deps({ enabled: () => false }));
  assert.deepEqual((h({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as any).result.tools, []);
  const r = call(h, 2, "limits_get");
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /link is off/);
});

test("switch_request without arguments asks for this session; switch_decide records the client as decider", () => {
  const h = createMcpHandler(deps());
  h({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-code" } } });
  const raised = call(h, 2, "switch_request");
  assert.equal(raised.result.isError, false);
  assert.equal(raised.result.structuredContent.request.session, "claude/work/sid-1");
  assert.equal(raised.result.structuredContent.request.raisedBy, "ac");
  const id = raised.result.structuredContent.request.id;
  const decided = call(h, 3, "switch_decide", { id, decision: "approve" });
  assert.equal(decided.result.structuredContent.applied, true);
  assert.equal(decided.result.structuredContent.request.decision.by, "ac:claude-code");
  const again = call(h, 4, "switch_decide", { id, decision: "decline" });
  assert.equal(again.result.structuredContent.applied, false);
  const list = call(h, 5, "switch_list");
  assert.equal(list.result.structuredContent.items[0].state, "approved");
});

test("switch_list filters by session and hands out kind and a plain summary", () => {
  const d = deps();
  const store = d.store();
  const resetsAt = new Date(T0 + 48 * 3_600_000).toISOString();
  const cand = [{ target: "claude/home", provider: "claude" as const, fill: 5, resetsAt: null, how: ["after-turn" as const, "now" as const], spareAtReset: 80 }];
  store.raise({ account: "claude/work", session: "claude/work/sid-1", reason: { kind: "pace", window: "seven_day", fill: 60, resetsAt, etaFull: 6, burnPerHour: 6 }, raisedBy: "as-daemon", candidates: cand });
  store.raise({ account: "claude/work", session: "claude/work/sid-2", reason: { window: "five_hour", fill: 93, resetsAt }, raisedBy: "as-daemon", candidates: cand });
  store.raise({ account: "codex/cx", session: null, reason: { window: "five_hour", fill: 93, resetsAt }, raisedBy: "as-daemon", candidates: cand });
  const h = createMcpHandler(d);
  const mine = call(h, 1, "switch_list", { session: "claude/work/sid-1" }).result.structuredContent.items;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, "pace");
  assert.match(mine[0].summary, /claude\/work runs out in about 6 h, but its weekly limit resets only in 2 d\. claude\/home would let 80% expire/);
  const all = call(h, 2, "switch_list").result.structuredContent.items;
  assert.deepEqual(all.map((r: { kind: string }) => r.kind).sort(), ["limit", "limit", "pace"]);
  assert.match(all.find((r: { session: string | null }) => r.session === "claude/work/sid-2").summary, /is at 93% of its 5-hour limit/);
  const codex = call(h, 3, "switch_list", { session: "codex/cx/abc" }).result.structuredContent.items;
  assert.equal(codex.length, 1, "an account-level request concerns every session on that account");
  const one = call(h, 4, "switch_status", { id: mine[0].id }).result.structuredContent;
  assert.equal(one.kind, "pace");
  assert.ok(one.summary);
});

test("a tool error is a result with isError, not a protocol error", () => {
  const h = createMcpHandler(deps());
  const r = call(h, 1, "switch_status", { id: "nope" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /no switch request nope/);
  assert.equal(call(h, 2, "switch_decide", {}).result.isError, true);
  assert.equal((h({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rm_rf" } }) as any).error.code, -32602);
});

// The built server over real stdio, the way a host starts it.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

async function session(home: string, lines: object[]): Promise<any[]> {
  const child = spawn("node", [CLI, "mcp", "serve"], { env: { ...process.env, AGENT_SWITCH_HOME: home, CLAUDE_CONFIG_DIR: "", CODEX_HOME: "", AGENT_SWITCH_HOST_PANE: "" }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  for (const l of lines) child.stdin.write(JSON.stringify(l) + "\n");
  child.stdin.write("not json\n");
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
  return out.trim().split("\n").map((l) => JSON.parse(l));
}

test("`mcp serve` answers a full handshake over stdio and honours `link off`", gate, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-mcpserve-"));
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "test" }, capabilities: {} } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "link_status", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "limits_get", arguments: {} } },
  ];
  const on = await session(home, msgs);
  assert.deepEqual(on.map((m) => m.id), [1, 2, 3, 4, null]);
  assert.equal(on[1].result.tools.length, 7);
  assert.equal(on[2].result.structuredContent.contract, 2);
  assert.ok(Array.isArray(on[3].result.structuredContent.accounts));
  assert.equal(on[3].result.structuredContent.v, 1);
  assert.equal(on[4].error.code, -32700);

  const { execFileSync } = await import("node:child_process");
  execFileSync("node", [CLI, "link", "off"], { env: { ...process.env, AGENT_SWITCH_HOME: home } });
  const off = await session(home, msgs.slice(0, 3));
  assert.deepEqual(off[1].result.tools, []);
});
