import { describe, it, expect } from "vitest";
import {
  groupByProvider,
  activeRow,
  nearestLimit,
  trayTooltip,
  sparkline,
  type ProfileRow,
  type UsageSnapshot,
} from "./transforms.js";

const rows: ProfileRow[] = [
  { provider: "claude", name: "work", identity: "w@x.com", active: true, liveSessions: 1 },
  { provider: "claude", name: "privat", identity: "p@x.com", active: false, liveSessions: 0 },
  { provider: "codex", name: "oai", identity: "acc", active: false, liveSessions: 0 },
];

describe("groupByProvider", () => {
  it("buckets rows by provider, keeping all three keys", () => {
    const g = groupByProvider(rows);
    expect(g.claude.map((r) => r.name)).toEqual(["work", "privat"]);
    expect(g.codex.map((r) => r.name)).toEqual(["oai"]);
    expect(g.gemini).toEqual([]);
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
