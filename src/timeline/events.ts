/**
 * The Agent Switch event model v1: one shape for a session's timeline, whatever
 * agent produced it (road-to-agent-switch-v3-client Phase 1). Claude transcripts,
 * Claude stream-json and Codex app-server items all map onto it; the chat view
 * renders only these events.
 *
 * Nothing is dropped: a line or item the mapper does not know becomes an
 * `unknown` event carrying its kind.
 */

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  /** Unified-diff lines, each starting with " ", "+" or "-". */
  lines: string[];
}

export type AsEvent =
  /** A user prompt starts a turn. */
  | { t: "turn"; id: string; at: string | null }
  | { t: "message"; id: string; role: "user" | "assistant"; text: string; images: number }
  /** Live only: text arriving for message `id` before it is complete. */
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
  | { t: "subagent.finished"; id: string; ok: boolean }
  | { t: "limits"; status: string; resetsAt: string | null }
  | { t: "turn.end"; ok: boolean; durationMs: number | null; costUsd: number | null }
  | { t: "error"; message: string }
  | { t: "unknown"; kind: string };

export type AsEventType = AsEvent["t"];

/** Count added and removed lines of unified hunks. Pure. */
export function countHunks(hunks: readonly DiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) for (const l of h.lines) l.startsWith("+") ? added++ : l.startsWith("-") && removed++;
  return { added, removed };
}

/** A unified diff text (`@@ -a,b +c,d @@` headers) → hunks. Pure. */
export function parseUnifiedDiff(text: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  for (const line of text.split("\n")) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      cur = { oldStart: Number(m[1]), newStart: Number(m[2]), lines: [] };
      hunks.push(cur);
    } else if (cur && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) cur.lines.push(line);
  }
  return hunks;
}

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One line saying what a tool call does, for the collapsed tool card. Pure. */
export function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return str(input.file_path) || str(input.notebook_path);
    case "Bash":
      return short(str(input.command));
    case "Glob":
    case "Grep":
      return short(`${str(input.pattern)}${input.path ? ` in ${str(input.path)}` : ""}`);
    case "WebFetch":
      return short(str(input.url));
    case "WebSearch":
      return short(str(input.query));
    case "Agent":
    case "Task":
      return short(`${str(input.subagent_type) || "agent"} · ${str(input.description)}`);
    default: {
      const first = Object.values(input).find((v) => typeof v === "string");
      return short(typeof first === "string" ? first : "");
    }
  }
}
