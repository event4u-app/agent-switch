import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { V3Tray } from "./tray.js";
import type { RowSession } from "./sessions.js";

afterEach(cleanup);
const s = (key: string, over: Partial<RowSession> = {}): RowSession => ({ key, title: `session ${key}`, state: "idle", account: { name: "work", nearLimit: false }, branch: null, pr: null, children: [], needsYou: false, ...over });
const on = () => ({ verb: vi.fn(), moreNeeds: vi.fn(), away: vi.fn(), session: vi.fn(), moreSessions: vi.fn(), account: vi.fn(), signIn: vi.fn(), start: vi.fn(), open: vi.fn() });

describe("tray (spec §10.7)", () => {
  it("Needs you, Sessions (5 rows in the shared order, then N more), Limits, Start and Open — in that order", () => {
    const handlers = on();
    const sessions = [1, 2, 3, 4, 5, 6, 7].map((i) => s(String(i), i === 7 ? { needsYou: true } : {}));
    const { container } = render(
      <V3Tray
        nowMs={0}
        needs={[{ id: "n", kind: "approval", subject: "x", who: "Theme system", what: "wants to run", verb: "Allow", since: "", version: "1" }]}
        away={null}
        sessions={sessions}
        accounts={[{ key: "claude/work", tool: "claude", name: "work", color: "teal", protect: 98, next: true, signIn: false, checkedMs: 0, windows: [{ label: "5h", used: 20, resetsAtMs: null, pace: null }] }]}
        on={handlers}
      />,
    );
    const text = container.textContent!;
    const at = (t: string) => text.indexOf(t);
    expect(at("Needs you")).toBeLessThan(at("Sessions"));
    expect(at("Sessions")).toBeLessThan(at("Limits"));
    expect(at("Limits")).toBeLessThan(at("Start session"));
    expect(screen.getByText("session 7"), "the waiting session comes first").toBeTruthy();
    expect(screen.queryByText("session 5")).toBeNull();
    fireEvent.click(screen.getByText("2 more ›"));
    expect(handlers.moreSessions).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Open Agent Switch"));
    expect(handlers.open).toHaveBeenCalledOnce();
  });
});
