/** AS events (the CLI's `timeline --json` / `bridge` output) → the rows the chat
 *  view draws (spec §10.8). Pure, so a whole session can be folded in a test. */

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

/** Mirrors `src/timeline/events.ts` (the CLI owns the model; the GUI reads it). */
export type AsEvent =
  | { t: "turn"; id: string; at: string | null }
  | { t: "message"; id: string; role: "user" | "assistant"; text: string; images: number }
  | { t: "message.delta"; id: string; text: string }
  | { t: "thinking"; id: string }
  | { t: "tool.started"; id: string; name: string; summary: string; input: Record<string, unknown>; parentToolId: string | null }
  | { t: "tool.finished"; id: string; ok: boolean; summary: string }
  | { t: "diff"; toolId: string; path: string; added: number; removed: number; hunks: DiffHunk[] }
  | { t: "plan"; id: string; text: string }
  | { t: "approval.requested"; id: string; tool: string; summary: string; input: Record<string, unknown> }
  | { t: "approval.resolved"; id: string; decision: "allow" | "deny" }
  | { t: "question.requested"; id: string; questions: { question: string; options: string[] }[] }
  | { t: "subagent.started"; id: string; type: string; description: string }
  | { t: "subagent.finished"; id: string; ok: boolean; agentId?: string }
  | { t: "limits"; status: string; resetsAt: string | null }
  | { t: "turn.end"; ok: boolean; durationMs: number | null; costUsd: number | null }
  | { t: "error"; message: string }
  | { t: "unknown"; kind: string };

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

export type ChatRow =
  | { k: "user"; id: string; text: string; images: number }
  | { k: "assistant"; id: string; text: string; live: boolean }
  | { k: "tool"; id: string; name: string; summary: string; state: "running" | "ok" | "failed"; result: string | null; diffs: FileDiff[] }
  | { k: "subagent"; id: string; type: string; description: string; state: "running" | "ok" | "failed"; agentId: string | null }
  | { k: "approval"; id: string; tool: string; summary: string; resolved: "allow" | "deny" | null }
  | { k: "question"; id: string; questions: { question: string; options: string[] }[] }
  | { k: "plan"; id: string; text: string }
  | { k: "error"; id: string; message: string };

export interface Folded {
  rows: ChatRow[];
  /** The last turn has not ended in these events. A transcript never records a
   *  turn's end, so for history this is only true when the caller knows the
   *  session is live (a bridge reports `turn.end`). */
  running: boolean;
  /** Lines the view does not draw (bookkeeping, unknown kinds), by kind. */
  hidden: Record<string, number>;
  limits: { status: string; resetsAt: string | null } | null;
  lastTurn: { ok: boolean; durationMs: number | null; costUsd: number | null } | null;
}

const SUBAGENT = new Set(["Agent", "Task"]);

/** Fold events in order into rows. Pure. */
export function fold(events: readonly AsEvent[]): Folded {
  const rows: ChatRow[] = [];
  const at = new Map<string, number>();
  const hidden: Record<string, number> = {};
  let live: number | null = null;
  let running = false;
  let limits: Folded["limits"] = null;
  let lastTurn: Folded["lastTurn"] = null;
  let n = 0;
  const push = (r: ChatRow) => {
    at.set(`${r.k}:${r.id}`, rows.length);
    rows.push(r);
  };
  const get = <K extends ChatRow["k"]>(k: K, id: string) => {
    const i = at.get(`${k}:${id}`);
    return i === undefined ? undefined : (rows[i] as Extract<ChatRow, { k: K }>);
  };
  for (const e of events) {
    switch (e.t) {
      case "turn":
        running = true;
        live = null;
        break;
      case "message":
        if (e.role === "user") push({ k: "user", id: e.id, text: e.text, images: e.images });
        else if (live !== null) {
          // The complete message replaces what streamed in for it.
          const r = rows[live] as Extract<ChatRow, { k: "assistant" }>;
          rows[live] = { ...r, text: e.text, live: false };
          live = null;
        } else push({ k: "assistant", id: e.id, text: e.text, live: false });
        break;
      case "message.delta":
        if (live !== null && rows[live].id === e.id) {
          const r = rows[live] as Extract<ChatRow, { k: "assistant" }>;
          rows[live] = { ...r, text: r.text + e.text };
        } else {
          push({ k: "assistant", id: e.id, text: e.text, live: true });
          live = rows.length - 1;
        }
        break;
      case "tool.started":
        live = null;
        if (SUBAGENT.has(e.name)) break; // drawn as its subagent row
        push({ k: "tool", id: e.id, name: e.name, summary: e.summary, state: "running", result: null, diffs: [] });
        break;
      case "tool.finished": {
        const r = get("tool", e.id);
        if (r) rows[at.get(`tool:${e.id}`)!] = { ...r, state: e.ok ? "ok" : "failed", result: e.summary || null };
        break;
      }
      case "diff": {
        const r = get("tool", e.toolId);
        if (r) rows[at.get(`tool:${e.toolId}`)!] = { ...r, diffs: [...r.diffs, { path: e.path, added: e.added, removed: e.removed, hunks: e.hunks }] };
        break;
      }
      case "subagent.started":
        push({ k: "subagent", id: e.id, type: e.type, description: e.description, state: "running", agentId: null });
        break;
      case "subagent.finished": {
        const r = get("subagent", e.id);
        if (r) rows[at.get(`subagent:${e.id}`)!] = { ...r, state: e.ok ? "ok" : "failed", agentId: e.agentId ?? r.agentId };
        break;
      }
      case "approval.requested":
        push({ k: "approval", id: e.id, tool: e.tool, summary: e.summary, resolved: null });
        break;
      case "approval.resolved": {
        const r = get("approval", e.id);
        if (r) rows[at.get(`approval:${e.id}`)!] = { ...r, resolved: e.decision };
        break;
      }
      case "question.requested":
        push({ k: "question", id: e.id, questions: e.questions });
        break;
      case "plan":
        push({ k: "plan", id: e.id, text: e.text });
        break;
      case "error":
        push({ k: "error", id: `e${n++}`, message: e.message });
        break;
      case "turn.end":
        running = false;
        live = null;
        lastTurn = { ok: e.ok, durationMs: e.durationMs, costUsd: e.costUsd };
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if ((r.k === "tool" || r.k === "subagent") && r.state === "running") rows[i] = { ...r, state: e.ok ? "ok" : "failed" };
          if (r.k === "assistant" && r.live) rows[i] = { ...r, live: false };
        }
        break;
      case "limits":
        limits = { status: e.status, resetsAt: e.resetsAt };
        break;
      case "thinking":
        break;
      case "unknown":
        hidden[e.kind] = (hidden[e.kind] ?? 0) + 1;
        break;
    }
  }
  return { rows, running, hidden, limits, lastTurn };
}

/** The open approvals, newest last. Pure. */
export const openApprovals = (rows: readonly ChatRow[]) => rows.filter((r): r is Extract<ChatRow, { k: "approval" }> => r.k === "approval" && r.resolved === null);
