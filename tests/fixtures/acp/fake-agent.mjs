#!/usr/bin/env node
// A scripted ACP agent for the e2e test: protocol v1 over stdio, one session,
// each prompt asks one permission and echoes the answer. No network, no model.
import * as readline from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const asked = new Map();
let next = 100;
const ask = (method, params) => new Promise((r) => { const id = ++next; asked.set(id, r); send({ id, method, params }); });
const update = (u) => send({ method: "session/update", params: { sessionId: "fake-1", update: u } });
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) return asked.get(m.id)?.(m);
  if (m.method === "initialize") return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, agentInfo: { name: "fake", version: "0.0.1" } } });
  if (m.method === "session/new") return send({ id: m.id, result: { sessionId: "fake-1" } });
  if (m.method === "session/load") { update({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "earlier" } }); return send({ id: m.id, result: {} }); }
  if (m.method === "session/prompt") {
    update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "touch x", kind: "execute", status: "pending" });
    const r = await ask("session/request_permission", { sessionId: "fake-1", toolCall: { toolCallId: "t1", title: "touch x", kind: "execute" }, options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }] });
    const picked = r.result?.outcome?.optionId ?? "cancelled";
    update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: picked === "ok" ? "completed" : "failed" });
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `you picked ${picked}` } });
    return send({ id: m.id, result: { stopReason: "end_turn" } });
  }
});
