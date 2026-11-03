/**
 * Codex app-server items → AS events. `thread/read` returns turns of typed
 * items (spike C3); the live `item/*` notifications carry the same item shapes.
 */

import { countHunks, parseUnifiedDiff, type AsEvent } from "./events.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const short = (s: string, n = 120) => {
  const l = s.trim().split("\n")[0] ?? "";
  return l.length > n ? `${l.slice(0, n - 1)}…` : l;
};

/** One Codex thread item → events. */
export function fromCodexItem(item: unknown, at: string | null = null): AsEvent[] {
  const i = obj(item);
  const id = str(i.id);
  switch (str(i.type)) {
    case "userMessage": {
      const parts = arr(i.content).map(obj);
      const text = parts.filter((p) => p.type === "text").map((p) => str(p.text)).join("\n");
      const images = parts.filter((p) => p.type === "image" || p.type === "localImage").length;
      return [{ t: "turn", id, at }, { t: "message", id, role: "user", text, images }];
    }
    case "agentMessage":
      return [{ t: "message", id, role: "assistant", text: str(i.text), images: 0 }];
    case "reasoning":
      return [{ t: "thinking", id }];
    case "plan":
      return [{ t: "plan", id, text: str(i.text) }];
    case "commandExecution": {
      const status = str(i.status);
      const out: AsEvent[] = [{ t: "tool.started", id, name: "Bash", summary: short(str(i.command), 80), input: { command: str(i.command) }, parentToolId: null }];
      if (status !== "inProgress") out.push({ t: "tool.finished", id, ok: status === "completed" && (i.exitCode === 0 || i.exitCode === undefined), summary: short(str(i.aggregatedOutput)) });
      return out;
    }
    case "fileChange": {
      const changes = arr(i.changes).map(obj);
      const out: AsEvent[] = [{ t: "tool.started", id, name: "Edit", summary: changes.map((c) => str(c.path)).join(", "), input: {}, parentToolId: null }];
      let added = 0;
      let removed = 0;
      for (const c of changes) {
        const hunks = parseUnifiedDiff(str(c.diff));
        const n = countHunks(hunks);
        added += n.added;
        removed += n.removed;
        out.push({ t: "diff", toolId: id, path: str(c.path), added: n.added, removed: n.removed, hunks });
      }
      const status = str(i.status);
      if (status !== "inProgress") out.push({ t: "tool.finished", id, ok: status === "completed", summary: `+${added} −${removed}` });
      return out;
    }
    case "mcpToolCall":
    case "dynamicToolCall": {
      const name = `${str(i.server) || str(i.namespace)}${str(i.server) || str(i.namespace) ? "." : ""}${str(i.tool)}`;
      const status = str(i.status);
      const out: AsEvent[] = [{ t: "tool.started", id, name, summary: short(JSON.stringify(i.arguments ?? {}), 80), input: obj(i.arguments), parentToolId: null }];
      if (status && status !== "inProgress") out.push({ t: "tool.finished", id, ok: status === "completed" && !i.error, summary: short(str(obj(i.error).message)) });
      return out;
    }
    case "webSearch":
      return [{ t: "tool.started", id, name: "WebSearch", summary: str(i.query), input: { query: str(i.query) }, parentToolId: null }];
    case "collabAgentToolCall":
    case "subAgentActivity":
      return [{ t: "subagent.started", id, type: str(i.kind) || str(i.tool) || "agent", description: short(str(i.prompt) || str(i.agentPath), 80) }];
    default:
      return [{ t: "unknown", kind: `codex:${str(i.type) || "item"}` }];
  }
}

/** A `thread/read` result (with turns) → events. */
export function fromCodexThread(result: unknown): AsEvent[] {
  const thread = obj(obj(result).thread);
  const out: AsEvent[] = [];
  for (const turn of arr(thread.turns).map(obj)) {
    const at = typeof turn.startedAt === "number" ? new Date(turn.startedAt * 1000).toISOString() : str(turn.startedAt) || null;
    for (const item of arr(turn.items)) out.push(...fromCodexItem(item, at));
    const status = str(turn.status);
    if (status && status !== "inProgress") {
      if (turn.error) out.push({ t: "error", message: str(obj(turn.error).message) || "the turn failed" });
      out.push({ t: "turn.end", ok: status === "completed", durationMs: typeof turn.durationMs === "number" ? turn.durationMs : null, costUsd: null });
    }
  }
  return out;
}
