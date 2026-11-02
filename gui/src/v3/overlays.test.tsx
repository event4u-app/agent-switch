import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InboxPopover, Palette, PeekCard, Switcher, filterPalette, type PaletteEntry } from "./overlays.js";

afterEach(cleanup);
const NOW = Date.UTC(2026, 10, 2, 12);
const entries: PaletteEntry[] = [
  { id: "s1", group: "sessions", title: "Rebind ADR discussion", meta: "Library · kept", hint: "↵ Resume…", state: "idle", old: true },
  { id: "s2", group: "sessions", title: "Fix wedge on daemon restart", meta: "side · fix/wedge", state: "working" },
  { id: "b1", group: "branches", title: "#120 docs: ADR-003 rebind", meta: "merged" },
  { id: "c1", group: "commands", title: "Move session to another account…", meta: "opens the decision sheet", hint: "⌘⇧M" },
];

describe("⌘K palette (spec §7.1)", () => {
  it("filters on every word; '>' keeps commands only; 'Last week' hides older sessions", () => {
    expect(filterPalette(entries, "rebind", "all").map((e) => e.id)).toEqual(["s1", "b1"]);
    expect(filterPalette(entries, "> move", "all").map((e) => e.id)).toEqual(["c1"]);
    expect(filterPalette(entries, "", "week").map((e) => e.id)).toEqual(["s2", "b1", "c1"]);
  });

  it("grouped, the cursor row has the raise fill and its hint; ↓ and ↵ open, ⌘↵ in a new tab", () => {
    const onOpen = vi.fn();
    render(<Palette entries={entries} onOpen={onOpen} onClose={vi.fn()} />);
    expect(screen.getByText("Sessions")).toBeTruthy();
    expect(screen.getByText("Branches & PRs")).toBeTruthy();
    const first = screen.getAllByRole("option")[0];
    expect(first.className).toContain("bg-ac-raise");
    expect(screen.getByText("↵ Resume…")).toBeTruthy();
    const input = screen.getByLabelText("Search");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onOpen).toHaveBeenCalledWith(entries[1], true);
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
  });
});

describe("⌃Tab switcher, peek card, inbox (spec §7.2–§7.4)", () => {
  it("the current pick has the Marker; a waiting session says so", () => {
    render(
      <Switcher
        pick={1}
        onClose={vi.fn()}
        recent={[
          { key: "a", title: "Theme system", state: "needs-you", account: "work", color: "teal", branch: "feat/themes", needsYou: true },
          { key: "b", title: "Event store", state: "working", account: "work", color: "teal", branch: "feat/store", needsYou: false },
        ]}
      />,
    );
    const rows = screen.getAllByText(/Theme system|Event store/).map((t) => t.closest("[class*='h-11']")!);
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    expect(rows[1].querySelector(".border-l-ac-brand")).toBeTruthy();
    expect(screen.getByText("needs you")).toBeTruthy();
  });

  it("the peek card holds what left the row", () => {
    render(<PeekCard nowMs={NOW} f={{ title: "Event store", lastActiveMs: NOW - 5 * 60_000, tool: "Claude", account: "work", color: "teal", model: "Opus 5.5", thinking: "high", branch: "feat/store", pr: { number: 142, state: "open" }, children: 2, lastLine: "41 passed" }} />);
    expect(screen.getByText("5m ago")).toBeTruthy();
    expect(screen.getByText(/Claude · work · Opus 5.5 · high/)).toBeTruthy();
    expect(screen.getByText(/#142 open/)).toBeTruthy();
    expect(screen.getByText("41 passed")).toBeTruthy();
  });

  it("the inbox: the full queue with the first focused, 'All later', and today's history", () => {
    const onAllLater = vi.fn();
    render(
      <InboxPopover
        nowMs={NOW}
        focusedId={null}
        onVerb={vi.fn()}
        onAllLater={onAllLater}
        items={[{ id: "1", kind: "approval", subject: "s", who: "Theme system", what: "wants to run", verb: "Allow", since: "", version: "1" }]}
        history={[{ id: "h", who: "Checkout flow", what: "asked you", doneAt: new Date(NOW - 20 * 60_000).toISOString() }]}
      />,
    );
    expect(screen.getByText("↵ once · ⇧↵ always · ⌫ deny · L later")).toBeTruthy();
    expect(screen.getByText("Earlier today")).toBeTruthy();
    expect(screen.getByText("20m ago")).toBeTruthy();
    fireEvent.click(screen.getByText("All later"));
    expect(onAllLater).toHaveBeenCalledOnce();
  });
});
