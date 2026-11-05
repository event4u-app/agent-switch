/** Hints that help the user get more out of an account (roadmap
 *  road-to-a-chat-that-reads-well Phase 6), from agent-switch's own numbers:
 *  the session's context, its prompt cache and its account's 5-hour window.
 *  Claude Code's own tip ("new task? /clear to save …") is drawn in its
 *  terminal only and never reaches a transcript, so the chat derives its
 *  equivalent here. Pure. */

import type { SessionCache } from "../transforms.js";
import { formatTokensK } from "../transforms.js";

/** Context share from which /clear and /compact are worth naming. */
export const CONTEXT_HINT_PCT = 60;
/** Context share from which the hint turns into a warning (auto-compact is near). */
export const CONTEXT_URGENT_PCT = 85;
/** Below this many context tokens the context hint stays quiet whatever the share. */
export const CONTEXT_HINT_MIN_TOKENS = 50_000;
/** A warm cache this close to its expiry is worth a "reply now". */
export const CACHE_EXPIRY_HINT_MS = 90_000;
/** A cold cache that makes the next turn re-send at least this much is worth naming. */
export const COLD_RESEND_HINT_TOKENS = 50_000;
/** Percentage points under the account's protection threshold where the limit hint starts. */
export const LIMIT_HINT_MARGIN = 10;

export interface HintInput {
  tool: string;
  contextPct: number | null;
  contextTokens: number | null;
  cache: SessionCache | null;
  account: { name: string; fiveH: number | null; protect: number };
  nowMs: number;
}

export type HintAction = "compact" | "switch";

export interface Hint {
  id: "limit" | "cache-expiring" | "cache-cold" | "context";
  tone: "info" | "warn";
  text: string;
  action: { kind: HintAction; label: string } | null;
  /** Same key = same situation: a dismissed hint stays away until this changes. */
  stateKey: string;
}

const pct = (n: number) => `${Math.round(n)}%`;

/** The hints for one session, most pressing first. */
export function sessionHints(i: HintInput): Hint[] {
  const out: Hint[] = [];
  const { fiveH, protect, name } = i.account;
  if (fiveH != null && fiveH >= protect - LIMIT_HINT_MARGIN) {
    out.push({
      id: "limit",
      tone: fiveH >= protect ? "warn" : "info",
      text: `${name} is at ${pct(fiveH)} of its 5-hour window (protected at ${protect}%). Move this session to another account before it stops.`,
      action: { kind: "switch", label: "Move…" },
      stateKey: `limit:${name}:${fiveH >= protect ? "over" : "near"}`,
    });
  }
  const c = i.cache;
  if (i.tool === "claude" && c?.state === "warm" && c.expiresAt) {
    const left = Date.parse(c.expiresAt) - i.nowMs;
    if (left > 0 && left <= CACHE_EXPIRY_HINT_MS) {
      const s = Math.ceil(left / 1000);
      const saved = i.contextTokens ? ` — ~${formatTokensK(i.contextTokens)} tokens are not re-sent` : "";
      out.push({ id: "cache-expiring", tone: "info", text: `The prompt cache stays warm for ${s} s. A reply now reuses it${saved}.`, action: null, stateKey: `cache-expiring:${c.expiresAt}` });
    }
  }
  if (i.tool === "claude" && c?.state === "cold" && c.resendTokens != null && c.resendTokens >= COLD_RESEND_HINT_TOKENS) {
    out.push({
      id: "cache-cold",
      tone: "info",
      text: `The prompt cache is cold: the next turn re-sends ~${formatTokensK(c.resendTokens)} tokens. New task? /clear first. Same task: /compact keeps the gist in fewer tokens.`,
      action: { kind: "compact", label: "Compact" },
      stateKey: `cache-cold:${c.lastResponseAt ?? ""}`,
    });
  } else if ((i.contextPct ?? 0) >= CONTEXT_HINT_PCT && (i.contextTokens ?? 0) >= CONTEXT_HINT_MIN_TOKENS) {
    const urgent = i.contextPct! >= CONTEXT_URGENT_PCT;
    out.push({
      id: "context",
      tone: urgent ? "warn" : "info",
      text: `Context ${pct(i.contextPct!)} full (~${formatTokensK(i.contextTokens!)} tokens). New task? /clear to stop re-sending them. Same task: /compact keeps the gist.${urgent ? " Auto-compact is close." : ""}`,
      action: { kind: "compact", label: "Compact" },
      stateKey: `context:${urgent ? "urgent" : "full"}`,
    });
  }
  return out;
}
