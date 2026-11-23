import { describe, it, expect } from "vitest";
import { accountFromProfile } from "./build.js";
import { isStale } from "./rules.js";
import type { ProfileRow, UsageSnapshot } from "../transforms.js";

// The CLI may now answer `status --json` with a snapshot merged from Claude
// Code's statusline and a poll (extra optional fields per window and on the
// snapshot). The GUI reads it unchanged: bars from `windows`, age from `capturedAt`.
const NOW = Date.parse("2026-11-23T12:00:00Z");
const row: ProfileRow = { provider: "claude", name: "work", identity: "w@example.com", label: null, active: true, liveSessions: 1 };
const merged = (capturedAt: string): UsageSnapshot => JSON.parse(
  JSON.stringify({
    windows: [
      { key: "five_hour", label: "5h", utilization: 7, resetsAt: "2026-11-23T15:00:00Z", capturedAt: "2026-11-23T11:59:30Z", source: "statusline" },
      { key: "seven_day", label: "7d", utilization: 3, resetsAt: "2026-11-28T00:00:00Z", capturedAt: "2026-11-23T11:59:30Z", source: "statusline" },
      { key: "seven_day_opus", label: "7d Opus", utilization: 40, resetsAt: "2026-11-28T00:00:00Z", capturedAt, source: "poll" },
    ],
    routines: null,
    capturedAt,
    source: "merged",
  }),
);

describe("a statusline-sourced snapshot needs no GUI change", () => {
  it("renders every window and takes its age from capturedAt", () => {
    const a = accountFromProfile(row, merged("2026-11-23T11:58:00Z"));
    expect(a.windows.map((w) => [w.key, w.utilization])).toEqual([["five_hour", 7], ["seven_day", 3], ["seven_day_opus", 40]]);
    expect(a.checkedAt).toBe(Date.parse("2026-11-23T11:58:00Z"));
    expect(isStale(a.checkedAt, NOW)).toBe(false);
  });

  it("greys out once capturedAt is older than ten minutes", () => {
    const a = accountFromProfile(row, merged("2026-11-23T11:45:00Z"));
    expect(isStale(a.checkedAt, NOW)).toBe(true);
  });
});
