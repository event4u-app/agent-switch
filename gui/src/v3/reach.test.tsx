/**
 * Spec §11: every 2.11 function stays reachable in at most two clicks from the
 * main window. Each row starts from a fresh window and counts its clicks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Window } from "./window.js";
import { data, slots } from "./window-fixture.js";

afterEach(cleanup);
function open() {
  const act = vi.fn();
  render(<V3Window data={data()} slots={slots} act={act} />);
  let clicks = 0;
  const click = (el: Element) => (clicks++, fireEvent.click(el));
  return { act, click, clicks: () => clicks };
}
const stripe = (name: string) => screen.getByLabelText(name);

describe("every 2.11 function in ≤ 2 clicks (spec §11)", () => {
  it("Overview: needs you, running now, what's left — on screen", () => {
    const w = open();
    expect(screen.getByText("94% of 5h")).toBeTruthy();
    expect(within(screen.getByLabelText("Sessions window")).getByText("Event store")).toBeTruthy();
    expect(screen.getByText("Limits")).toBeTruthy();
    expect(w.clicks()).toBe(0);
  });

  it("Sessions list, filters, trash: the window, All sessions (palette), Library (stripe)", () => {
    const w = open();
    w.click(screen.getByText("Go to session, account, branch, PR, or run a command…"));
    w.click(screen.getByText("All sessions"));
    expect(screen.getByText("Scan, filter and act on many sessions at once.")).toBeTruthy();
    expect(w.clicks()).toBeLessThanOrEqual(2);
    cleanup();
    const v = open();
    v.click(stripe("Library"));
    expect(screen.getByText(/Pinned sessions are kept in the vault/)).toBeTruthy();
  });

  it("Session sheet: move, take over, hand off, compact — session row, then ⋯", () => {
    const w = open();
    w.click(within(screen.getByLabelText("Sessions window")).getByText("Event store"));
    w.click(screen.getByLabelText("Session actions: rename, pin, move, detach, end"));
    const menu = screen.getByRole("menu");
    for (const item of ["Move to another account…", "Take over here…", "Hand off…", "Compact"]) expect(within(menu).getByText(item)).toBeTruthy();
    expect(w.clicks()).toBe(2);
  });

  it("Near-limit decision: Needs-you Decide opens the same sheet, never automatic", () => {
    const w = open();
    expect(screen.queryByText("Nothing changes until you choose.", { exact: false })).toBeNull();
    w.click(screen.getByText("Decide"));
    expect(screen.getByText(/Nothing changes until you choose/)).toBeTruthy();
    expect(w.act).not.toHaveBeenCalled();
    expect(w.clicks()).toBe(1);
  });

  it("Accounts, sign-ins, usage history; pools and projects; protection", () => {
    const w = open();
    w.click(stripe("Accounts"));
    w.click(screen.getByRole("radio", { name: "Usage history" }));
    expect(screen.getByText("usage history view")).toBeTruthy();
    expect(w.clicks()).toBe(2);
    cleanup();
    const p = open();
    p.click(stripe("Accounts"));
    p.click(screen.getByRole("radio", { name: "Projects & pools 2" }));
    expect(screen.getByText("projects and pools view")).toBeTruthy();
    cleanup();
    const s = open();
    s.click(screen.getByLabelText("Settings ⌘,"));
    s.click(screen.getByRole("button", { name: "Protection" }));
    expect(screen.getByText("Protection section")).toBeTruthy();
    expect(s.clicks()).toBe(2);
  });

  it("Tools, agent-config card, updates — Tools page; the update is a Needs-you item", () => {
    const w = open();
    expect(screen.getByText("0.1 → 0.2")).toBeTruthy();
    w.click(stripe("Tools"));
    expect(screen.getByText("agent-config card")).toBeTruthy();
    expect(w.clicks()).toBe(1);
  });

  it("Apps (detected editors): Settings › Open in", () => {
    const w = open();
    w.click(screen.getByLabelText("Settings ⌘,"));
    w.click(screen.getByRole("button", { name: "Open in" }));
    expect(screen.getAllByText("VS Code").length).toBeGreaterThan(0);
    expect(screen.getByText("Default for the Open button (⌘O)")).toBeTruthy();
    expect(w.clicks()).toBe(2);
  });

  it("Agents (v3.2): Settings › Agents — class, local model, switch, Add agent", () => {
    const w = open();
    w.click(screen.getByLabelText("Settings ⌘,"));
    w.click(screen.getByRole("button", { name: "Agents" }));
    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("ACP")).toBeTruthy();
    expect(screen.getByText(/local · Ollama · qwen3-coder:30b/)).toBeTruthy();
    expect(w.clicks()).toBe(2);
    fireEvent.click(screen.getByRole("switch", { name: "Use OpenCode" }));
    expect(w.act).toHaveBeenCalledWith({ type: "agent-enabled", id: "opencode", value: false });
    fireEvent.click(screen.getByText("Add agent"));
    fireEvent.click(within(screen.getByRole("menu", { name: "Add agent" })).getByText("Goose"));
    expect(w.act).toHaveBeenCalledWith({ type: "agent-install", id: "goose" });
  });

  it("Remote (v3.2): Settings › Remote — stages off until turned on, R3 later, no paired devices yet", () => {
    const w = open();
    w.click(screen.getByLabelText("Settings ⌘,"));
    w.click(screen.getByRole("button", { name: "Remote" }));
    expect(w.clicks()).toBe(2);
    expect(screen.getByText("work · on")).toBeTruthy();
    expect(screen.getByText("not available yet")).toBeTruthy();
    expect(screen.getByText("No paired devices")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Own tunnel (SSH / Tailscale)" }));
    expect(w.act).toHaveBeenCalledWith({ type: "remote-ssh", value: true });
    fireEvent.click(screen.getByText("work · on"));
    expect(w.act).toHaveBeenCalledWith({ type: "remote-rc", account: "work", value: false });
  });

  it("Activity, notifications: the inbox behind the pill, with today's history", () => {
    const w = open();
    w.click(stripe("Sessions ⌘B"));
    w.click(screen.getByTitle("Needs you · ⌘J jumps to the next one"));
    expect(screen.getByText("Earlier today")).toBeTruthy();
    expect(w.clicks()).toBe(2);
  });

  it("Health: the title bar says the engine stopped", () => {
    open();
    expect(screen.getByText("Engine stopped")).toBeTruthy();
    expect(screen.getByText(/hosted session keeps running in tmux/)).toBeTruthy();
  });

  it("Start session with the routing explanation: Start, then Why?", () => {
    const w = open();
    w.click(screen.getByText("Start session"));
    w.click(screen.getByText("Why? ›"));
    expect(screen.getByText("work has the most room")).toBeTruthy();
    expect(w.clicks()).toBe(2);
  });
});

describe("v3.1 Review page", () => {
  it("Changes › Review changes opens a Review tab for the session; it closes like any page", () => {
    const act = vi.fn();
    const review = vi.fn((key: string) => <p>{`review of ${key}`}</p>);
    render(<V3Window data={{ ...data(), changes: () => [{ path: "a.ts", status: "M", added: 1, removed: 0 }] as never }} slots={{ ...slots, review }} act={act} />);
    fireEvent.click(within(screen.getByLabelText("Sessions window")).getByText("Event store"));
    fireEvent.click(screen.getByLabelText("Changes"));
    fireEvent.click(screen.getByText("Review changes"));
    expect(screen.getByText("review of s1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Review · Event store/ })).toBeTruthy();
    expect(act).not.toHaveBeenCalledWith({ type: "review", key: "s1" });
  });

  it("without a review slot, Review stays disabled", () => {
    render(<V3Window data={{ ...data(), changes: () => [{ path: "a.ts", status: "M", added: 1, removed: 0 }] as never }} slots={slots} act={vi.fn()} />);
    fireEvent.click(within(screen.getByLabelText("Sessions window")).getByText("Event store"));
    fireEvent.click(screen.getByLabelText("Changes"));
    expect((screen.getByText("Review changes").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
