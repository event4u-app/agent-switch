/**
 * Session preview — the SECOND sanctioned transcript reader, alongside
 * `src/telemetry.ts` (roadmap: road-to-agent-switch-statusline-usage does NOT
 * own this; it is sanctioned by ADR-002, which reopens the "transcripts are
 * opaque" lock of road-to-session-handoff for a bounded, read-only preview).
 *
 * Iron rule amendment (ADR-002): transcripts remain OPAQUE, version-unstable
 * blobs *for transfer* (see sessions.ts — takeover never parses beyond line 1).
 * Two read-only exceptions now exist, and ONLY these two: telemetry
 * (context/token counts, telemetry.ts) and this preview (the first few
 * conversation turns, for the GUI Sessions list). Both obey the same discipline:
 *   1. capped read      — only the first PREVIEW_BYTE_CAP bytes (the HEAD, in
 *                         contrast to telemetry's tail), never the whole file.
 *   2. fenced parse     — every line parse is try/caught; a malformed line is
 *                         skipped, never thrown.
 *   3. degraded mode    — an unreadable / empty / bodyless transcript returns
 *                         null, never an exception (the caller shows nothing).
 *   4. bounded output   — at most PREVIEW_MAX_MESSAGES turns, each truncated to
 *                         PREVIEW_TEXT_CAP chars; tool noise + meta lines dropped.
 *
 * Zero deps (node built-ins only). Pure + fixture-tested. Own-session only —
 * this reads a session's OWN early turns, never a cross-account view. Claude
 * only: the codex rollout blob is opaque + often .zst-compressed, so a codex
 * preview is deferred (readCodexPreview returns null by construction).
 *
 * Ground truth (a real claude 2.1.x transcript): each JSONL line carries a
 * `type` (`user` | `assistant` | `attachment` | `mode` | `file-history-snapshot`
 * | …). A conversational line is `type:"user"|"assistant"` with
 * `message.content` that is either a string or an array of blocks
 * `{ type:"text", text } | { type:"tool_use"|"tool_result"|"thinking"|"image", … }`.
 * Only `text` blocks carry human-readable content; everything else is skipped.
 */

import * as fs from "node:fs";

/** Bytes read from the START of a transcript. The first turns live at the head;
 *  capping keeps a preview read cheap even on a multi-MB transcript. */
export const PREVIEW_BYTE_CAP = 128 * 1024;
/** Most conversation turns a preview ever carries. */
export const PREVIEW_MAX_MESSAGES = 6;
/** Per-turn character cap; longer turns are truncated with an ellipsis. */
export const PREVIEW_TEXT_CAP = 240;

export interface PreviewMessage {
  role: "user" | "assistant";
  text: string;
}

export interface SessionPreview {
  messages: PreviewMessage[];
  /** True when more turns exist past the ones shown, or the file exceeded the
   *  byte cap — the GUI shows a "…" affordance. */
  truncated: boolean;
}

/** Read the first `cap` bytes of a file as complete lines. When the file is
 *  larger than the cap the last (partial) line is dropped. Returns
 *  { lines, capped } — capped signals the head did not reach EOF. Never throws. */
export function headLines(file: string, cap: number = PREVIEW_BYTE_CAP): { lines: string[]; capped: boolean } {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return { lines: [], capped: false };
  }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, cap);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    const text = buf.toString("utf8");
    const capped = size > cap;
    const lines = text.split("\n");
    // If we stopped short of EOF, the final line is partial — drop it.
    if (capped && lines.length > 0) lines.pop();
    return { lines: lines.filter((l) => l.length > 0), capped };
  } catch {
    return { lines: [], capped: false };
  } finally {
    fs.closeSync(fd);
  }
}

/** Human-readable text out of a message `content` field (string or block array).
 *  Only `text` blocks contribute; tool_use / tool_result / thinking / image are
 *  ignored. Returns "" when there is no textual content. */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const t = (block as { text?: unknown }).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join("\n");
}

/** Strip the wrapper tags Claude Code injects into user turns (slash-command
 *  envelopes, system reminders, local-command output) so a preview shows the
 *  human's words, not machinery. Whitespace-collapsed. */
export function cleanText(raw: string): string {
  return raw
    // Drop whole tag blocks that carry machine content (can be large).
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/<local-command-(?:stdout|stderr)>[\s\S]*?<\/local-command-(?:stdout|stderr)>/gi, " ")
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/gi, " ")
    // Drop the slash-command envelope tags but keep any surrounding words.
    .replace(/<\/?command-(?:message|name|args)>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, cap: number): { text: string; cut: boolean } {
  if (text.length <= cap) return { text, cut: false };
  return { text: text.slice(0, cap).trimEnd() + "…", cut: true };
}

/**
 * The first few conversational turns of a Claude transcript, for the GUI
 * preview. Walks the capped head forward, keeping `user`/`assistant` turns that
 * carry visible text (tool-only turns, attachments, and meta lines are skipped),
 * up to PREVIEW_MAX_MESSAGES, each truncated to PREVIEW_TEXT_CAP. Returns null
 * when the transcript yields no visible turn (degraded mode — caller shows
 * nothing). Never throws.
 */
export function readClaudePreview(
  file: string,
  opts: { cap?: number; maxMessages?: number; textCap?: number } = {},
): SessionPreview | null {
  const maxMessages = opts.maxMessages ?? PREVIEW_MAX_MESSAGES;
  const textCap = opts.textCap ?? PREVIEW_TEXT_CAP;
  const { lines, capped } = headLines(file, opts.cap ?? PREVIEW_BYTE_CAP);
  if (lines.length === 0) return null;

  const messages: PreviewMessage[] = [];
  let moreAvailable = capped;

  for (const line of lines) {
    let o: { type?: unknown; message?: { role?: unknown; content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue; // fenced — malformed line never fails a preview
    }
    if (o?.type !== "user" && o?.type !== "assistant") continue;
    const msg = o.message;
    if (!msg || typeof msg !== "object") continue;
    const role = o.type; // "user" | "assistant"
    const cleaned = role === "user" ? cleanText(extractText(msg.content)) : extractText(msg.content).trim();
    if (cleaned.length === 0) continue; // tool-only / attachment-only turn
    if (messages.length >= maxMessages) {
      moreAvailable = true;
      break;
    }
    const { text, cut } = truncate(cleaned, textCap);
    if (cut) moreAvailable = true;
    messages.push({ role, text });
  }

  if (messages.length === 0) return null;
  return { messages, truncated: moreAvailable };
}

/** Codex preview is deferred (opaque, often .zst-compressed rollout blob). Null
 *  by construction so the dispatcher + caller degrade cleanly. */
export function readCodexPreview(_file: string): SessionPreview | null {
  return null;
}

/** Provider-dispatching preview reader. Codex → null (deferred). */
export function readPreview(
  provider: "claude" | "codex",
  file: string,
  opts: { cap?: number; maxMessages?: number; textCap?: number } = {},
): SessionPreview | null {
  return provider === "codex" ? readCodexPreview(file) : readClaudePreview(file, opts);
}
