import { describe, it, expect } from "vitest";
import {
  groupByProvider,
  activeRow,
  nearestLimit,
  pickMostHeadroom,
  trayTooltip,
  sparkline,
  formatReset,
  formatTokensK,
  formatContextBadge,
  worstLiveContextPct,
  contextTrayTooltip,
  relativeAge,
  type ProfileRow,
  type SessionRow,
  type SessionContext,
  type UsageSnapshot,
} from "./transforms.js";

const rows: ProfileRow[] = [
  { provider: "claude", name: "work", identity: "w@x.com", label: "Work", active: true, liveSessions: 1 },
  { provider: "claude", name: "privat", identity: "p@x.com", label: "Personal", active: false, liveSessions: 0 },
  { provider: "codex", name: "oai", identity: "acc", label: null, active: false, liveSessions: 0 },
];

describe("groupByProvider", () => {
  it("buckets rows by provider, keeping all three keys", () => {
    const g = groupByProvider(rows);
    expect(g.claude.map((r) => r.name)).toEqual(["work", "privat"]);
    expect(g.codex.map((r) => r.name)).toEqual(["oai"]);
    expect(g.antigravity).toEqual([]);
  });
});

describe("activeRow", () => {
  it("finds the active row, or null", () => {
    expect(activeRow(rows)?.name).toBe("work");
    expect(activeRow(rows.map((r) => ({ ...r, active: false })))).toBeNull();
  });
});

describe("nearestLimit", () => {
  const usage = (utils: (number | null)[]): UsageSnapshot => ({
    windows: utils.map((u, i) => ({ key: `w${i}`, label: `w${i}`, utilization: u, resetsAt: null })),
    routines: null,
    capturedAt: "2026-07-13T00:00:00Z",
  });
  it("returns the max own-window utilization", () => {
    expect(nearestLimit(usage([12, 63, 80, 20]))).toBe(80);
  });
  it("ignores null windows and returns null when nothing is known", () => {
    expect(nearestLimit(usage([null, 40]))).toBe(40);
    expect(nearestLimit(usage([null, null]))).toBeNull();
    expect(nearestLimit(null)).toBeNull();
  });
});

describe("trayTooltip", () => {
  it("names the active profile and its own nearest limit", () => {
    const active = rows[0];
    const usage: UsageSnapshot = {
      windows: [{ key: "5h", label: "5h", utilization: 55, resetsAt: null }],
      routines: null,
      capturedAt: "x",
    };
    expect(trayTooltip(active, usage)).toBe("agent-switch — claude/work · 55% used");
    expect(trayTooltip(active, null)).toBe("agent-switch — claude/work");
    expect(trayTooltip(null, null)).toBe("agent-switch — no active profile");
  });
});

describe("sparkline", () => {
  it("maps a utilization series to block glyphs", () => {
    expect(sparkline([])).toBe("");
    expect(sparkline([0]).length).toBe(1);
    const s = sparkline([0, 50, 100]);
    expect(s.length).toBe(3);
    expect(s[0]).toBe("▁"); // 0% → lowest
    expect(s[2]).toBe("█"); // 100% → highest
  });
});

