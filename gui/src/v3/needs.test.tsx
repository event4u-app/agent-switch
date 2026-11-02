import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NeedsZone, keysFor, nextFocus, type NeedItem } from "./needs.js";

afterEach(cleanup);
const item = (id: string, kind: NeedItem["kind"], over: Partial<NeedItem> = {}): NeedItem => ({ id, kind, subject: id, who: `who-${id}`, what: kind, verb: "Allow", since: "2026-11-02T10:00:00Z", version: "1", ...over });

describe("Needs-you zone (spec §5.1)", () => {
  it("hidden when nothing waits", () => {
    const { container } = render(<NeedsZone items={[]} away={null} onVerb={vi.fn()} onMore={vi.fn()} onAway={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("at most three rows, the top one open with its detail, then 'N more'", () => {
    const items = [item("a", "approval", { detail: "npx vitest run src/v3" }), item("b", "question", { verb: "Reply" }), item("c", "limit", { verb: "Decide" }), item("d", "signin", { verb: "Sign in" }), item("e", "update", { verb: "Update" })];
    const more = vi.fn();
    render(<NeedsZone items={items} away={null} onVerb={vi.fn()} onMore={more} onAway={vi.fn()} />);
    expect(screen.getByText("npx vitest run src/v3")).toBeTruthy();
    expect(screen.queryByText("who-d")).toBeNull();
    fireEvent.click(screen.getByText("2 more ›"));
    expect(more).toHaveBeenCalledOnce();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("the verb button answers for its item; a focused item further down shows with its keys", () => {
    const onVerb = vi.fn();
    const items = [item("a", "approval"), item("b", "question", { verb: "Reply" }), item("c", "limit", { verb: "Decide" }), item("d", "ci", { verb: "Fix" })];
    render(<NeedsZone items={items} away={null} focusedId="d" onVerb={onVerb} onMore={vi.fn()} onAway={vi.fn()} />);
    expect(screen.getByText("↵ fix · L later")).toBeTruthy();
    fireEvent.click(screen.getByText("Fix"));
    expect(onVerb).toHaveBeenCalledWith(items[3]);
  });

  it("one row for a long absence, never several", () => {
    const onAway = vi.fn();
    render(<NeedsZone items={[]} away={{ finishedTurns: 3, stoppedOnError: 1, resolved: 0, mergedPrs: 2, ciBreaks: 0 }} onVerb={vi.fn()} onMore={vi.fn()} onAway={onAway} />);
    fireEvent.click(screen.getByText("While you were away · 6 updates ›"));
    expect(onAway).toHaveBeenCalledOnce();
  });

  it("keys per kind, and where AS cannot answer the keys say so (D-approve)", () => {
    expect(keysFor(item("a", "approval"))).toBe("↵ once · ⇧↵ always · ⌫ deny · L later");
    expect(keysFor(item("a", "question", { verb: "Reply" }))).toBe("↵ reply · Y yes · L later");
    expect(keysFor(item("a", "approval", { verb: "Focus terminal" }))).toBe("↵ focus terminal · L later");
  });

  it("⌘J walks the queue and wraps", () => {
    const items = [item("a", "approval"), item("b", "ci")];
    expect(nextFocus(items, null)).toBe("a");
    expect(nextFocus(items, "a")).toBe("b");
    expect(nextFocus(items, "b")).toBe("a");
    expect(nextFocus([], "a")).toBeNull();
  });
});
