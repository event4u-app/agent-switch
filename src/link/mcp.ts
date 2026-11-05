/**
 * `agent-switch mcp serve` — the local MCP server agent-config connects to
 * (road-to-the-agent-config-link). Pure Node, no SDK: JSON-RPC 2.0, one message
 * per line on stdin/stdout, logs on stderr only.
 *
 * Stdio means the host starts it as a child of the agent's own process, as the
 * same user: no port, nothing listening, no token. The "Let agent-config
 * connect" setting is read on every request — off, the server answers but
 * offers no tools.
 *
 * Tools read limits and raise or decide switch requests. None moves a session.
 * `switch_decide` records the USER's decision; it is marked non-read-only so a
 * host asks before calling it, and agent-config never auto-allows it.
 */

import type { LimitsReport } from "./limits.js";
import type { RequestStore, SwitchRequest } from "./requests.js";
import type { DecideArgs, RequestArgs } from "./ops.js";
import type { MoveHow } from "./requests.js";

export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface McpDeps {
  version: string;
  enabled: () => boolean;
  status: () => unknown;
  limits: (provider?: string) => LimitsReport;
  whoami: () => { account: string | null; session: string | null; source: string };
  store: () => RequestStore;
  request: (store: RequestStore, a: RequestArgs) => { request: SwitchRequest; created: boolean };
  decide: (store: RequestStore, a: DecideArgs) => { request: SwitchRequest; applied: boolean };
}

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
  call: (args: Json, client: string) => unknown;
}

const READ = { readOnlyHint: true, openWorldHint: false };
const obj = (properties: Json = {}, required: string[] = []): Json => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string, extra: Json = {}): Json => ({ type: "string", description, ...extra });

