/**
 * road-to-service-executed-moves 3.2: a move the app handed to the background
 * service reaches the user as a notice when the service is done with it — a
 * resume opens in the app's terminal on one click.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { SwitchRequestRow } from "../ipc.js";
import { useServiceOutcomes } from "./service-outcomes.js";

const T0 = Date.parse("2026-11-06T12:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function row(over: Partial<SwitchRequestRow>): SwitchRequestRow {
  return {
    id: "r",
    rev: 2,
    session: "claude/work/sid-1",
    account: "claude/work",
    reason: { window: "five_hour", fill: 92, resetsAt: null },
    raisedBy: "as",
    raisedAt: at(-1_000),
    expiresAt: at(3_600_000),
    state: "approved",
    candidates: [],
    decision: { kind: "approve", target: "claude/home", how: "now", by: "as-gui", at: at(0) },
    ...over,
  };
}

function mount(initial: SwitchRequestRow[]) {
  const toast = vi.fn();
  const open = vi.fn();
  const hook = renderHook(({ rows }) => useServiceOutcomes(rows, { toast, open }, T0), { initialProps: { rows: initial } });
  return { toast, open, update: (rows: SwitchRequestRow[]) => hook.rerender({ rows }) };
}

describe("useServiceOutcomes", () => {
  it("a finished move is one notice; a resume opens in the app's terminal on one click", () => {
    const { toast, open, update } = mount([row({ id: "a" })]);
    expect(toast).not.toHaveBeenCalled();
    const done = row({ id: "a", state: "done", outcome: { at: at(4_000), ok: true, detail: "moved to claude/home", resume: "agent-switch run home -- --resume sid-1" } });
    update([done]);
    expect(toast).toHaveBeenCalledTimes(1);
    const n = toast.mock.calls[0][0];
    expect(n.tone).toBe("ok");
    expect(n.text).toMatch(/moved to claude\/home/);
    n.action.run();
    expect(open).toHaveBeenCalledWith({ kind: "terminal", run: expect.objectContaining({ args: ["run", "home", "--", "--resume", "sid-1"] }) });
    update([{ ...done, rev: 3 }]); // re-read: no second notice
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("a failed move is an alert with the reason, and no action", () => {
    const { toast, update } = mount([row({ id: "b" })]);
    update([row({ id: "b", state: "failed", outcome: { at: at(4_000), ok: false, detail: "rebind refused: busy" } })]);
    const n = toast.mock.calls[0][0];
    expect(n.tone).toBe("alert");
    expect(n.text).toMatch(/rebind refused: busy/);
    expect(n.action).toBeUndefined();
  });

  it("a move the app carried out itself, or one finished before the window opened, is not announced", () => {
    const { toast, update } = mount([]);
    update([
      row({ id: "app", state: "done", outcome: { at: at(0), ok: true, detail: "moved in the app" } }),
      row({ id: "old", state: "done", decision: { kind: "approve", target: "claude/home", how: "now", by: "as-gui", at: at(-90_000) }, outcome: { at: at(-60_000), ok: true, detail: "moved" } }),
    ]);
    expect(toast).not.toHaveBeenCalled();
  });
});
