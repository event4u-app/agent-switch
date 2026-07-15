/**
 * Codex banked rate-limit reset credits: list + redeem.
 *
 * Endpoints (accept the stored OAuth bearer; extracted from the openai.chatgpt
 * VS Code extension and confirmed by the community `codex-reset` tool — Codex
 * itself only exposes `/reset` from v0.135):
 *
 *   GET  /backend-api/wham/rate-limit-reset-credits
 *        → { credits: [{ id, status: "available"|…, … }], available_count, … }
 *   POST /backend-api/wham/rate-limit-reset-credits/consume
 *        body { credit_id, redeem_request_id }   // redeem_request_id = idempotency UUID
 *        → { code: "reset", windows_reset, redeemed_at, … }
 *
 * SAFETY: a reset credit is scarce and non-refundable, and redeeming is known to
 * be occasionally buggy upstream. This module only redeems when the caller asks;
 * the daemon's reset-first path guards it to at most once per reset cycle so a
 * loop can never burn a user's whole balance. The redeem call itself cannot be
 * exercised in CI (it would consume a real credit) — the request construction is
 * unit-tested and it is validated live the first time a limit is hit.
 */

import { randomUUID } from "node:crypto";
import { codexTokenOf } from "./codex-usage.js";

const BASE = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

function headers(accessToken: string, accountId: string | null): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(accountId ? { "chatgpt-account-id": accountId } : {}),
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.134.0",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** Number of currently-available reset credits for a codex home, or null. */
export async function availableResetCredits(configDir: string): Promise<number | null> {
  const tok = codexTokenOf(configDir);
  if (!tok) return null;
  try {
    const res = await fetch(BASE, { headers: headers(tok.accessToken, tok.accountId), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const raw: any = await res.json();
    if (typeof raw?.available_count === "number") return raw.available_count;
    if (Array.isArray(raw?.credits)) return raw.credits.filter((c: any) => c?.status === "available").length;
    return null;
  } catch {
    return null;
  }
}

export interface RedeemResult {
  ok: boolean;
  windowsReset?: number;
  reason?: string;
}

/**
 * Redeem ONE available reset credit for a codex home. Returns {ok:false} when
 * there is nothing to redeem or the call fails — never throws. The
 * `redeem_request_id` is a fresh UUID (the documented idempotency key).
 */
export async function redeemResetCredit(configDir: string): Promise<RedeemResult> {
  const tok = codexTokenOf(configDir);
  if (!tok) return { ok: false, reason: "no token" };
  const h = headers(tok.accessToken, tok.accountId);
  let creditId: string | null;
  try {
    const res = await fetch(BASE, { headers: h, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, reason: `list ${res.status}` };
    const raw: any = await res.json();
    const credits: any[] = Array.isArray(raw?.credits) ? raw.credits : [];
    creditId = credits.find((c) => c?.status === "available")?.id ?? null;
    if (!creditId) return { ok: false, reason: "no available credit" };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
  try {
    const res = await fetch(`${BASE}/consume`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ credit_id: creditId, redeem_request_id: randomUUID() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, reason: `consume ${res.status}` };
    const raw: any = await res.json();
    return { ok: raw?.code === "reset", windowsReset: typeof raw?.windows_reset === "number" ? raw.windows_reset : undefined };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}
