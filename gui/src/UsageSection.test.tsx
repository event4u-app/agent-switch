import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// UsageSection's only IPC surface is the history fetch — mock it so the
// component is testable in jsdom (everything else arrives via props).
const usageHistoryMock = vi.hoisted(() => vi.fn());
vi.mock("./ipc.js", () => ({ usageHistory: usageHistoryMock }));

import {
  UsageSection,
  pickHeadroom,
  biggestConstraint,
  weekSeries,
  polylinePoints,
  extraWindows,
  type UsageHistoryCache,
} from "./UsageSection.js";
import type { UsageHistoryProfile } from "./ipc.js";
import type { ProfileRow, UsageSnapshot, UsageWindow } from "./transforms.js";
import type { UsageEntry } from "./usage-cache.js";

const NOW = Date.parse("2026-07-23T12:00:00Z");
const H = 3_600_000;
const D = 24 * H;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const win = (key: string, label: string, utilization: number | null, resetsAt: string | null = iso(2 * H)): UsageWindow => ({
  key,
  label,
  utilization,
  resetsAt,
});

const snapWith = (windows: UsageWindow[]): UsageSnapshot => ({
  windows,
  routines: null,
  capturedAt: iso(-4 * 60_000), // captured 4 minutes ago
});

const row = (name: string, active = false, label: ProfileRow["label"] = null): ProfileRow => ({
  provider: "claude",
  name,
  identity: null,
  label,
  active,
  liveSessions: 0,
});

const entry = (snap: UsageSnapshot): UsageEntry => ({ snap, fresh: true });

// Two claude profiles with the standard session + week window pair.
// personal: session 0 / week 15 · work: session 30 / week 52 → personal wins.
const defaultRows = [row("personal", false, "Personal"), row("work", true, "Work")];
const defaultUsage: Record<string, UsageEntry> = {
  "claude/personal": entry(snapWith([win("five_hour", "5h", 0, null), win("seven_day", "7d", 15, iso(49 * H))])),
  "claude/work": entry(snapWith([win("five_hour", "5h", 30), win("seven_day", "7d", 52, iso(37 * H))])),
};

function renderSection(over: Partial<Parameters<typeof UsageSection>[0]> = {}) {
  const onSwitch = vi.fn();
  const onHistory = vi.fn();
  const utils = render(
    <UsageSection
      rows={defaultRows}
      usage={defaultUsage}
      nowTick={NOW}
      history={{ claude: [] } as UsageHistoryCache}
      onHistory={onHistory}
      onSwitch={onSwitch}
      {...over}
    />,
  );
  return { onSwitch, onHistory, ...utils };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  usageHistoryMock.mockResolvedValue([]);
});

describe("pickHeadroom", () => {
  it("prefers the lowest week utilization; ties go to the first entry (stable)", () => {
    const a = snapWith([win("five_hour", "5h", 10), win("seven_day", "7d", 40)]);
    const b = snapWith([win("five_hour", "5h", 0), win("seven_day", "7d", 40)]);
    expect(pickHeadroom([{ name: "a", snap: a }, { name: "b", snap: b }])?.name).toBe("a");
    const c = snapWith([win("seven_day", "7d", 20)]);
    expect(pickHeadroom([{ name: "a", snap: a }, { name: "c", snap: c }])?.name).toBe("c");
  });

  it("falls back to the session window when nothing has week data, and null when nothing has data", () => {
    const s30 = snapWith([win("five_hour", "5h", 30)]);
    const s10 = snapWith([win("five_hour", "5h", 10)]);
    expect(pickHeadroom([{ name: "x", snap: s30 }, { name: "y", snap: s10 }])?.name).toBe("y");
    expect(pickHeadroom([{ name: "x", snap: null }, { name: "y", snap: null }])).toBeNull();
  });

  it("an account with week data beats a session-only account even at higher session use", () => {
    const weekOnly = snapWith([win("five_hour", "5h", 90), win("seven_day", "7d", 60)]);
    const sessionOnly = snapWith([win("five_hour", "5h", 5)]);
    expect(pickHeadroom([{ name: "w", snap: weekOnly }, { name: "s", snap: sessionOnly }])?.name).toBe("w");
  });
});

