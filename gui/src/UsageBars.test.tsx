import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UsageBars, utilColor } from "./UsageBars.js";
import type { UsageSnapshot } from "./transforms.js";

beforeEach(() => cleanup());

const snap = (resetsAt: string | null): UsageSnapshot => ({
  windows: [{ key: "seven_day", label: "All", utilization: 82, resetsAt }],
  routines: null,
  capturedAt: "2026-07-16T00:00:00.000Z",
});

describe("UsageBars", () => {
  it("shows the reset time from cache even when STALE (regression: reset was hidden on stale)", () => {
    const resetsAt = new Date(Date.now() + 3 * 24 * 3600_000).toISOString(); // ~3 days out
    render(<UsageBars usage={snap(resetsAt)} stale={true} />);
    expect(screen.getByText("82%")).toBeTruthy(); // last-known value still shown
    expect(screen.getByText(/\dd/)).toBeTruthy(); // reset countdown ("3d …") rendered while stale
  });

  it("shows the reset time when fresh too", () => {
    const resetsAt = new Date(Date.now() + 5 * 3600_000).toISOString(); // ~5 hours out
    render(<UsageBars usage={snap(resetsAt)} stale={false} />);
    expect(screen.getByText("82%")).toBeTruthy();
    expect(screen.getByText(/\dh/)).toBeTruthy();
  });

  it("renders N.A. with no reset when the value is unknown", () => {
    render(<UsageBars usage={snap(null)} stale={false} />);
    // A null-utilization window (placeholder) → N.A., no percent, no reset.
    render(<UsageBars usage={{ windows: [{ key: "x", label: "5h", utilization: null, resetsAt: null }], routines: null, capturedAt: "x" }} stale={false} />);
    expect(screen.getAllByText("N.A.").length).toBeGreaterThan(0);
  });
});

describe("utilColor", () => {
  it("greens headroom, ambers ≥70, reds ≥90", () => {
    expect(utilColor(10)).toContain("--success");
    expect(utilColor(75)).toBe("#d9a343");
    expect(utilColor(95)).toContain("--destructive");
  });
});
