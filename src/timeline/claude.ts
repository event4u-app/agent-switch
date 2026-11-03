/**
 * Claude → AS events (ADR-010). One mapper serves the transcript on disk (the
 * read-only timeline) and the live stream-json output of the bridge: both carry
 * the same `user` / `assistant` lines; the stream adds partial deltas, approval
 * requests over the control protocol and a `result` per turn.
 *
 * Local and read-only: nothing here writes a transcript or any host file.
 */

import * as fs from "node:fs";

import { countHunks, toolSummary, type AsEvent, type DiffHunk } from "./events.js";

/** The newest Claude Code version a recorded fixture covers (tests/fixtures/timeline). */
export const NEWEST_FIXTURE_VERSION = "2.1.316";

/** What the mapper remembers between lines: tool names by id, the open message. */
export interface ClaudeState {
  tools: Map<string, string>;
  /** Live: the message id `message_start` announced, for its deltas. */
  liveMessage: string | null;
  version: string | null;
}

export const claudeState = (): ClaudeState => ({ tools: new Map(), liveMessage: null, version: null });

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** `structuredPatch` of an Edit / Write result → hunks. */
function patchHunks(patch: unknown): DiffHunk[] {
  return arr(patch).map((h) => {
    const o = obj(h);
    return { oldStart: Number(o.oldStart) || 0, newStart: Number(o.newStart) || 0, lines: arr(o.lines).filter((l): l is string => typeof l === "string") };
  });
}

