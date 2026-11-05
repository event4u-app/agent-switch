import { describe, expect, it } from "vitest";

import { CACHE_EXPIRY_HINT_MS, COLD_RESEND_HINT_TOKENS, CONTEXT_HINT_MIN_TOKENS, CONTEXT_HINT_PCT, CONTEXT_URGENT_PCT, LIMIT_HINT_MARGIN, sessionHints, type HintInput } from "./hints.js";

const NOW = Date.parse("2026-11-05T10:00:00Z");
const base = (o: Partial<HintInput> = {}): HintInput => ({
  tool: "claude",
  contextPct: 10,
  contextTokens: 20_000,
  cache: null,
  account: { name: "work", fiveH: 20, protect: 95 },
  nowMs: NOW,
  ...o,
});
const ids = (o: Partial<HintInput>) => sessionHints(base(o)).map((h) => h.id);

describe("sessionHints (6.1)", () => {
  it("a quiet session gets no hint", () => {
    expect(sessionHints(base())).toEqual([]);
  });

  it("context: from the threshold on, with the token count; urgent near auto-compact; quiet for a small window", () => {
    expect(ids({ contextPct: CONTEXT_HINT_PCT - 1, contextTokens: 600_000 })).toEqual([]);
    const h = sessionHints(base({ contextPct: CONTEXT_HINT_PCT, contextTokens: 660_200 }))[0]!;
    expect(h).toMatchObject({ id: "context", tone: "info", action: { kind: "compact" } });
    expect(h.text).toContain("660k");
    expect(h.text).toContain("/clear");
    expect(sessionHints(base({ contextPct: CONTEXT_URGENT_PCT, contextTokens: 170_000 }))[0]).toMatchObject({ tone: "warn", stateKey: "context:urgent" });
    expect(ids({ contextPct: 90, contextTokens: CONTEXT_HINT_MIN_TOKENS - 1 })).toEqual([]);
  });

  it("warm cache: only inside the last stretch before expiry, counting seconds", () => {
    const cache = (msLeft: number) => ({ state: "warm" as const, ttl: "5m" as const, lastResponseAt: null, expiresAt: new Date(NOW + msLeft).toISOString(), resendTokens: null, source: "transcript" as const });
    expect(ids({ cache: cache(CACHE_EXPIRY_HINT_MS + 1000) })).toEqual([]);
    const h = sessionHints(base({ cache: cache(42_000), contextTokens: 182_000 }))[0]!;
    expect(h.id).toBe("cache-expiring");
    expect(h.text).toContain("42 s");
    expect(h.text).toContain("182k");
    expect(ids({ cache: cache(-1) })).toEqual([]);
  });

  it("cold cache: names the re-send and replaces the context hint (one advice, not two)", () => {
    const cold = (resend: number) => ({ state: "cold" as const, ttl: null, lastResponseAt: "2026-11-05T08:00:00Z", expiresAt: null, resendTokens: resend, source: "transcript" as const });
    expect(ids({ cache: cold(COLD_RESEND_HINT_TOKENS - 1) })).toEqual([]);
    const both = sessionHints(base({ cache: cold(240_000), contextPct: 70, contextTokens: 240_000 }));
    expect(both.map((h) => h.id)).toEqual(["cache-cold"]);
    expect(both[0]!.text).toContain("240k");
  });

  it("cache hints are Claude's: a Codex session gets none", () => {
    const cold = { state: "cold" as const, ttl: null, lastResponseAt: null, expiresAt: null, resendTokens: 300_000, source: "transcript" as const };
    expect(ids({ tool: "codex", cache: cold })).toEqual([]);
  });

  it("limit: from the margin under the protection threshold, warn at or above it, first in the list", () => {
    const acct = (fiveH: number) => ({ name: "work", fiveH, protect: 95 });
    expect(ids({ account: acct(95 - LIMIT_HINT_MARGIN - 1) })).toEqual([]);
    expect(sessionHints(base({ account: acct(95 - LIMIT_HINT_MARGIN) }))[0]).toMatchObject({ id: "limit", tone: "info", action: { kind: "switch" } });
    const over = sessionHints(base({ account: acct(97), contextPct: 70, contextTokens: 200_000 }));
    expect(over.map((h) => h.id)).toEqual(["limit", "context"]);
    expect(over[0]!.tone).toBe("warn");
    expect(ids({ account: { name: "w", fiveH: null, protect: 95 } })).toEqual([]);
  });

  it("the state key changes only when the situation does", () => {
    const a = sessionHints(base({ contextPct: 61, contextTokens: 100_000 }))[0]!.stateKey;
    const b = sessionHints(base({ contextPct: 70, contextTokens: 140_000 }))[0]!.stateKey;
    const c = sessionHints(base({ contextPct: 86, contextTokens: 170_000 }))[0]!.stateKey;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