function tools(d: McpDeps): Tool[] {
  const need = (args: Json, k: string): string => {
    const v = args[k];
    if (typeof v !== "string" || !v) throw new Error(`"${k}" is required`);
    return v;
  };
  const opt = (args: Json, k: string): string | undefined => (typeof args[k] === "string" && args[k] ? (args[k] as string) : undefined);
  return [
    {
      name: "link_status",
      title: "Link status",
      description: "Whether this agent-switch lets agent-config connect, its version and the link contract version.",
      inputSchema: obj(),
      annotations: READ,
      call: () => d.status(),
    },
    {
      name: "limits_get",
      title: "Account limits",
      description:
        "Every account's 5-hour and weekly limits from agent-switch's cache: fill per window, reset time, whether the account can take work now (usable) and why not, and whether the numbers are stale. Observations, not reservations. No network.",
      inputSchema: obj({ provider: str("Only this provider: claude, codex or antigravity.", { enum: ["claude", "codex", "antigravity"] }) }),
      annotations: READ,
      call: (a) => d.limits(opt(a, "provider")),
    },
    {
      name: "session_whoami",
      title: "This session",
      description: "The account (provider/name) and, when knowable, the session key (provider/account/sessionId) of the agent that started this server.",
      inputSchema: obj(),
      annotations: READ,
      call: () => d.whoami(),
    },
    {
      name: "switch_list",
      title: "Switch requests",
      description: "Open switch requests (or all with all=true): which session or account is near its limit, the accounts it could move to, and any decision or outcome.",
      inputSchema: obj({ all: { type: "boolean", description: "Include decided, finished and expired requests." } }),
      annotations: READ,
      call: (a) => d.store().list().filter((r) => a.all === true || ["open", "approved", "executing"].includes(r.state)),
    },
    {
      name: "switch_status",
      title: "Switch request",
      description: "One switch request with its decision and outcome. An outcome's `resume` is the command that opens the moved work when it could not open by itself.",
      inputSchema: obj({ id: str("The request id.") }, ["id"]),
      annotations: READ,
      call: (a) => d.store().get(need(a, "id")) ?? (() => { throw new Error(`no switch request ${String(a.id)}`); })(),
    },
    {
      name: "switch_request",
      title: "Ask to switch",
      description:
        "Ask the user to move work off an account that is near its limit: opens (or returns) a switch request that also shows in the Agent Switch app. Moves nothing. Give the session key, or the account for whatever runs on it; omit both for this session.",
      inputSchema: obj({ session: str("provider/account/sessionId"), account: str("provider/name") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      call: (a) => {
        let session = opt(a, "session") ?? null;
        let account = opt(a, "account");
        if (!session && !account) {
          const me = d.whoami();
          session = me.session;
          account = me.account ?? undefined;
          if (!account) throw new Error("this session's account is unknown — pass session or account");
        }
        return d.request(d.store(), { session, account, raisedBy: "ac" });
      },
    },
    {
      name: "switch_decide",
      title: "Record the user's decision",
      description:
        "Record the USER's answer to a switch request — call only after the user chose. approve moves the work to `target` (default: the first candidate) by `how` (default: the candidate's first move); decline or snooze keep it here. The first decision, here or in the Agent Switch app, counts; a later one returns the existing decision unchanged. Agent Switch carries out an approval.",
      inputSchema: obj(
        {
          id: str("The request id."),
          decision: str("approve, decline or snooze", { enum: ["approve", "decline", "snooze"] }),
          target: str("approve: provider/name of a candidate"),
          how: str("approve: after-turn, now or handoff", { enum: ["after-turn", "now", "handoff"] }),
        },
        ["id", "decision"],
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      call: (a, client) =>
        d.decide(d.store(), {
          id: need(a, "id"),
          decision: need(a, "decision") as DecideArgs["decision"],
          target: opt(a, "target"),
          how: opt(a, "how") as MoveHow | undefined,
          by: `ac:${client}`,
        }),
    },
  ];
}

export interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

const reply = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One server's state across messages: the client's name, for `decision.by`. */
export function createMcpHandler(d: McpDeps): (msg: Rpc) => Json | null {
  let client = "mcp";
  const list = tools(d);
  return (msg) => {
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isRequest ? fail(msg.id, -32600, "invalid request") : null;
    if (!isRequest) return null; // notifications (initialized, cancelled) need no answer
    const p = msg.params ?? {};
    switch (msg.method) {
      case "initialize": {
        const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
        const info = p.clientInfo as { name?: unknown } | undefined;
        if (info && typeof info.name === "string" && /^[\w.-]{1,40}$/.test(info.name)) client = info.name;
        return reply(msg.id, {
          protocolVersion: (PROTOCOLS as readonly string[]).includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agent-switch", version: d.version },
          instructions:
            "Agent Switch holds the user's AI accounts and their limits. Read limits with limits_get. When a session nears its limit, open a switch request (switch_request), tell the user the candidates, and record their answer with switch_decide — never decide for them. Agent Switch moves the work; nothing here moves it.",
        });
      }
      case "ping":
        return reply(msg.id, {});
      case "tools/list":
        return reply(msg.id, {
          tools: d.enabled() ? list.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) : [],
        });
      case "tools/call": {
        const name = typeof p.name === "string" ? p.name : "";
        const tool = list.find((t) => t.name === name);
        if (!tool) return fail(msg.id, -32602, `unknown tool: ${name}`);
        if (!d.enabled()) return reply(msg.id, { content: [{ type: "text", text: "The agent-config link is off in Agent Switch (`agent-switch link on` turns it back on)." }], isError: true });
        try {
          const result = tool.call((p.arguments as Json) ?? {}, client);
          return reply(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: Array.isArray(result) ? { items: result } : result, isError: false });
        } catch (e) {
          return reply(msg.id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
        }
      }
      default:
        return fail(msg.id, -32601, `method not found: ${msg.method}`);
    }
  };
}

/** Serve on stdin/stdout until stdin closes. */
export async function serveStdio(handle: (msg: Rpc) => Json | null): Promise<void> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: Rpc;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify(fail(null, -32700, "parse error")) + "\n");
      continue;
    }
    const res = handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  }
}
