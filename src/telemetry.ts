/**
 * Session telemetry — the SINGLE sanctioned transcript reader (roadmap:
 * road-to-agent-switch-session-telemetry, Phase 1, decision gate D0).
 *
 * Iron rule amendment (D0, verified by scripts/spikes/t1+t2 on claude 2.1.210):
 * transcripts remain OPAQUE, version-unstable blobs *for transfer* (see
 * sessions.ts — takeover never parses beyond line 1). READ-ONLY TELEMETRY is
 * permitted here and ONLY here, under four gates:
 *   1. version matrix     — SUPPORTED_CLAUDE below; unknown → low confidence.
 *   2. pre-flight canary   — `preflightClaude`, run by the daemon on start.
 *   3. degraded mode       — every reader returns null / low confidence rather
 *                            than throwing; the caller shows staleness, never
 *                            a crash or a silently-wrong number.
 *   4. confidence scoring  — malformed-line ratio → high | low.
 *
 * Zero deps (node built-ins only). Pure + fixture-tested. Own-session only —
 * this reads a session's OWN context/token state, never a cross-account view
 * (the anti-rotation lock).
 *
 * Ground truth (scripts/spikes/t1, t3):
 *   Claude assistant line: { type:"assistant", isSidechain?, sessionId,
 *     message:{ id, model, stop_reason, usage:{ input_tokens,
 *     cache_read_input_tokens, cache_creation_input_tokens, output_tokens }}}.
 *     Context size = last FINALIZED (stop_reason set) MAIN-CHAIN
 *     (isSidechain !== true) non-synthetic entry's input-side sum; output
 *     excluded (matches the official statusline used_percentage).
 *   Codex rollout line: { type:"event_msg", payload:{ type:"token_count",
 *     info:{ total_token_usage:{ total_tokens, ... }, model_context_window }}}.
 *     `info` is nullable per event → walk backward to the last non-null one.
 */

import * as fs from "node:fs";

/** Bytes tailed from the end of a transcript. A live context reading only
 *  needs the newest entries; capping the read keeps the daemon cycle cheap. */
export const TAIL_CAP = 256 * 1024;

/** Claude-Code major.minor prefixes the fixtures + spikes were verified on.
 *  A running version outside this set still works but reads at low confidence
 *  (the daemon logs a version-drift warning). */
export const SUPPORTED_CLAUDE = ["2.1"];

/** Effective context windows by model (transcript JSONL carries no window
 *  size — only the statusline does, in-band). Unknown model → null (show raw
 *  tokens, never guess a percentage). User overrides via state.json merge on
 *  top. Codex needs no table — its rollout carries model_context_window. */
export const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-fable-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-4-5": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-opus-4-1": 200_000,
  "claude-haiku-4-5": 200_000,
};

export type Provider = "claude" | "codex";

export interface ContextReading {
  provider: Provider;
  /** Tokens occupying the context window right now. */
  contextTokens: number;
  /** Effective window, or null when the model is unknown (Claude table miss). */
  windowTokens: number | null;
  /** 0–100, one decimal — or null when the window is unknown. */
  pct: number | null;
  model: string | null;
  timestamp: string | null;
  /** high = clean parse; low = version drift or malformed lines seen. */
  confidence: "high" | "low";
}

export function contextWindowFor(
  model: string | null | undefined,
  overrides: Record<string, number> = {},
): number | null {
  if (!model) return null;
  return overrides[model] ?? CONTEXT_WINDOWS[model] ?? null;
}

/** Read the last `cap` bytes of a file as complete lines. When the file is
 *  larger than the cap, the first (partial) line is dropped. Returns [] on any
 *  error — degraded mode, never throws. */
export function tailLines(file: string, cap: number = TAIL_CAP): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = size > cap ? size - cap : 0;
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    const text = buf.toString("utf8");
    const lines = text.split("\n");
    if (start > 0 && lines.length > 0) lines.shift(); // drop the partial first line
    return lines.filter((l) => l.length > 0);
  } catch {
    return [];
  } finally {
    fs.closeSync(fd);
  }
}

function isVersionSupported(version: string | null | undefined): boolean {
  if (!version) return false;
  return SUPPORTED_CLAUDE.some((p) => version.startsWith(p));
}

/**
 * Claude live context from a transcript. Walks the tail backward to the last
 * FINALIZED (stop_reason set) MAIN-CHAIN (isSidechain !== true) non-synthetic
 * assistant entry; sums the input side (input + cache_read + cache_creation),
 * excludes output — matching the official statusline used_percentage. Subagent
 * (sidechain) tokens never inflate the parent context reading.
 *
 * @param claudeVersion the running `claude --version` string, for the version
 *   gate; unknown/unsupported → confidence "low" (still returns the number).
 */
