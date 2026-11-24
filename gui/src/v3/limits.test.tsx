import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LimitsPopover, LimitsStrip, aheadOfPace, paceFor, tightest, tone, type LimitAccount } from "./limits.js";

afterEach(cleanup);
const NOW = Date.UTC(2026, 10, 2, 12);
const H = 3_600_000;
const acct = (over: Partial<LimitAccount> = {}): LimitAccount => ({
  key: "claude/side",
  tool: "claude",
  name: "side",
  color: "teal",
  protect: 98,
  next: false,
  signIn: false,
  checkedMs: NOW - 30_000,
  windows: [
    { label: "5h", used: 94, resetsAtMs: NOW + H + 18 * 60_000, pace: paceFor("5h", NOW + H + 18 * 60_000, NOW) },
    { label: "week", used: 40, resetsAtMs: NOW + 3 * 86_400_000, pace: paceFor("week", NOW + 3 * 86_400_000, NOW) },
  ],
  ...over,
});

describe("limits rows by keyboard (8.6)", () => {
  it("Enter and Space on a focused row open its popover; a key on its sign-in link does not", () => {
    const onOpen = vi.fn();
    render(<LimitsStrip accounts={[acct(), acct({ key: "claude/home", name: "home", signIn: true, windows: [] })]} nowMs={NOW} openKey={null} onOpen={onOpen} onSignIn={vi.fn()} />);
    const row = screen.getByText("side").closest("[role=button]") as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onOpen.mock.calls).toEqual([["claude/side"], ["claude/side"]]);
    fireEvent.keyDown(screen.getByText("Sign in ›"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe("limits (spec §5.3, §7.5)", () => {
  it("pace is the share even use would have spent by now", () => {
    expect(paceFor("5h", NOW + H + 18 * 60_000, NOW)).toBe(74);
    expect(paceFor("week", NOW + 3.5 * 86_400_000, NOW)).toBe(50);
    expect(paceFor("week · Opus", NOW + 7 * 86_400_000, NOW)).toBe(0);
    expect(paceFor("monthly", NOW + H, NOW)).toBeNull();
    expect(paceFor("5h", null, NOW)).toBeNull();
  });

  it("colours from the account's protect value: amber from protect − 15, red from protect", () => {
    expect([tone(82, 98), tone(83, 98), tone(97, 98), tone(98, 98), tone(null, 98)]).toEqual(["ok", "warn", "warn", "alert", "none"]);
  });

  it("the strip (proposal D): every row the same columns — account and tool · bar · used · reset; Claude first", () => {
    const onOpen = vi.fn();
    render(<LimitsStrip accounts={[acct({ key: "codex/w", tool: "codex", name: "work", windows: [{ label: "5h", used: 10, resetsAtMs: NOW + 3 * H, pace: null }] }), acct()]} nowMs={NOW} openKey={null} onOpen={onOpen} onSignIn={vi.fn()} />);
    expect(screen.getByText("· 5h")).toBeTruthy();
    expect(screen.getByText("resets")).toBeTruthy();
    const rows = screen.getAllByRole("button");
    expect(rows[0].textContent).toBe("side · Claude94%↻ 1h 18m");
    expect(rows[1].textContent).toBe("work · Codex10%↻ 3h");
    expect(rows[0].className).toBe(rows[1].className);
    expect(screen.queryByTestId("pace-tick"), "no tick on small bars").toBeNull();
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith("claude/side");
    expect(tightest(acct())!.label).toBe("5h");
  });

  it("a window near its limit other than 5h names itself; otherwise the row shows 5h", () => {
    render(<LimitsStrip accounts={[acct({ windows: [{ label: "5h", used: 20, resetsAtMs: null, pace: null }, { label: "week", used: 90, resetsAtMs: null, pace: null }] })]} nowMs={NOW} openKey={null} onOpen={vi.fn()} onSignIn={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toBe("side · Claude · week90%");
  });

  it("an old reading is italic with its age on hover; a signed-out account's row is its sign-in", () => {
    const onSignIn = vi.fn();
    render(<LimitsStrip accounts={[acct({ checkedMs: NOW - 14 * 60_000 }), acct({ key: "claude/x", name: "x", signIn: true })]} nowMs={NOW} openKey={null} onOpen={vi.fn()} onSignIn={onSignIn} />);
    const old = screen.getByText("94%");
    expect(old.className).toContain("italic");
    expect(old.closest("[role=button]")!.getAttribute("title")).toMatch(/^Read 14m old — refreshing/);
    fireEvent.click(screen.getByText("Sign in ›"));
    expect(onSignIn).toHaveBeenCalledWith("claude/x");
  });

  it("the popover: every window with its pace tick, the pace in words, actions that never switch by themselves", () => {
    const onMove = vi.fn();
    render(<LimitsPopover a={acct()} nowMs={NOW} onMove={onMove} onAccounts={vi.fn()} />);
    expect(screen.getAllByTestId("pace-tick")).toHaveLength(2);
    expect(screen.getByText("5h runs ahead")).toBeTruthy();
    expect(screen.getByText(/94% used, 74% expected by now/)).toBeTruthy();
    expect(screen.getByText("Tick = even pace · amber from 83%, red from 98%")).toBeTruthy();
    expect(screen.getByText("Near limit")).toBeTruthy();
    fireEvent.click(screen.getByText("Move its session…"));
    expect(onMove).toHaveBeenCalledOnce();
    expect(aheadOfPace(acct({ windows: [{ label: "5h", used: 50, resetsAtMs: null, pace: 45 }] }))).toEqual([]);
  });
});