/** The text of a tool result, flattened. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((b) => str(obj(b).text))
    .filter(Boolean)
    .join("\n");
}

function firstLine(s: string, n = 120): string {
  const l = s.trim().split("\n")[0] ?? "";
  return l.length > n ? `${l.slice(0, n - 1)}…` : l;
}

function userLine(e: Json, st: ClaudeState): AsEvent[] {
  const msg = obj(e.message);
  const out: AsEvent[] = [];
  const id = str(e.uuid) || str(msg.id) || `u${st.tools.size}`;
  if (typeof msg.content === "string") {
    out.push({ t: "turn", id, at: str(e.timestamp) || null }, { t: "message", id, role: "user", text: msg.content, images: 0 });
    return out;
  }
  const blocks = arr(msg.content).map(obj);
  const text = blocks.filter((b) => b.type === "text").map((b) => str(b.text)).join("\n");
  const images = blocks.filter((b) => b.type === "image").length;
  if (text || images) out.push({ t: "turn", id, at: str(e.timestamp) || null }, { t: "message", id, role: "user", text, images });
  // The transcript calls it toolUseResult, the stream tool_use_result.
  const tur = obj(e.toolUseResult ?? e.tool_use_result);
  for (const b of blocks.filter((x) => x.type === "tool_result")) {
    const toolId = str(b.tool_use_id);
    const name = st.tools.get(toolId) ?? "";
    const ok = b.is_error !== true;
    const body = resultText(b.content);
    let summary = firstLine(str(tur.stdout) || body);
    const hunks = patchHunks(tur.structuredPatch);
    if (hunks.length) {
      const { added, removed } = countHunks(hunks);
      summary = `+${added} −${removed}`;
      out.push({ t: "diff", toolId, path: str(tur.filePath), added, removed, hunks });
    } else if (name === "Write" && typeof tur.content === "string") {
      const lines = tur.content.replace(/\n$/, "").split("\n").map((l) => `+${l}`);
      out.push({ t: "diff", toolId, path: str(tur.filePath), added: lines.length, removed: 0, hunks: [{ oldStart: 0, newStart: 1, lines }] });
      summary = `+${lines.length}`;
    }
    out.push({ t: "tool.finished", id: toolId, ok, summary });
    if (SUBAGENT_TOOLS.has(name)) out.push({ t: "subagent.finished", id: toolId, ok: ok && str(tur.status) !== "failed" });
  }
  return out;
}

function assistantLine(e: Json, st: ClaudeState): AsEvent[] {
  const msg = obj(e.message);
  const out: AsEvent[] = [];
  const mid = str(msg.id) || str(e.uuid);
  arr(msg.content)
    .map(obj)
    .forEach((b, i) => {
      if (b.type === "text") out.push({ t: "message", id: `${mid}:${i}:${str(e.uuid)}`, role: "assistant", text: str(b.text), images: 0 });
      else if (b.type === "thinking" || b.type === "redacted_thinking") out.push({ t: "thinking", id: `${mid}:${i}` });
      else if (b.type === "tool_use") {
        const id = str(b.id);
        const name = str(b.name);
        const input = obj(b.input);
        st.tools.set(id, name);
        out.push({ t: "tool.started", id, name, summary: toolSummary(name, input), input, parentToolId: str(e.parent_tool_use_id) || null });
        if (SUBAGENT_TOOLS.has(name)) out.push({ t: "subagent.started", id, type: str(input.subagent_type) || "general-purpose", description: str(input.description) });
        if (name === "AskUserQuestion")
          out.push({
            t: "question.requested",
            id,
            questions: arr(input.questions).map((q) => ({ question: str(obj(q).question), options: arr(obj(q).options).map((o) => str(obj(o).label) || str(o)) })),
          });
        if (name === "ExitPlanMode") out.push({ t: "plan", id, text: str(input.plan) });
      } else out.push({ t: "unknown", kind: `assistant:${str(b.type) || "block"}` });
    });
  return out;
}

/** One transcript or stream line → events. `st` carries tool names across lines. */
export function fromClaudeLine(line: unknown, st: ClaudeState): AsEvent[] {
  const e = obj(line);
  const type = str(e.type);
  if (typeof e.version === "string") st.version ??= e.version;
  if (type === "user") return e.isSidechain === true || e.isMeta === true ? [] : userLine(e, st);
  if (type === "assistant") return e.isSidechain === true ? [] : assistantLine(e, st);
  // Live stream only.
  if (type === "stream_event") {
    const ev = obj(e.event);
    if (ev.type === "message_start") st.liveMessage = str(obj(ev.message).id) || null;
    const delta = obj(ev.delta);
    if (ev.type === "content_block_delta" && delta.type === "text_delta" && st.liveMessage) return [{ t: "message.delta", id: `${st.liveMessage}:${Number(ev.index) || 0}`, text: str(delta.text) }];
    return [];
  }
  if (type === "control_request") {
    const r = obj(e.request);
    if (r.subtype === "can_use_tool") {
      const tool = str(r.tool_name);
      const input = obj(r.input);
      return [{ t: "approval.requested", id: str(e.request_id), tool, summary: toolSummary(tool, input), input }];
    }
    return [{ t: "unknown", kind: `control_request:${str(r.subtype)}` }];
  }
  if (type === "rate_limit_event") {
    const info = obj(e.rate_limit_info);
    const resets = Number(info.resetsAt);
    return [{ t: "limits", status: str(info.status) || "unknown", resetsAt: Number.isFinite(resets) && resets > 0 ? new Date(resets * 1000).toISOString() : null }];
  }
  if (type === "result") {
    const ok = e.is_error !== true && str(e.subtype) === "success";
    const out: AsEvent[] = [{ t: "turn.end", ok, durationMs: typeof e.duration_ms === "number" ? e.duration_ms : null, costUsd: typeof e.total_cost_usd === "number" ? e.total_cost_usd : null }];
    if (!ok) out.unshift({ t: "error", message: str(e.result) || str(e.subtype) || "the turn failed" });
    return out;
  }
  if (type === "system" && e.subtype === "init") return [];
  return [{ t: "unknown", kind: type ? `${type}${e.subtype ? `:${str(e.subtype)}` : ""}` : "line" }];
}

/** A whole transcript → events, plus the Claude Code version it was written by. */
export function readClaudeTranscript(file: string): { events: AsEvent[]; version: string | null; newerThanFixtures: boolean } {
  const st = claudeState();
  const events: AsEvent[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      events.push({ t: "unknown", kind: "unparsable" });
      continue;
    }
    events.push(...fromClaudeLine(parsed, st));
  }
  return { events, version: st.version, newerThanFixtures: !!st.version && compareVersions(st.version, NEWEST_FIXTURE_VERSION) > 0 };
}

/** Semver-ish compare of dotted numeric versions. Pure. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
