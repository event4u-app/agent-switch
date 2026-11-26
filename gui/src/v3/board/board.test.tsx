import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { arenaModel, arenaPace, changed, matchCard, matchPace, phaseLabel, reasonOf } from "./arena-model.js";
import { ArenaBoard } from "./ArenaBoard.js";
import { BoardPage, boardTabs, pickTab } from "./BoardPage.js";
import { CouncilBoard, seatPlace, seatPlaceWithHuman, seatWidth, tableSeats } from "./CouncilBoard.js";
import { resultPreview, WorkflowBoard } from "./WorkflowBoard.js";
import type { BracketView, CouncilLive, CouncilMessage, CouncilView, Orchestration, Scores, WorkflowAgent, WorkflowRun } from "./types.js";
import { boardChildren, parseBoardChildId } from "../adapter/data.js";
import { boardOpens, childOpens } from "../sessions.js";

afterEach(cleanup);

const sc = (n: number): Scores => ({ correctness: n, requirements: n, robustness: n, clarity: n, efficiency: n });
const line = (id: string, status: BracketView["lines"][number]["status"], extra: Partial<BracketView["lines"][number]> = {}) => ({ id, lineage: id, status, attempts: 0, eliminations: 0, cards: 0, lostTo: [], lastLoss: null, hasOutput: true, approach: `${id} angle`, ...extra });

function bracket(over: Partial<BracketView> = {}): BracketView {
  return {
    run: "demo",
    dir: "agents/runtime/bracket/demo",
    taskTitle: "Sign the app",
    tier: "S1",
    round: 2,
    phase: "judging",
    champion: null,
    log: ["R1M1 L001 beats L002", "R1M2 L003 beats L004"],
    lines: [
      line("L001", "alive"),
      line("L002", "eliminated", { lostTo: ["L001"], eliminations: 1, lastLoss: { match: "R1M1", upheldFatal: false } }),
      line("L003", "alive", { cards: 1 }),
      line("L004", "eliminated", { lostTo: ["L003"], eliminations: 1, lastLoss: { match: "R1M2", upheldFatal: true } }),
      line("L005", "duplicate", { lineage: "L001" }),
    ],
    matches: [
      { id: "R1M1", round: 1, a: "L001", b: "L002", verdict: { a: sc(8), b: sc(6), fatal: { a: "none", b: "none" }, pick: "b" }, winner: "L001", loser: "L002", notes: ["pick b overruled by points (80 vs 60)"], signals: ["pick ≠ points"], appeal: "declined" },
      { id: "R1M2", round: 1, a: "L003", b: "L004", verdict: { a: sc(5), b: sc(9), fatal: { a: "none", b: "upheld" }, pick: "a" }, winner: "L003", loser: "L004", notes: ["upheld FATAL decides"], signals: [], appeal: null },
      { id: "R2M1", round: 2, a: "L001", b: "L003", verdict: null, winner: null, loser: null, notes: [], signals: [], appeal: null, judging: { agentId: "j1", doing: "Bash · npm test" } },
    ],
    ...over,
  };
}