describe("relativeAge", () => {
  const now = Date.parse("2026-07-14T12:00:00Z");
  it("renders s / m / h / d buckets", () => {
    expect(relativeAge(now - 30_000, now)).toBe("30s");
    expect(relativeAge(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeAge(now - 3 * 3600_000, now)).toBe("3h");
    expect(relativeAge(now - 2 * 86_400_000, now)).toBe("2d");
  });
  it("clamps a future mtime to 0s", () => {
    expect(relativeAge(now + 10_000, now)).toBe("0s");
  });
});

describe("formatTokensK", () => {
  it("rounds to thousands with a k suffix", () => {
    expect(formatTokensK(134_000)).toBe("134k");
    expect(formatTokensK(1_000_000)).toBe("1000k");
    expect(formatTokensK(499)).toBe("0k");
    expect(formatTokensK(1_500)).toBe("2k");
  });
});

describe("formatContextBadge", () => {
  const ctx = (over: Partial<SessionContext>): SessionContext => ({
    pct: 67,
    contextTokens: 134_000,
    windowTokens: 1_000_000,
    model: "sonnet",
    confidence: "high",
    ...over,
  });
  it("renders pct · used/window when the window is known", () => {
    expect(formatContextBadge(ctx({}))).toBe("67% · 134k/1000k");
  });
  it("falls back to a raw token count when the window is unknown", () => {
    expect(formatContextBadge(ctx({ windowTokens: null, pct: null }))).toBe("134k tok");
  });
  it("prefixes ~ on a low-confidence (estimated) readout", () => {
    expect(formatContextBadge(ctx({ confidence: "low" }))).toBe("~67% · 134k/1000k");
    expect(formatContextBadge(ctx({ confidence: "low", windowTokens: null, pct: null }))).toBe("~134k tok");
  });
  it("is empty when there is no context", () => {
    expect(formatContextBadge(null)).toBe("");
    expect(formatContextBadge(undefined)).toBe("");
  });
});

describe("worstLiveContextPct", () => {
  const sess = (over: Partial<SessionRow>): SessionRow => ({
    provider: "claude",
    profile: "work",
    sessionId: "s",
    projectDir: "p",
    cwd: null,
    mtimeMs: 0,
    live: true,
    ...over,
  });
  const withPct = (profile: string, live: boolean, pct: number | null): SessionRow =>
    sess({ profile, live, context: { pct, contextTokens: 1, windowTokens: 1, model: null, confidence: "high" } });

  it("returns the max fill across the active profile's live sessions", () => {
    const rows = [withPct("work", true, 40), withPct("work", true, 82), withPct("privat", true, 95)];
    expect(worstLiveContextPct(rows, ["work"])).toBe(82); // never leaks privat's 95 — own account only
  });
  it("ignores non-live sessions and sessions with no context pct", () => {
    const rows = [withPct("work", false, 99), sess({ profile: "work", live: true, context: null }), withPct("work", true, 30)];
    expect(worstLiveContextPct(rows, ["work"])).toBe(30);
  });
  it("returns null when nothing matches", () => {
    expect(worstLiveContextPct([], ["work"])).toBeNull();
    expect(worstLiveContextPct([withPct("work", true, 50)], [])).toBeNull();
  });
});

describe("contextTrayTooltip", () => {
  it("shows one number for the active profile, or the bare name when unknown", () => {
    expect(contextTrayTooltip(82)).toBe("agent-switch — 82% context");
    expect(contextTrayTooltip(null)).toBe("agent-switch");
  });
});

describe("formatReset", () => {
  const now = Date.parse("2026-07-14T00:00:00Z");
  it("renders days+hours, hours+minutes, or minutes", () => {
    expect(formatReset("2026-07-19T03:00:00Z", now)).toBe("5d 3h");
    expect(formatReset("2026-07-14T02:47:00Z", now)).toBe("2h 47m");
    expect(formatReset("2026-07-14T00:12:00Z", now)).toBe("12m");
  });
  it("is empty for past, null, or unparseable timestamps", () => {
    expect(formatReset("2026-07-13T00:00:00Z", now)).toBe("");
    expect(formatReset(null, now)).toBe("");
    expect(formatReset("nonsense", now)).toBe("");
  });
});

describe("pickMostHeadroom", () => {
  it("picks the lowest known utilization (most headroom)", () => {
    expect(
      pickMostHeadroom([
        { name: "a", max: 80 },
        { name: "b", max: 20 },
        { name: "c", max: 55 },
      ]),
    ).toBe("b");
  });

  it("treats unknown usage as worse than any real value, but still picks it if nothing is known", () => {
    expect(
      pickMostHeadroom([
        { name: "known", max: 90 },
        { name: "unknown", max: null },
      ]),
    ).toBe("known");
    expect(pickMostHeadroom([{ name: "only", max: null }])).toBe("only");
  });

  it("returns null when there are no candidates", () => {
    expect(pickMostHeadroom([])).toBeNull();
  });
});