export function readClaudeContext(
  file: string,
  opts: { overrides?: Record<string, number>; claudeVersion?: string | null; cap?: number } = {},
): ContextReading | null {
  const lines = tailLines(file, opts.cap ?? TAIL_CAP);
  if (lines.length === 0) return null;

  let parsed = 0;
  let malformed = 0;
  let hit: { inputSide: number; model: string | null; ts: string | null } | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    let o: any;
    try {
      o = JSON.parse(lines[i]);
      parsed++;
    } catch {
      malformed++;
      continue;
    }
    if (hit) continue; // keep counting malformed for confidence, but we have our entry
    if (o?.type !== "assistant") continue;
    if (o.isSidechain === true) continue;
    const m = o.message;
    if (!m || typeof m !== "object" || !m.usage) continue;
    if (m.model === "<synthetic>") continue;
    const sr = m.stop_reason;
    if (sr === null || sr === undefined) continue; // streaming intermediate
    const u = m.usage;
    const inputSide =
      (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    hit = { inputSide, model: typeof m.model === "string" ? m.model : null, ts: o.timestamp ?? null };
  }

  if (!hit) return null;

  const total = parsed + malformed;
  const malformedRatio = total > 0 ? malformed / total : 0;
  const confidence: "high" | "low" =
    malformedRatio > 0.1 || !isVersionSupported(opts.claudeVersion) ? "low" : "high";

  const windowTokens = contextWindowFor(hit.model, opts.overrides);
  const pct = windowTokens ? Math.round((hit.inputSide / windowTokens) * 1000) / 10 : null;

  return {
    provider: "claude",
    contextTokens: hit.inputSide,
    windowTokens,
    pct,
    model: hit.model,
    timestamp: hit.ts,
    confidence,
  };
}

/**
 * Codex live context from a rollout file. Walks the tail backward to the last
 * `event_msg` whose `payload.type === "token_count"` carries a non-null `info`
 * (short/aborted sessions emit info:null — verified in spikes/t3). Context =
 * `total_token_usage.total_tokens`; window = in-band `model_context_window`.
 */
export function readCodexContext(file: string, opts: { cap?: number } = {}): ContextReading | null {
  const lines = tailLines(file, opts.cap ?? TAIL_CAP);
  if (lines.length === 0) return null;

  let parsed = 0;
  let malformed = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    let o: any;
    try {
      o = JSON.parse(lines[i]);
      parsed++;
    } catch {
      malformed++;
      continue;
    }
    const p = o?.payload ?? o;
    if (p?.type !== "token_count") continue;
    const info = p.info;
    if (!info || typeof info !== "object") continue; // info:null — keep walking back
    const usage = info.total_token_usage || info.last_token_usage;
    if (!usage || !Number.isFinite(usage.total_tokens)) continue;
    const windowTokens = Number.isFinite(info.model_context_window) ? info.model_context_window : null;
    const pct = windowTokens ? Math.round((usage.total_tokens / windowTokens) * 1000) / 10 : null;
    const total = parsed + malformed;
    const confidence: "high" | "low" = total > 0 && malformed / total > 0.1 ? "low" : "high";
    return {
      provider: "codex",
      contextTokens: usage.total_tokens,
      windowTokens,
      pct,
      model: null, // codex rollout token_count carries no model id; window is in-band
      timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
      confidence,
    };
  }
  return null;
}

/** Provider-dispatching reader. */
export function readContext(
  provider: Provider,
  file: string,
  opts: { overrides?: Record<string, number>; claudeVersion?: string | null; cap?: number } = {},
): ContextReading | null {
  return provider === "codex" ? readCodexContext(file, opts) : readClaudeContext(file, opts);
}

/** A session's context reading joined from its on-disk transcript. `file` is
 *  the resolved transcript/rollout path; `provider` selects the reader. Thin
 *  join so the CLI/daemon can go SessionRow → path → reading in one call. */
export function sessionContext(
  sess: { provider: Provider; file: string },
  opts: { overrides?: Record<string, number>; claudeVersion?: string | null; cap?: number } = {},
): ContextReading | null {
  return readContext(sess.provider, sess.file, opts);
}

/** Resolve a Claude session's transcript path from its config dir + on-disk
 *  encoded project dir + session id (the sessions.ts SessionRow shape). Pure
 *  path join — does not touch the filesystem. */
export function claudeTranscriptPath(configDir: string, projectDir: string, sessionId: string): string {
  return `${configDir}/projects/${projectDir}/${sessionId}.jsonl`;
}

/**
 * Pre-flight canary (D0 gate 2). Validates that a transcript still parses into
 * a usable context reading on the running Claude version. The daemon runs this
 * on start; a failure flips the feature to degraded mode with a loud log line
 * rather than emitting silently-wrong numbers.
 */
export function preflightClaude(
  file: string,
  claudeVersion?: string | null,
): { ok: boolean; confidence: "high" | "low"; reason: string } {
  const reading = readClaudeContext(file, { claudeVersion });
  if (!reading) {
    return { ok: false, confidence: "low", reason: "no finalized main-chain assistant entry found — format may have drifted" };
  }
  if (!isVersionSupported(claudeVersion)) {
    return {
      ok: true,
      confidence: "low",
      reason: `claude version ${claudeVersion ?? "unknown"} outside tested set [${SUPPORTED_CLAUDE.join(", ")}] — reading at low confidence`,
    };
  }
  return { ok: true, confidence: reading.confidence, reason: "ok" };
}
