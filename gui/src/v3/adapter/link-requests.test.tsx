/**
 * Road-to-the-agent-config-link 4.2: the v3 decision sheet and the switch
 * requests it shares with agent-config. The app carries a move out itself and
 * records the answer; agent-config's question opens the sheet; an answer given
 * in agent-config closes it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SwitchRequestRow } from "../../ipc.js";
import { emptyViewModel } from "../../vm/load.js";
import { requestsForMoves } from "../../vm/switch-requests.js";
import { installMemoryStorage } from "../../redesign/engines/test-storage.js";
import { V3Window } from "../window.js";
import { data, NOW, slots } from "../window-fixture.js";
import { dispatchV3, type DispatchDeps } from "./actions.js";
import { decisionFor, linkFor } from "./data.js";

installMemoryStorage();
afterEach(() => {
  cleanup();
  localStorage.clear?.();
});

const later = new Date(NOW + 600_000).toISOString();
const req = (over: Partial<SwitchRequestRow>): SwitchRequestRow => ({
  id: "r1",
  rev: 1,
  session: null,
  account: "claude/work",
  reason: { window: "five_hour", fill: 92, resetsAt: null },
  raisedBy: "as",
  raisedAt: new Date(NOW).toISOString(),
  expiresAt: later,
  state: "open",
  candidates: [],
  ...over,
});
const decided = (over: Partial<SwitchRequestRow>) => req({ state: "approved", decision: { kind: "approve", target: "claude/home", by: "ac", at: new Date(NOW).toISOString() }, ...over });

describe("requestsForMoves", () => {
  it("each moved session answers its own request, else its account's — each request once", () => {
    const rows = [req({ id: "own", session: "claude/work/a" }), req({ id: "acct" })];
    const moves = [
      { key: "claude/work/a", target: "home" },
      { key: "claude/work/b", target: "lab" },
      { key: "claude/work/c", target: "home" },
    ];
    expect(requestsForMoves(rows, moves, NOW)).toEqual([
      { id: "own", key: "claude/work/a", to: "claude/home" },
      { id: "acct", key: "claude/work/b", to: "claude/lab" },
    ]);
  });

  it("skips requests that are answered, expired, or for another account", () => {
    const rows = [decided({ id: "done" }), req({ id: "old", expiresAt: new Date(NOW - 1).toISOString() }), req({ id: "other", account: "claude/home" })];
    expect(requestsForMoves(rows, [{ key: "claude/work/a", target: "home" }], NOW)).toEqual([]);
  });
});

describe("linkFor", () => {
  it("lists agent-config's open questions and the accounts it already answered", () => {
    const vm = { ...emptyViewModel(), switchRequests: [req({ id: "q", raisedBy: "ac" }), req({ id: "mine" }), decided({ id: "a", account: "claude/home" }), req({ id: "x", raisedBy: "ac", expiresAt: new Date(NOW - 1).toISOString() })] };
    expect(linkFor(vm, NOW)).toEqual({ asked: [{ id: "q", account: "claude/work" }], answered: ["claude/home"] });
  });

  it("an answer the app gave itself is not 'answered elsewhere'", () => {
    const vm = { ...emptyViewModel(), switchRequests: [decided({ decision: { kind: "approve", by: "as-gui", at: new Date(NOW).toISOString() } })] };
    expect(linkFor(vm, NOW).answered).toEqual([]);
  });
});

describe("a move from the sheet records its answer", () => {
  function deps(rows: SwitchRequestRow[]) {
    const decide = vi.fn(async () => {});
    const d = {
      ipc: { takeoverHosted: vi.fn(async () => {}), continueSession: vi.fn(async () => {}), decideSwitchRequest: decide } as unknown as DispatchDeps["ipc"],
      act: { rebind: vi.fn(async () => {}), armRebind: vi.fn(async () => {}) },
      open: vi.fn(),
      toast: vi.fn(),
      openUrl: vi.fn(),
      refresh: vi.fn(),
      rows: () => new Map(),
      needs: () => [],
      requests: () => rows,
      hosted: () => false,
      setAppearance: vi.fn(),
      setFocusTerminal: vi.fn(),
      prompt: vi.fn(),
    } satisfies DispatchDeps;
    return { d, decide };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  // Requests expire relative to the real clock in the dispatcher.
  const live = (over: Partial<SwitchRequestRow>) => req({ expiresAt: new Date(Date.now() + 600_000).toISOString(), ...over });

  it("every checked session gets one decision, marked as carried out by the app", async () => {
    const { d, decide } = deps([live({ id: "ra", session: "claude/work/a" }), live({ id: "rb", session: "claude/work/b" })]);
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }, { key: "claude/work/b", target: "lab" }] }, d);
    await flush();
    expect(d.act.rebind).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith("ra", "approve", { to: "claude/home", how: "now", executed: "moved in the app" });
    expect(decide).toHaveBeenCalledWith("rb", "approve", { to: "claude/lab", how: "now", executed: "moved in the app" });
  });

  it("after the turn is recorded as armed; a brief records nothing", async () => {
    const { d, decide } = deps([live({ id: "r" })]);
    await dispatchV3({ type: "move", how: "after-turn", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    await flush();
    expect(decide).toHaveBeenCalledWith("r", "approve", { to: "claude/home", how: "after-turn", executed: "armed in the app; moves after this turn" });
    decide.mockClear();
    await dispatchV3({ type: "move", how: "brief", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    await flush();
    expect(decide).not.toHaveBeenCalled();
  });

  it("a failed record does not undo the move", async () => {
    const { d, decide } = deps([live({ id: "r" })]);
    decide.mockRejectedValueOnce(new Error("cli down"));
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    await flush();
    expect(d.act.rebind).toHaveBeenCalledWith("claude:a", "claude:home");
    expect(d.toast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: "error" }));
  });
});

describe("with the background service as executor (road-to-service-executed-moves 3.1)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const live = (over: Partial<SwitchRequestRow>) => req({ expiresAt: new Date(Date.now() + 600_000).toISOString(), ...over });
  const cand = (target: string, how: string[]) => ({ target, provider: target.split("/")[0], fill: 10, resetsAt: null, how });
  function deps(rows: SwitchRequestRow[], executor: "app" | "service" = "service") {
    const decide = vi.fn(async (): Promise<boolean> => true);
    const d = {
      ipc: { takeoverHosted: vi.fn(async () => {}), continueSession: vi.fn(async () => {}), decideSwitchRequest: decide } as unknown as DispatchDeps["ipc"],
      act: { rebind: vi.fn(async () => {}), armRebind: vi.fn(async () => {}) },
      open: vi.fn(),
      toast: vi.fn(),
      openUrl: vi.fn(),
      refresh: vi.fn(),
      rows: () => new Map(),
      needs: () => [],
      requests: () => rows,
      hosted: () => true,
      executor: vi.fn(async () => executor),
      setAppearance: vi.fn(),
      setFocusTerminal: vi.fn(),
      prompt: vi.fn(),
    } satisfies DispatchDeps;
    return { d, decide };
  }

  it("on: one decision per session, without --executed, and the app moves nothing", async () => {
    const { d, decide } = deps([live({ id: "ra", session: "claude/work/a", candidates: [cand("claude/home", ["after-turn", "now"])] }), live({ id: "rb", session: "claude/work/b", candidates: [cand("claude/lab", ["now"])] })]);
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }, { key: "claude/work/b", target: "lab", via: "takeover" }] }, d);
    await flush();
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith("ra", "approve", { to: "claude/home", how: "now" });
    expect(decide).toHaveBeenCalledWith("rb", "approve", { to: "claude/lab", how: "now" });
    expect(d.act.rebind).not.toHaveBeenCalled();
    expect(d.ipc.takeoverHosted).not.toHaveBeenCalled();
    expect(d.ipc.continueSession).not.toHaveBeenCalled();
    expect(d.open).not.toHaveBeenCalled();
  });

  it("on: a Codex move after the turn is handed over as now (Codex has no live switch)", async () => {
    const { d, decide } = deps([live({ id: "rc", account: "codex/one", session: "codex/one/s", candidates: [cand("codex/two", ["now", "handoff"])] })]);
    await dispatchV3({ type: "move", how: "after-turn", moves: [{ key: "codex/one/s", target: "two" }] }, d);
    await flush();
    expect(decide).toHaveBeenCalledWith("rc", "approve", { to: "codex/two", how: "now" });
    expect(d.ipc.takeoverHosted).not.toHaveBeenCalled();
  });

  it("on: a session with no open request, or a target the request does not offer, is moved by the app as before", async () => {
    const { d, decide } = deps([live({ id: "ra", session: "claude/work/a", candidates: [cand("claude/home", ["now"])] })]);
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "lab" }, { key: "claude/work/b", target: "home" }] }, d);
    await flush();
    expect(d.act.rebind).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith("ra", "approve", { to: "claude/lab", how: "now", executed: "moved in the app" });
  });

  it("on: when handing over fails, the app moves the session itself", async () => {
    const { d, decide } = deps([live({ id: "ra", session: "claude/work/a", candidates: [cand("claude/home", ["now"])] })]);
    decide.mockRejectedValueOnce(new Error("already decided"));
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    await flush();
    expect(d.act.rebind).toHaveBeenCalledWith("claude:a", "claude:home");
  });

  it("on: a request for a whole account is not handed over; the app moves its sessions as before", async () => {
    const { d, decide } = deps([live({ id: "acct", candidates: [cand("claude/home", ["now"])] })]);
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }, { key: "claude/work/b", target: "home" }] }, d);
    await flush();
    expect(d.act.rebind).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith("acct", "approve", { to: "claude/home", how: "now", executed: "moved in the app" });
    expect(decide).not.toHaveBeenCalledWith("acct", "approve", { to: "claude/home", how: "now" });
  });

  it("on: an answer the store did not apply (answered elsewhere, expired) is not a hand-over; the app moves", async () => {
    const { d, decide } = deps([live({ id: "ra", session: "claude/work/a", candidates: [cand("claude/home", ["now"])] })]);
    decide.mockResolvedValueOnce(false);
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    await flush();
    expect(d.act.rebind).toHaveBeenCalledWith("claude:a", "claude:home");
    expect(d.toast).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/background service moves/) }));
  });

  it("on: a brief stays in the app", async () => {
    const { d, decide } = deps([live({ id: "ra", session: "claude/work/a", candidates: [cand("codex/x", ["handoff"])] })]);
    await dispatchV3({ type: "move", how: "brief", moves: [{ key: "claude/work/a", target: "x" }] }, d);
    await flush();
    expect(decide).not.toHaveBeenCalled();
    expect(d.open).toHaveBeenCalled();
  });

  it("off: today's behaviour — the app moves and records --executed", async () => {
    const { d, decide } = deps([live({ id: "ra", session: "claude/work/a", candidates: [cand("claude/home", ["now"])] })], "app");
    await dispatchV3({ type: "move", how: "now", moves: [{ key: "claude/work/a", target: "home" }] }, d);
    await flush();
    expect(d.act.rebind).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith("ra", "approve", { to: "claude/home", how: "now", executed: "moved in the app" });
  });
});

describe("the sheet follows agent-config", () => {
  const sheet = () => screen.queryByText(/Nothing changes until you choose/);

  it("a limit agent-config already answered does not open the sheet", () => {
    const act = vi.fn();
    render(<V3Window data={{ ...data(), link: { asked: [], answered: ["claude/work"] } }} slots={slots} act={act} autoOpenLimits />);
    expect(sheet()).toBeNull();
    expect(act).not.toHaveBeenCalled();
  });

  it("agent-config's question opens the sheet before the limit, once per request", () => {
    const quiet = { ...data(), needs: [], link: { asked: [{ id: "q1", account: "claude/work" }], answered: [] } };
    const act = vi.fn();
    render(<V3Window data={quiet} slots={slots} act={act} autoOpenLimits />);
    expect(sheet()).toBeTruthy();
    expect(act).toHaveBeenCalledWith({ type: "reveal" });
    cleanup();
    render(<V3Window data={quiet} slots={slots} act={vi.fn()} autoOpenLimits />);
    expect(sheet()).toBeNull();
  });

  it("an answer given in agent-config closes the open sheet", () => {
    const { rerender } = render(<V3Window data={data()} slots={slots} act={vi.fn()} autoOpenLimits />);
    expect(sheet()).toBeTruthy();
    rerender(<V3Window data={{ ...data(), link: { asked: [], answered: ["claude/work"] } }} slots={slots} act={vi.fn()} autoOpenLimits />);
    expect(sheet()).toBeNull();
  });
});

describe("the sheet says agent-config asked", () => {
  const accounts = [
    { id: "claude:work", tool: "claude", name: "work", windows: [{ key: "five_hour", label: "5h", utilization: 92, resetsAt: null }], state: "ready" },
    { id: "claude:home", tool: "claude", name: "home", windows: [], state: "ready" },
  ] as never;
  const vmWith = (rows: SwitchRequestRow[]) => ({ ...emptyViewModel(NOW), accounts, switchRequests: rows });

  it("decisionFor flags an open question from agent-config, and only that", () => {
    expect(decisionFor("claude/work", vmWith([req({ raisedBy: "ac" })]), [], NOW)!.askedByAgentConfig).toBe(true);
    expect(decisionFor("claude/work", vmWith([req({ raisedBy: "as" })]), [], NOW)!.askedByAgentConfig).toBe(false);
    expect(decisionFor("claude/work", vmWith([req({ raisedBy: "ac", account: "claude/home" })]), [], NOW)!.askedByAgentConfig).toBe(false);
    expect(decisionFor("claude/work", vmWith([decided({ raisedBy: "ac" })]), [], NOW)!.askedByAgentConfig).toBe(false);
  });

  it("the badge sits in the sheet's header when agent-config asked, and not otherwise", () => {
    const base = data();
    const asked = { ...base, decision: (s: string) => ({ ...base.decision(s)!, askedByAgentConfig: true }) };
    const { rerender } = render(<V3Window data={asked} slots={slots} act={vi.fn()} autoOpenLimits />);
    expect(screen.getByText("agent-config asked")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("Near limit");
    rerender(<V3Window data={base} slots={slots} act={vi.fn()} autoOpenLimits />);
    expect(screen.queryByText("agent-config asked")).toBeNull();
  });
});
