import { describe, it, expect } from "vitest";
import { ago, countdown, duration, expiry, shortAge, shortPath } from "./format.js";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("countdown", () => {
  it("is null without a parseable instant", () => {
    expect(countdown(null, NOW)).toBeNull();
    expect(countdown(undefined, NOW)).toBeNull();
    expect(countdown("not a date", NOW)).toBeNull();
  });
  it("says now once the instant has passed", () => {
    expect(countdown(iso(0), NOW)).toBe("now");
    expect(countdown(iso(-5 * MIN), NOW)).toBe("now");
  });
  it("uses minutes, then hours+minutes, then days+hours", () => {
    expect(countdown(iso(42 * MIN), NOW)).toBe("42m");
    expect(countdown(iso(2 * HOUR + 10 * MIN), NOW)).toBe("2h 10m");
    expect(countdown(iso(4 * DAY + 22 * HOUR), NOW)).toBe("4d 22h");
  });
});

describe("ago", () => {
  it("rounds into the design's buckets", () => {
    expect(ago(NOW - 10_000, NOW)).toBe("just now");
    expect(ago(NOW - 4 * MIN, NOW)).toBe("4 min ago");
    expect(ago(NOW - 3 * HOUR, NOW)).toBe("3 h ago");
    expect(ago(NOW - 2 * DAY, NOW)).toBe("2 d ago");
  });
  it("never reports a negative age for a future timestamp", () => {
    expect(ago(NOW + HOUR, NOW)).toBe("just now");
  });
});

describe("duration", () => {
  it("formats minutes and hours", () => {
    expect(duration(NOW - 24 * MIN, NOW)).toBe("24m");
    expect(duration(NOW - (HOUR + 24 * MIN), NOW)).toBe("1h 24m");
    expect(duration(NOW + MIN, NOW)).toBe("0m");
  });
});

describe("shortAge", () => {
  it("says never for an unchecked value", () => {
    expect(shortAge(null, NOW)).toBe("never");
  });
  it("formats each unit", () => {
    expect(shortAge(NOW - 20_000, NOW)).toBe("now");
    expect(shortAge(NOW - 12 * MIN, NOW)).toBe("12m");
    expect(shortAge(NOW - 3 * HOUR, NOW)).toBe("3h");
    expect(shortAge(NOW - 50 * HOUR, NOW)).toBe("2d");
  });
});

describe("shortPath", () => {
  it("shortens macOS and Linux homes only", () => {
    expect(shortPath("/Users/matze/dev/agent-switch")).toBe("~/dev/agent-switch");
    expect(shortPath("/home/ana/x")).toBe("~/x");
    expect(shortPath("/opt/homebrew/bin/rtk")).toBe("/opt/homebrew/bin/rtk");
  });
});

describe("expiry", () => {
  it("covers every wording", () => {
    expect(expiry(null, NOW)).toBe("unknown");
    expect(expiry(NOW, NOW)).toBe("expired");
    expect(expiry(NOW - DAY, NOW)).toBe("expired");
    expect(expiry(NOW + 5 * HOUR, NOW)).toBe("today");
    expect(expiry(NOW + DAY + HOUR, NOW)).toBe("tomorrow");
    expect(expiry(NOW + 19 * DAY + HOUR, NOW)).toBe("in 19 days");
  });
});