describe("arena model", () => {
  it("says who is in, who is out, by whom and why; the lines in the ring are the open match's", () => {
    const m = arenaModel(bracket());
    expect([m.alive, m.out, m.total]).toEqual([2, 2, 5]);
    expect([...m.inRing].sort()).toEqual(["L001", "L003"]);
    const byId = new Map(m.lines.map((l) => [l.line.id, l]));
    expect(byId.get("L001")!.standing).toBe("fighting");
    expect(byId.get("L002")!.out).toEqual({ match: "R1M1", round: 1, by: "L001", reason: "on points (pick overruled)", score: "80 : 60" });
    expect(byId.get("L004")!.out!.reason).toBe("FATAL upheld");
    expect(byId.get("L005")!.copyOf).toBe("L001");
    expect(m.lines.map((l) => l.standing)).toEqual(["fighting", "fighting", "out", "out", "duplicate"]);
    expect(m.rounds.map((r) => [r.round, r.current, r.matches.length])).toEqual([[1, false, 2], [2, true, 1]]);
  });

  it("a judge's unrecorded verdict draws as provisional, with the engine's winner", () => {
    const b = bracket();
    b.matches[2].provisional = { verdict: { a: sc(7), b: sc(8), fatal: { a: "none", b: "none" }, pick: "a" }, winner: "L003", agentId: "j1", notes: ["pick a overruled by points (70 vs 80)"] };
    const c = matchCard(b.matches[2]);
    expect([c.state, c.winner, c.margin, c.provisional]).toEqual(["provisional", "L003", 10, true]);
    expect(reasonOf(b.matches[1], "L004")).toBe("FATAL upheld");
  });

  it("a champion once one line is left; the phase in words", () => {
    const done = bracket({ phase: "done", champion: "L001", lines: [line("L001", "alive"), line("L003", "eliminated")] });
    expect(arenaModel(done).lines[0].standing).toBe("champion");
    expect(phaseLabel(done)).toBe("L001 wins");
    expect(phaseLabel(bracket())).toBe("Round 2 — judges at work");
  });

  it("changed: a line that went out and a match that was decided since the last read", () => {
    const before = arenaModel(bracket());
    const after = bracket();
    after.lines[2] = line("L003", "eliminated", { lastLoss: { match: "R2M1", upheldFatal: false } });
    after.matches[2] = { ...after.matches[2], verdict: { a: sc(9), b: sc(4), fatal: { a: "none", b: "none" }, pick: "a" }, winner: "L001", loser: "L003" };
    const c = changed(before, arenaModel(after));
    expect([...c.knockedOut]).toEqual(["L003"]);
    expect([...c.decided]).toEqual(["R2M1"]);
    expect(changed(null, before).knockedOut.size).toBe(0);
  });
});

