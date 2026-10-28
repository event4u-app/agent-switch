import { describe, expect, it } from "vitest";
import type { UsageHistorySample } from "../../ipc.js";
import {
  addBlocked,
  canSaveName,
  dailyPeaks,
  hasReadout,
  lastValue,
  linePath,
  protectTitle,
  providerOf,
  signInArgs,
  signInOutcome,
  usedIn,
} from "./account-logic.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);

function sample(at: number, util: number | null, key = "seven_day"): UsageHistorySample {
  return { at: new Date(at).toISOString(), windows: [{ key: "five_hour", utilization: 99 }, { key, utilization: util }] };
}

describe("account names", () => {
  it("requires the design rule for new names but keeps an old one savable", () => {
    expect(canSaveName("client-acme", "work")).toBe(true);
    expect(canSaveName("-bad", "work")).toBe(false);
    expect(canSaveName("a".repeat(25), "work")).toBe(false);
    expect(canSaveName("My.Work", "My.Work")).toBe(true);
    expect(canSaveName("my.work", "My.Work")).toBe(false);
  });
});

describe("row readouts", () => {
  it("summarises surfaces and protection", () => {
    expect(usedIn({ surfaces: [] })).toBe("—");
    expect(usedIn({ surfaces: ["Claude CLI", "Claude Desktop", "VS Code"] })).toBe("CLI · Desktop · IDE");
    expect(protectTitle(null)).toBe("Session protection not read");
    expect(protectTitle({ enabled: true, thresholdPct: 90 })).toBe("Session protection on: warns at 90 % of the binding window");
    expect(protectTitle({ enabled: false, thresholdPct: 90 })).toBe("Session protection off");
  });

  it("has no backend for Gemini", () => {
    expect(providerOf("gemini")).toBeNull();
    expect(providerOf("codex")).toBe("codex");
  });
});

describe("usage history", () => {
  it("keeps the week-window peak per day and leaves days without data empty", () => {
    const peaks = dailyPeaks(
      [sample(NOW - 2 * 3_600_000, 30), sample(NOW - 3_600_000, 55), sample(NOW - 2 * DAY, 12.4), sample(NOW - 40 * DAY, 80), sample(NOW + DAY, 70)],
      NOW,
    );
    expect(peaks).toHaveLength(30);
    expect(peaks[29]).toBe(55);
    expect(peaks[28]).toBeNull();
    expect(peaks[27]).toBe(12);
    expect(peaks.filter((v) => v != null)).toHaveLength(2);
    expect(lastValue(peaks)).toBe(55);
  });

  it("ignores samples without a week window", () => {
    const peaks = dailyPeaks([sample(NOW, 40, "five_hour_only"), sample(NOW, null)], NOW);
    expect(hasReadout(peaks)).toBe(false);
    expect(lastValue(peaks)).toBeNull();
  });

  it("breaks the line at a missing day", () => {
    expect(linePath([0, 50, null, 100], 30, 100)).toBe("M0,100 L10,50 M30,0");
    expect(linePath([null, null], 10, 10)).toBe("");
  });
});

describe("sign-in", () => {
  it("adds a new profile and signs an existing one in through its tool", () => {
    expect(signInArgs("claude", "work", false)).toEqual(["add", "work", "--provider", "claude"]);
    expect(signInArgs("claude", "work", true)).toEqual(["run", "work", "--provider", "claude"]);
    expect(signInArgs("codex", "side", true)).toEqual(["run", "side", "--provider", "codex", "login"]);
  });

  it("calls a different identity a mismatch only when one was known", () => {
    expect(signInOutcome("a@x.test", "A@x.test")).toBe("verified");
    expect(signInOutcome(null, "b@x.test")).toBe("verified");
    expect(signInOutcome("a@x.test", "b@x.test")).toBe("mismatch");
    expect(signInOutcome("a@x.test", null)).toBe("unfinished");
  });

  it("blocks providers that can't be added here", () => {
    expect(addBlocked("claude")).toBeNull();
    expect(addBlocked("antigravity")).toMatch(/monitor-only/);
    expect(addBlocked("gemini")).toMatch(/no backend/);
  });
});