describe("UsageSection — headroom summary", () => {
  it("names the account with the most week headroom and renders the free/used sentence", async () => {
    renderSection();
    expect(await screen.findByText(/most headroom right now/i)).toBeTruthy();
    expect(screen.getByText("personal", { selector: ".text-sm" })).toBeTruthy(); // the summary name, not a tile
    expect(screen.getByText("85% of the week window free · 0% of the session window used")).toBeTruthy();
  });

  it("Switch to it switches to the picked (non-active) account", async () => {
    const { onSwitch } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /switch to it/i }));
    expect(onSwitch).toHaveBeenCalledWith("claude", "personal");
  });

  it("shows 'active' instead of a switch button when the picked account is already active", async () => {
    renderSection({
      rows: [row("personal", true, "Personal"), row("work", false, "Work")],
    });
    await screen.findByText(/most headroom right now/i);
    expect(screen.queryByRole("button", { name: /switch to it/i })).toBeNull();
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("a week-utilization tie picks the first profile (stable)", async () => {
    renderSection({
      usage: {
        "claude/personal": entry(snapWith([win("five_hour", "5h", 20), win("seven_day", "7d", 40)])),
        "claude/work": entry(snapWith([win("five_hour", "5h", 0), win("seven_day", "7d", 40)])),
      },
    });
    await screen.findByText(/most headroom right now/i);
    expect(screen.getByText("60% of the week window free · 20% of the session window used")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /switch to it/i }));
    // personal is first in the rows order → the tie goes to it
    expect(screen.getByText("personal", { selector: ".text-sm" })).toBeTruthy();
  });

  it("falls back to the session window when no account has week data", async () => {
    const { onSwitch } = renderSection({
      usage: {
        "claude/personal": entry(snapWith([win("five_hour", "5h", 10, null)])),
        "claude/work": entry(snapWith([win("five_hour", "5h", 30, null)])),
      },
    });
    await screen.findByText(/most headroom right now/i);
    // personal has the lower session use → picked; sentence has no week part
    expect(screen.getByText("10% of the session window used")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /switch to it/i }));
    expect(onSwitch).toHaveBeenCalledWith("claude", "personal");
  });

  it("renders the empty summary (no switch button) when no profile has any usage data", async () => {
    renderSection({ usage: {} });
    expect(await screen.findByText(/no usage data yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /switch to it/i })).toBeNull();
  });
});