describe("ArenaBoard", () => {
  it("draws the field and the rounds; the ones out can be hidden and shown again", () => {
    render(<ArenaBoard view={bracket()} />);
    expect(screen.getByText("Sign the app")).toBeTruthy();
    expect(screen.getByText("Round 2 — judges at work")).toBeTruthy();
    const field = screen.getByRole("region", { name: "The field" });
    expect(within(field).getByText(/lost to L001 · on points \(pick overruled\) · 80 : 60/)).toBeTruthy();
    fireEvent.click(within(field).getByRole("button", { name: /Hide the ones out/ }));
    expect(within(field).queryByText("L002")).toBeNull();
    fireEvent.click(within(field).getByRole("button", { name: /Show the ones out \(3\)/ }));
    expect(within(field).getByText("L002")).toBeTruthy();
  });

  it("a match opens its rubric and the judge's transcript; a line opens its case and its full output", async () => {
    const opened: string[] = [];
    const read: string[] = [];
    render(<ArenaBoard view={bracket()} onAgent={(id, t) => opened.push(`${id}:${t}`)} readLine={async (l) => (read.push(l), `# ${l}\nfull output`)} />);
    fireEvent.click(screen.getAllByText("R1M1")[0].closest("button")!);
    const detail = screen.getByRole("complementary", { name: "Detail" });
    expect(within(detail).getByText("Correctness")).toBeTruthy();
    expect(within(detail).getByText("pick b overruled by points (80 vs 60)")).toBeTruthy();
    fireEvent.click(screen.getAllByText("R2M1")[0].closest("button")!);
    fireEvent.click(within(screen.getByRole("complementary", { name: "Detail" })).getByRole("button", { name: /Judge's transcript/ }));
    expect(opened).toEqual(["j1:Judge · R2M1"]);
    fireEvent.click(within(screen.getByRole("region", { name: "The field" })).getByText("L003").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /Full output and diff/ }));
    await waitFor(() => expect(screen.getByText("full output")).toBeTruthy());
    expect(read).toEqual(["L003"]);
  });
});

const council = (over: Partial<CouncilView> = {}): CouncilView => ({
  name: "c1",
  kind: "run",
  mode: "design",
  ask: "Keep the feature?",
  members: ["anthropic/m1", "openai/m2", "google/m3"],
  seats: [
    { member: "anthropic/m1", provider: "anthropic", model: "m1", headline: "Verdict: keep it", text: "**Verdict: keep it**\nreasons", truncated: false, outputTokens: 900, latencyMs: 4200, costUsd: 0 },
    { member: "openai/m2", provider: "openai", model: "m2", text: "", truncated: false, error: "timeout" },
  ],
  rounds: [],
  absent: [{ member: "google/m3", reason: "no key" }],
  quorum: { status: "concluded", threshold: 1, total: 3, present: 2 },
  decision: "Keep it, behind a flag",
  open: false,
  ...over,
});

describe("match flyout: the judge's chat and how far it is (owner, 2026-11-26)", () => {
  const MIN = 60_000;
  const judge = (agentId: string, state: WorkflowAgent["state"], start: number, end?: number): WorkflowAgent => ({ agentId, label: `judge:${agentId}`, state, attempts: 1, startedAt: new Date(start).toISOString(), ...(end !== undefined ? { endedAt: new Date(end).toISOString() } : {}) });
  /** R1M1 and R1M2 judged (4 and 6 minutes, 7 minutes end to end), R2M1's judge 2 minutes in. */
  const timed = (now: number) => {
    const v = bracket();
    v.matches[0] = { ...v.matches[0], report: { agentId: "jA" } };
    v.matches[1] = { ...v.matches[1], report: { agentId: "jB" } };
    const t0 = now - 20 * MIN;
    return { v, agents: [judge("jA", "done", t0, t0 + 4 * MIN), judge("jB", "done", t0 + MIN, t0 + 7 * MIN), judge("j1", "running", now - 2 * MIN)] };
  };

  it("the arena's pace comes from its own judges: median run, span per match, contenders left; a running judge counts what it already did", () => {
    const now = Date.parse("2026-11-26T08:00:00Z");
    const { v, agents } = timed(now);
    expect(arenaPace(v, agents, now)).toEqual({ decided: 2, left: 1, typicalMs: 5 * MIN, perMatchMs: 3.5 * MIN, etaMs: 2.1 * MIN });
    expect(matchPace(v.matches[2], agents, 5 * MIN, now)).toEqual({ running: true, elapsedMs: 2 * MIN, leftMs: 3 * MIN, ratio: 0.4, doing: "Bash · npm test" });
    expect(matchPace(v.matches[0], agents, 5 * MIN, now)).toMatchObject({ running: false, elapsedMs: 4 * MIN, ratio: 1 });
  });

  it("no judge done yet: no time is guessed; a finished arena has none left", () => {
    const now = Date.now();
    expect(arenaPace(bracket(), [judge("j1", "running", now - MIN)], now)).toMatchObject({ decided: 2, left: 1, typicalMs: null, etaMs: null });
    expect(arenaPace(bracket({ phase: "done", champion: "L001" }), [], now)).toMatchObject({ left: 0 });
  });

  it("a match with a judge opens wide: facts, both progress bars, and the judge's chat live inside — no jump away from the board", () => {
    const { v, agents } = timed(Date.now());
    const opened: string[] = [];
    render(<ArenaBoard view={v} agents={agents} transcript={(id) => <p>chat of {id}</p>} onAgent={(id) => opened.push(id)} />);
    fireEvent.click(screen.getAllByText("R2M1")[0].closest("button")!);
    const detail = screen.getByRole("complementary", { name: "Detail" });
    expect(within(detail).getByText("chat of j1")).toBeTruthy();
    expect(within(detail).getByRole("region", { name: "Judge · R2M1 · chat" })).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: /Judge's transcript/ })).toBeNull();
    expect(within(detail).getByRole("progressbar", { name: "Match R2M1" })).toBeTruthy();
    expect(within(detail).getByText(/running 2m · ca\. 3m left/)).toBeTruthy();
    expect(within(detail).getByText(/2 of at least 3 matches decided/)).toBeTruthy();
    expect(within(detail).getByText(/ca\. 2m to go/)).toBeTruthy();
    expect(opened).toEqual([]);
  });

  it("without a transcript reader the flyout stays narrow and keeps the button; with no judge done it says the time is unknown", () => {
    render(<ArenaBoard view={bracket()} agents={[]} onAgent={() => {}} />);
    fireEvent.click(screen.getAllByText("R2M1")[0].closest("button")!);
    const detail = screen.getByRole("complementary", { name: "Detail" });
    expect(within(detail).getByRole("button", { name: /Judge's transcript/ })).toBeTruthy();
    expect(within(detail).getByText("time unknown until a judge is done")).toBeTruthy();
  });
});

describe("arena names (owner, 2026-11-26)", () => {
  it("the header shows the run's name, the task's title under it, and once decided what was chosen; both rename in place", async () => {
    const calls: string[] = [];
    render(<ArenaBoard view={bracket({ name: "Signing, cheaply", nameBy: "user", champion: "L001", phase: "done", decision: "Ad-hoc signing in CI", decisionBy: "agent" })} rename={async (f, t) => void calls.push(`${f}=${t}`)} />);
    expect(screen.getByText("Signing, cheaply")).toBeTruthy();
    expect(screen.getByText("Sign the app")).toBeTruthy();
    expect(screen.getByText("Ad-hoc signing in CI")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rename arena name" }));
    const input = screen.getByRole("textbox", { name: "arena name" });
    fireEvent.change(input, { target: { value: "  Signing  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(calls).toEqual(["name=Signing"]));
    fireEvent.click(screen.getByRole("button", { name: "Rename decision" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "decision" }), { key: "Escape" });
    expect(calls).toEqual(["name=Signing"]);
  });

  it("without a rename there is no pencil; without a name the task's title stands; the tab says the name", () => {
    render(<ArenaBoard view={bracket()} />);
    expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
    expect(screen.getByText("Sign the app")).toBeTruthy();
    expect(boardTabs(orch({ brackets: [bracket({ name: "Signing" })] })).find((t) => t.id === "arena:demo")?.label).toBe("Arena · Signing");
  });
});

describe("CouncilBoard", () => {
  it("seats around the table, an empty chair for the absent, the decision in the middle; a seat opens its answer", () => {
    render(<CouncilBoard council={council()} />);
    expect(screen.getByText("Keep the feature?")).toBeTruthy();
    expect(screen.getByText("Keep it, behind a flag")).toBeTruthy();
    expect(screen.getByText("no key")).toBeTruthy();
    expect(screen.getByText("Failed: timeout")).toBeTruthy();
    fireEvent.click(screen.getByText("Verdict: keep it").closest("button")!);
    expect(within(screen.getByRole("complementary", { name: "Seat" })).getByText("reasons")).toBeTruthy();
  });

  it("a debate steps through its rounds; a council still running says so", () => {
    const debate = council({ kind: "debate", seats: [], rounds: [1, 2].map((round) => ({ round, total: 3, seats: [{ member: "a/x", provider: "a", model: "x", headline: `Round ${round} take`, text: "", truncated: false }] })), open: true });
    render(<CouncilBoard council={debate} />);
    expect(screen.getByText("Round 2 take")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Round 1/ }));
    expect(screen.getByText("Round 1 take")).toBeTruthy();
    expect(screen.getByText(/· in progress/)).toBeTruthy();
    expect(screen.getByText("Round 3")).toBeTruthy();
  });

  it("seatPlace: the first seat at the top, the rest clockwise", () => {
    expect(seatPlace(0, 4)).toEqual({ left: 50, top: 8 });
    expect(seatPlace(1, 4)).toEqual({ left: 92, top: 50 });
  });
});

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  runId: "wf_1",
  name: "demo-judge",
  status: "running",
  phases: ["Judge"],
  resumed: true,
  agents: [
    { agentId: "a1", label: "judge:R1M1", phase: "Judge", state: "done", attempts: 1, result: { pick: "b" } },
    { agentId: "a2", label: "judge:R1M2", phase: "Judge", state: "running", attempts: 2, doing: "Bash · npm test" },
  ],
  ...over,
});

describe("WorkflowBoard", () => {
  it("lanes per phase, what each call does or returned, a chip opens its transcript", () => {
    const opened: string[] = [];
    render(<WorkflowBoard runs={[run()]} onAgent={(id) => opened.push(id)} />);
    expect(screen.getByText("1/2 done")).toBeTruthy();
    expect(screen.getByText("pick b")).toBeTruthy();
    expect(screen.getByText("Bash · npm test")).toBeTruthy();
    expect(screen.getByText("resumed")).toBeTruthy();
    fireEvent.click(screen.getByText("judge:R1M2").closest("button")!);
    expect(opened).toEqual(["a2"]);
    expect(resultPreview("line one\nline two")).toBe("line one");
    expect(resultPreview({ truncated: true, preview: "cut" })).toBe("cut");
  });
});

const orch = (over: Partial<Orchestration> = {}): Orchestration => ({ key: "claude/me/s1", live: true, workflows: [run()], brackets: [bracket()], councils: [council()], ...over });

describe("BoardPage", () => {
  it("tabs per arena, council and the workflows; the row's focus picks the tab", () => {
    const tabs = boardTabs(orch({ councilRunning: { doing: "Bash · agent-config council:run" } }));
    expect(tabs.map((t) => t.id)).toEqual(["council:live", "arena:demo", "council:c1", "workflows"]);
    expect(pickTab(tabs, "workflow:wf_1")).toBe("workflows");
    expect(pickTab(tabs, "arena:demo")).toBe("arena:demo");
    expect(pickTab(tabs, "arena:gone")).toBe("council:live");
    expect(pickTab(tabs, "council")).toBe("council:live");
    expect(pickTab(boardTabs(orch()), "council")?.startsWith("council:")).toBe(true);
  });

  it("reads the board, draws the focused tab, and opens an agent's transcript beside it", async () => {
    const reads: string[] = [];
    render(<BoardPage sessionKey="claude/me/s1" title="My session" live focus="arena:demo" read={async (k, live) => (reads.push(`${k}:${live}`), orch())} transcript={(id) => <p>transcript of {id}</p>} />);
    await waitFor(() => expect(screen.getByText("Sign the app")).toBeTruthy());
    expect(reads[0]).toBe("claude/me/s1:true");
    fireEvent.click(screen.getByRole("tab", { name: /Workflows \(1\)/ }));
    fireEvent.click(screen.getByText("judge:R1M1").closest("button")!);
    expect(screen.getByText("transcript of a1")).toBeTruthy();
  });

  it("the session's title in the strip leads back to its chat (owner, 2026-11-26)", async () => {
    let back = 0;
    render(<BoardPage sessionKey="k" title="My session" live read={async () => orch()} onSession={() => back++} />);
    await waitFor(() => expect(screen.getByText("Sign the app")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /My session/ }));
    expect(back).toBe(1);
  });

  it("in an arena, a writer's transcript opens in the same flyout's dark box, not in a second column (owner, 2026-11-26)", async () => {
    render(<BoardPage sessionKey="k" title="t" live focus="arena:demo" read={async () => orch({ brackets: [bracket({ lines: [line("L001", "pending", { writing: { agentId: "w1" } }), line("L003", "alive")] })] })} transcript={(id) => <p>transcript of {id}</p>} />);
    await waitFor(() => expect(screen.getByText("Sign the app")).toBeTruthy());
    fireEvent.click(within(screen.getByRole("region", { name: "The field" })).getByText("L001").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /Writer's transcript/ }));
    const detail = screen.getByRole("complementary", { name: "Detail" });
    expect(within(detail).getByText("transcript of w1")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Agent transcript" })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Close chat" }));
    expect(within(detail).queryByText("transcript of w1")).toBeNull();
  });

  it("a session that orchestrates nothing says so", async () => {
    render(<BoardPage sessionKey="k" title="t" live={false} read={async () => orch({ workflows: [], brackets: [], councils: [] })} />);
    await waitFor(() => expect(screen.getByText(/runs no workflow, arena or council/)).toBeTruthy());
  });
});

describe("board rows in the session tree", () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({ provider: "claude", profile: "me", sessionId: "s1", live: true, mtimeMs: 0, workflows: [{ runId: "wf_a", name: "demo-arena-judge", status: "running", done: 1, total: 5, phase: "Judge" }, { runId: "wf_b", name: "other", status: "completed", done: 2, total: 2 }], brackets: [{ run: "demo", round: 2, phase: "judging", alive: 3, total: 10, champion: null }], boards: ["bracket", "council"], ...over }) as never;

  it("an arena row carries its runs under it, other runs stand alone, a council gets its row; each opens the board", () => {
    const kids = boardChildren(row());
    expect(kids.map((k) => [k.kind, k.label, k.state])).toEqual([
      ["arena-board", "Arena · demo · round 2 · 3/10 left", "working"],
      ["workflow", "other · 2/2", "done"],
      ["council-board", "Council", "done"],
    ]);
    expect(kids[0].children!.map((k) => k.label)).toEqual(["demo-arena-judge · 1/5 · Judge"]);
    expect(parseBoardChildId(kids[0].id)).toEqual({ key: "claude/me/s1", focus: "arena:demo" });
    expect(kids.every((k) => boardOpens(k) && !childOpens(k))).toBe(true);
    expect(boardChildren(row({ brackets: [{ run: "demo", round: 5, phase: "done", alive: 1, total: 10, champion: "L003" }] }))[0].label).toBe("Arena · demo · L003 wins");
    expect(boardChildren(row({ workflows: undefined, brackets: undefined, boards: undefined }))).toEqual([]);
    const council = boardChildren(row({ workflows: undefined, brackets: undefined, boards: ["council"], councilLive: true }))[0]!;
    expect([council.label, council.state]).toEqual(["Council · live", "working"]);
  });
});

const liveTable = (over: Partial<CouncilLive> = {}): CouncilLive => ({
  stem: "c-live",
  subcommand: "run",
  status: "running",
  listening: true,
  turn: 1,
  refused: 0,
  said: [{ text: "Mind the upgrade path.", at: "2026-11-24T10:00:03Z" }],
  feed: [
    { at: "2026-11-24T10:00:01Z", text: "Architect: Verdict: ship it", kind: "seat" },
    { at: "2026-11-24T10:00:03Z", text: "You: Mind the upgrade path.", kind: "human" },
    { at: "2026-11-24T10:00:04Z", text: "Skeptic is thinking (turn 1)", kind: "seat" },
  ],
  seats: [
    { id: "anthropic#architect", member: "anthropic", model: "sonnet", role: "Architect", state: "answered", turn: 1, headline: "Verdict: ship it" },
    { id: "anthropic#skeptic", member: "anthropic", model: "opus", role: "Skeptic", brief: "Find the flaw.", state: "thinking", turn: 1 },
    { id: "openai#operator", member: "openai", model: "gpt", role: "Operator", state: "waiting", turn: 0 },
    { id: "gemini#outsider", member: "gemini", role: "Outsider", state: "absent", turn: 0, absent: "no API key" },
  ],
  ...over,
});
const liveCouncil = (live: CouncilLive): CouncilView => ({ name: "c-live", kind: "run", ask: "Ship it?", members: [], seats: [], rounds: [], absent: [], open: live.listening, live });

describe("live council table", () => {
  it("seats from the live table: who answered, who speaks, who waits, an empty chair; the human holds the bottom", () => {
    const seats = tableSeats(liveCouncil(liveTable()), []);
    expect(seats.map((s) => [s.id, s.state])).toEqual([["anthropic#architect", "answered"], ["anthropic#skeptic", "thinking"], ["openai#operator", "waiting"], ["gemini#outsider", "absent"]]);
    expect(seatPlaceWithHuman(0, 3)).toEqual({ left: 8, top: 50 });
    expect([seatWidth(4), seatWidth(9), seatWidth(16)]).toEqual(["32%", "25%", "20%"]);
    render(<CouncilBoard council={liveCouncil(liveTable())} />);
    expect(screen.getByText("Speaking")).toBeTruthy();
    expect(screen.getAllByText("Skeptic").length).toBeGreaterThan(0);
    expect(screen.getByText("thinking · turn 1…")).toBeTruthy();
    expect(screen.getByText("waiting for the turn")).toBeTruthy();
    expect(screen.getByText("no API key")).toBeTruthy();
    expect(within(screen.getByLabelText("Your seat")).getByText("Mind the upgrade path.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Speaker area" })).getByText("Skeptic is thinking (turn 1)")).toBeTruthy();
    expect(screen.queryByLabelText(/Say something to the table/), "no speak: the human only watches").toBeNull();
  });

  it("the human speaks, raises a hand, and stops only after confirming", async () => {
    const sent: CouncilMessage[] = [];
    const speak = async (_run: string, m: CouncilMessage) => void sent.push(m);
    render(<CouncilBoard council={liveCouncil(liveTable())} speak={speak} />);
    fireEvent.change(screen.getByLabelText(/Say something to the table/), { target: { value: "Cost first." } });
    fireEvent.click(screen.getByRole("button", { name: /Say it/ }));
    await waitFor(() => expect(sent).toEqual([{ type: "say", text: "Cost first." }]));
    fireEvent.click(screen.getByRole("button", { name: /Raise hand/ }));
    await waitFor(() => expect(sent.map((m) => m.type)).toEqual(["say", "pause"]));
    await waitFor(() => expect((screen.getByRole("button", { name: /Stop the table/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /Stop the table/ }));
    expect(sent.map((m) => m.type), "stop waits for the confirmation").toEqual(["say", "pause"]);
    fireEvent.click(screen.getByRole("button", { name: "Stop now" }));
    await waitFor(() => expect(sent.map((m) => m.type)).toEqual(["say", "pause", "stop"]));
  });

  it("a raised hand shows in the middle and offers to go on; a finished table no longer listens", () => {
    const sent: CouncilMessage[] = [];
    const { unmount } = render(<CouncilBoard council={liveCouncil(liveTable({ status: "paused" }))} speak={async (_r, m) => void sent.push(m)} />);
    expect(screen.getByText("Your hand is up")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Lower hand/ }));
    expect(sent).toEqual([{ type: "resume" }]);
    unmount();
    render(<CouncilBoard council={liveCouncil(liveTable({ status: "completed", listening: false }))} speak={async () => undefined} />);
    expect(screen.getByText("finished")).toBeTruthy();
    expect(screen.queryByLabelText(/Say something to the table/)).toBeNull();
  });

  it("a failed send says why and keeps the text", async () => {
    render(<CouncilBoard council={liveCouncil(liveTable())} speak={async () => Promise.reject(new Error("the council c-live is completed; it no longer listens"))} />);
    fireEvent.change(screen.getByLabelText(/Say something to the table/), { target: { value: "late" } });
    fireEvent.click(screen.getByRole("button", { name: /Say it/ }));
    await waitFor(() => expect(screen.getByText(/no longer listens/)).toBeTruthy());
    expect((screen.getByLabelText(/Say something to the table/) as HTMLTextAreaElement).value).toBe("late");
  });
});

describe("splitTabs", () => {
  it("keeps running tabs and the chosen one in the strip; the rest are finished", async () => {
    const { splitTabs } = await import("./BoardPage.js");
    const tabs = [
      { id: "arena:a" as const, live: true },
      { id: "council:b" as const, live: false },
      { id: "council:c" as const, live: false },
      { id: "workflows" as const, live: false },
    ];
    const s = splitTabs(tabs, "council:c");
    expect(s.shown.map((t) => t.id)).toEqual(["arena:a", "council:c"]);
    expect(s.finished.map((t) => t.id)).toEqual(["council:b", "workflows"]);
    expect(splitTabs(tabs, null).finished).toHaveLength(3);
  });
});