describe("UsageSection — account tiles", () => {
  it("renders one tile per profile with label pill, window bars and per-window resets", async () => {
    renderSection();
    expect(await screen.findByText(/by account/i)).toBeTruthy();
    const grid = screen.getByTestId("usage-tiles");
    expect(grid.children).toHaveLength(2);
    expect(screen.getByText("Personal")).toBeTruthy(); // label pill
    expect(screen.getByText("15%")).toBeTruthy(); // personal week bar
    expect(screen.getByText("52%")).toBeTruthy(); // work week bar
    expect(screen.getByText("2d 1h")).toBeTruthy(); // personal week reset (49h)
    expect(screen.getByText("2h 0m")).toBeTruthy(); // work 5h reset
    expect(screen.getByText("1d 13h")).toBeTruthy(); // work week reset (37h)
  });

  it("shows per-model windows immediately — no expand affordance anywhere", async () => {
    const { container } = renderSection({
      usage: {
        ...defaultUsage,
        "claude/personal": entry(
          snapWith([
            win("five_hour", "5h", 0, null),
            win("seven_day", "7d", 15, iso(49 * H)),
            win("seven_day_opus", "7d Opus", 33, iso(49 * H)),
          ]),
        ),
      },
    });
    await screen.findByText(/by account/i);
    expect(screen.getByText("7d Opus")).toBeTruthy(); // visible without any interaction
    expect(screen.getByText("33%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /per-model usage/i })).toBeNull();
    expect(container.querySelector("[aria-expanded]")).toBeNull();
  });

  it("orders the active profile first, then input order", async () => {
    renderSection(); // work is active, personal comes first in the rows
    await screen.findByText(/by account/i);
    const grid = screen.getByTestId("usage-tiles");
    expect(grid.children[0].textContent).toContain("work");
    expect(grid.children[1].textContent).toContain("personal");
  });

  it("marks the active profile with a Active indicator, not colour alone", async () => {
    renderSection();
    await screen.findByText(/by account/i);
    const grid = screen.getByTestId("usage-tiles");
    const active = screen.getByText("Active");
    expect(grid.contains(active)).toBe(true);
    expect(screen.getAllByText("Active")).toHaveLength(1); // only the active tile
  });

  it("headlines each tile with its biggest-constraint window", async () => {
    renderSection();
    expect(await screen.findByText("15% of week used")).toBeTruthy(); // personal: week 15 > session 0
    expect(screen.getByText("52% of week used")).toBeTruthy(); // work: week 52 > session 30
    cleanup();
    // session-only snapshot → the session window is the constraint
    renderSection({
      usage: { "claude/personal": entry(snapWith([win("five_hour", "5h", 30, null)])) },
    });
    expect(await screen.findByText("30% of session used")).toBeTruthy();
  });

  it("headlines a window at ≥90% utilization with the near-limit warning", async () => {
    renderSection({
      usage: {
        ...defaultUsage,
        "claude/work": entry(snapWith([win("five_hour", "5h", 12), win("seven_day", "7d", 92, iso(6 * H + 20 * 60_000))])),
      },
    });
    expect(await screen.findByText("92% — near the limit")).toBeTruthy();
    expect(screen.getByText("92%")).toBeTruthy(); // the week bar itself stays a plain % readout
  });

  it("renders the no-readout slim tile for a profile without a snapshot", async () => {
    renderSection({
      rows: [...defaultRows, row("event4u")],
    });
    expect(await screen.findByText("No readout — sign in once to enable")).toBeTruthy();
    expect(screen.queryByTestId("sparkline-event4u")).toBeNull(); // slim variant: no sparkline area
  });

  it("renders a per-profile sparkline from the cached history", async () => {
    renderSection({
      history: {
        claude: [
          { profile: "personal", samples: [
            { at: iso(-10 * D), windows: [{ key: "seven_day", utilization: 30 }] },
            { at: iso(-1 * D), windows: [{ key: "seven_day", utilization: 20 }] },
          ] },
        ],
      },
    });
    await screen.findByText(/by account/i);
    const spark = screen.getByTestId("sparkline-personal");
    const line = spark.querySelector("polyline");
    expect(line).toBeTruthy();
    expect(line!.getAttribute("points")).not.toBe("");
    // work has no samples → caption instead of a fake flat line
    expect(screen.queryByTestId("sparkline-work")).toBeNull();
    expect(screen.getByText("No history yet")).toBeTruthy();
  });

  it("shows the no-history caption for every profile when nothing is sampled yet", async () => {
    renderSection({ history: { claude: [] } });
    await screen.findByText(/by account/i);
    expect(screen.getAllByText("No history yet")).toHaveLength(2);
    expect(screen.queryByTestId("sparkline-personal")).toBeNull();
  });
});

describe("UsageSection — history chart", () => {
  const historyFixture: UsageHistoryProfile[] = [
    {
      profile: "personal",
      samples: [
        { at: iso(-20 * D), windows: [{ key: "seven_day", utilization: 10 }] },
        { at: iso(-10 * D), windows: [{ key: "seven_day", utilization: 30 }] },
        { at: iso(-1 * D), windows: [{ key: "seven_day", utilization: 20 }] },
      ],
    },
    {
      profile: "work",
      samples: [
        { at: iso(-15 * D), windows: [{ key: "seven_day", utilization: 50 }] },
        { at: iso(-2 * D), windows: [{ key: "seven_day", utilization: 60 }] },
      ],
    },
  ];

  it("fetches history once on open when nothing is cached and hands it to the cache owner", async () => {
    const { onHistory } = renderSection({ history: {} });
    await waitFor(() => expect(usageHistoryMock).toHaveBeenCalledWith("claude"));
    await waitFor(() => expect(onHistory).toHaveBeenCalledWith("claude", []));
  });

  it("does not re-fetch when the provider's history is already cached", async () => {
    renderSection({ history: { claude: historyFixture } });
    await screen.findByText(/week window · last 30 days/i);
    expect(usageHistoryMock).not.toHaveBeenCalled();
  });

  it("shows the empty state until the daemon has written samples", async () => {
    renderSection({ history: { claude: [] } });
    expect(await screen.findByText(/history appears after the background service has been running for a while/i)).toBeTruthy();
  });

  it("renders one polyline per profile with samples, plus the legend", async () => {
    const { container } = renderSection({ history: { claude: historyFixture } });
    await screen.findByText(/week window · last 30 days/i);
    // Scoped to the comparison chart — the tiles render their own sparklines.
    const chart = container.querySelector('svg[aria-label*="per account"]');
    expect(chart).toBeTruthy();
    expect(chart!.querySelectorAll("polyline")).toHaveLength(2);
    const legend = screen.getByTestId("history-legend");
    expect(legend.textContent).toContain("personal");
    expect(legend.textContent).toContain("work");
    expect(screen.getByText("30 days ago")).toBeTruthy();
    expect(screen.getByText("today")).toBeTruthy();
  });

  it("weekSeries drops samples outside the 30-day window and without a week readout; points scale to the chart", () => {
    const series = weekSeries(
      [
        { at: iso(-40 * D), windows: [{ key: "seven_day", utilization: 99 }] }, // too old
        { at: iso(-5 * D), windows: [{ key: "five_hour", utilization: 50 }] }, // no week window
        { at: iso(-15 * D), windows: [{ key: "seven_day", utilization: 50 }] },
        { at: iso(-2 * D), windows: [{ key: "seven_day", utilization: null }] }, // unknown
      ],
      NOW,
    );
    expect(series).toEqual([{ t: NOW - 15 * D, util: 50 }]);
    // x = (30-15)/30 of the width, y = half the height at 50%
    expect(polylinePoints(series, NOW)).toBe("300.0,60.0");
  });
});

describe("UsageSection — footer + helpers", () => {
  it("shows the refreshed-ago scope line and the provider profile count", async () => {
    renderSection();
    expect(await screen.findByText("Refreshed 4m ago · own profiles only")).toBeTruthy();
    expect(screen.getByText("Claude · 2 profiles")).toBeTruthy();
  });

  it("degrades to the bare scope line when nothing was ever captured", async () => {
    renderSection({ usage: {} });
    expect(await screen.findByText("Own profiles only")).toBeTruthy();
  });

  it("extraWindows excludes the two primaries; biggestConstraint picks the highest-utilization window", () => {
    const snap = snapWith([
      win("five_hour", "5h", 10, iso(2 * H)),
      win("seven_day", "7d", 20, iso(49 * H)),
      win("seven_day_opus", "7d Opus", 5, iso(30 * H)),
    ]);
    expect(extraWindows(snap).map((w) => w.key)).toEqual(["seven_day_opus"]);
    expect(biggestConstraint(snap)?.key).toBe("seven_day");
    expect(biggestConstraint(null)).toBeNull();
    expect(biggestConstraint(snapWith([win("five_hour", "5h", null, null)]))).toBeNull();
    // tie → first window wins (stable)
    const tie = snapWith([win("five_hour", "5h", 40), win("seven_day", "7d", 40)]);
    expect(biggestConstraint(tie)?.key).toBe("five_hour");
  });
});
