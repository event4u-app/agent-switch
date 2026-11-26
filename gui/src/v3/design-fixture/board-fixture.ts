/**
 * The board's fixture: a made-up arena in round 3 (one judge at work, one
 * verdict provisional, appeals spent), a council with an empty chair, and the
 * workflow runs that drive the arena. Shapes as `workflows --json` writes them.
 */

import type { BracketLine, BracketMatch, Orchestration, Scores, WorkflowAgent, WorkflowRun } from "../board/types.js";

const NOW = Date.parse("2026-11-24T17:40:00Z");
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const s = (c: number, r: number, b: number, cl: number, e: number): Scores => ({ correctness: c, requirements: r, robustness: b, clarity: cl, efficiency: e });

const ANGLES: Record<string, string> = {
  L001: "Smallest possible diff: one module, a few pure helpers, everything else injected.",
  L002: "Robustness first: every partial state (half-created keychain, orphan leaf) repairs itself.",
  L003: "Testability first: a pure planner returns the command list; a thin runner executes it.",
  L004: "Security first: key material never on argv, file modes checked, secrets redacted.",
  L005: "Performance on every launch: skip codesign entirely when the bundle is already signed.",
  L006: "Concurrency first: one lock for parallel CLI runs, stale-lock recovery.",
  L007: "Operator visibility: debug-log records and one stderr line per failure.",
  L008: "Search-list correctness: parse and preserve the user's keychain search list.",
  L009: "Upgrade path: re-sign the bundles already cached from earlier versions.",
  L010: "Simplicity for maintainers: plain sequential code, no abstractions.",
};

const line = (id: string, over: Partial<BracketLine> = {}): BracketLine => ({ id, lineage: id, status: "alive", attempts: 0, eliminations: 0, cards: 0, lostTo: [], lastLoss: null, approach: ANGLES[id], rationale: `${ANGLES[id]}\n\nThe signing step runs once, before the first launch of a downloaded bundle, and never blocks the launch: a failure is one line on stderr and a debug-log record.`, hasOutput: true, ...over });
const out = (id: string, by: string[], match: string, upheldFatal = false, cards = 0): BracketLine => line(id, { status: "eliminated", eliminations: by.length, lostTo: by, lastLoss: { match, upheldFatal }, cards });

const m = (id: string, a: string, b: string, va: Scores, vb: Scores, over: Partial<BracketMatch> = {}): BracketMatch => {
  const ta = va.correctness * 3.5 + va.requirements * 2.5 + va.robustness * 2 + va.clarity + va.efficiency;
  const tb = vb.correctness * 3.5 + vb.requirements * 2.5 + vb.robustness * 2 + vb.clarity + vb.efficiency;
  const winner = ta >= tb ? a : b;
  return {
    id,
    round: Number(id.slice(1, id.indexOf("M"))),
    a,
    b,
    verdict: { a: va, b: vb, fatal: { a: "none", b: "none" }, pick: ta >= tb ? "a" : "b", seat: { family: "anthropic", billing: "subscription" } },
    winner,
    loser: winner === a ? b : a,
    notes: [],
    signals: Math.abs(ta - tb) <= 5 ? [`close gap ${Math.round(Math.abs(ta - tb) * 10) / 10}`] : [],
    appeal: null,
    report: { agentId: `j-${id}`, checks: `${a}: git apply OK; tsc 0; build 0; 25/25 tests pass\n${b}: git apply OK; tsc 0; build 0; 29/29 tests pass`, critique: `**${a}**, MAJOR: a missing identity.json silently regenerates the leaf and costs the user a TCC prompt.\n\n**${b}**, MAJOR: the keychain password goes on argv, where \`ps\` can show it.` },
    ...over,
  };
};

const MATCHES: BracketMatch[] = [
  m("R1M1", "L008", "L009", s(8, 8, 7, 8, 7), s(7, 7, 6, 7, 7)),
  m("R1M2", "L001", "L005", s(8, 8, 7, 9, 9), s(8, 7, 7, 8, 9), { appeal: "card", notes: ["card 1 for L005 by claude-opus-appeal"] }),
  m("R1M3", "L007", "L006", s(7, 8, 7, 8, 8), s(8, 8, 7, 8, 7), { appeal: "card", notes: ["card 1 for L007 by claude-opus-appeal"] }),
  m("R1M4", "L010", "L003", s(7, 7, 6, 9, 9), s(8, 8, 7, 8, 8), { appeal: "declined" }),
  m("R1M5", "L004", "L002", s(6, 7, 7, 7, 7), s(8, 8, 9, 7, 7), { verdict: { a: s(6, 7, 7, 7, 7), b: s(8, 8, 9, 7, 7), fatal: { a: "upheld", b: "none" }, pick: "b" }, notes: ["upheld FATAL decides"] }),
  m("R2M1", "L007", "L010", s(7, 7, 7, 8, 8), s(8, 7, 7, 8, 8), { appeal: "declined" }),
  m("R2M2", "L003", "L006", s(9, 8, 8, 8, 8), s(8, 8, 8, 8, 8), { appeal: "declined" }),
  m("R2M3", "L002", "L005", s(8, 9, 9, 7, 7), s(8, 8, 7, 8, 9), { signals: ["FATAL rebutted"], verdict: { a: s(8, 9, 9, 7, 7), b: s(8, 8, 7, 8, 9), fatal: { a: "rebutted", b: "none" }, pick: "a" }, appeal: "declined" }),
  m("R2M4", "L001", "L008", s(8, 8, 8, 8, 8), s(8, 8, 8, 8, 7.5), { signals: ["close gap 0.5", "pick ≠ points"], notes: ["pick b overruled by points (80 vs 79.5)"], appeal: "declined" }),
  {
    id: "R3M1", round: 3, a: "L003", b: "L001", verdict: null, winner: null, loser: null, notes: [], signals: [], appeal: null,
    provisional: { agentId: "j-R3M1", winner: "L003", notes: [], verdict: { a: s(9, 9, 8, 8, 8), b: s(8, 8, 8, 9, 9), fatal: { a: "none", b: "none" }, pick: "a", critique: "**L003**: the planner is pure and every command is asserted.\n\n**L001**, MINOR: unlocks the keychain on every launch." } },
  },
  { id: "R3M2", round: 3, a: "L002", b: "L010", verdict: null, winner: null, loser: null, notes: [], signals: [], appeal: null, judging: { agentId: "j-R3M2", doing: "Bash · node --test dist-test/tests/mac-signing.test.js" } },
];

const LINES: BracketLine[] = [
  line("L001"),
  line("L002"),
  line("L003"),
  out("L004", ["L002"], "R1M5", true),
  out("L005", ["L001", "L002"], "R2M3", false, 1),
  out("L006", ["L003"], "R2M2"),
  out("L007", ["L006", "L010"], "R2M1", false, 1),
  out("L008", ["L001"], "R2M4"),
  out("L009", ["L008"], "R1M1"),
  line("L010", { cards: 0 }),
];

const agent = (agentId: string, label: string, phase: string, state: WorkflowAgent["state"], over: Partial<WorkflowAgent> = {}): WorkflowAgent => ({ agentId, label, phase, state, attempts: 1, model: "claude-opus-5-5", startedAt: at(30), ...over });

const RUNS: WorkflowRun[] = [
  { runId: "wf_lines", name: "tcc-signing-arena-lines", description: "Generate 10 competing solutions", status: "completed", phases: ["Generate"], durationMs: 323_558, totalTokens: 2_170_220, resumed: false, startedAt: at(220), agents: Object.keys(ANGLES).map((id) => agent(`w-${id}`, `line:${id}`, "Generate", "done", { result: `agents/runtime/bracket/tcc-signing/lines/${id}.md: tsc passed, 23/23 tests` })) },
  { runId: "wf_r2", name: "tcc-signing-arena-judge", description: "Judge arena matches", status: "completed", phases: ["Judge"], durationMs: 412_000, totalTokens: 1_480_000, resumed: true, startedAt: at(90), agents: ["R2M1", "R2M2", "R2M3", "R2M4"].map((id, i) => agent(`j-${id}`, `judge:${id}`, "Judge", "done", { result: { pick: "a" }, attempts: id === "R2M1" ? 2 : 1, startedAt: at(90 - i * 7), endedAt: at(84 - i * 7) })) },
  {
    runId: "wf_r3", name: "tcc-signing-arena-judge", description: "Judge arena matches", status: "running", phases: ["Judge"], resumed: false, startedAt: at(6),
    agents: [agent("j-R3M1", "judge:R3M1", "Judge", "done", { result: { pick: "a" }, startedAt: at(6), endedAt: at(1) }), agent("j-R3M2", "judge:R3M2", "Judge", "running", { startedAt: at(4), doing: "Bash · node --test dist-test/tests/mac-signing.test.js" })],
  },
];

export const BOARD_FIXTURE: Orchestration = {
  key: "claude/work/s-arena",
  live: true,
  workflows: RUNS,
  brackets: [
    {
      run: "tcc-signing",
      dir: "agents/runtime/bracket/tcc-signing",
      taskTitle: "stable local code signature for the Agent Switch macOS app",
      tier: "S1",
      seed: 1,
      round: 3,
      auditRate: 0.1,
      phase: "judging",
      champion: null,
      lines: LINES,
      matches: MATCHES,
      updatedAt: at(1),
      log: ["R1M5 L002 beats L004 — upheld FATAL decides", "L005 card 1 — back in", "L007 card 1 — back in", "R2M3 L002 beats L005 — appealable (FATAL rebutted)", "R2M4 L001 beats L008 — appealable (close gap 0.5, pick ≠ points)", "L005 appeal declined", "L007 appeal declined", "round 3 paired: R3M1 L003–L001, R3M2 L002–L010"],
    },
  ],
  councils: [
    {
      name: "20261124T1300Z-tcc",
      kind: "run",
      mode: "design",
      ask: "Re-sign the downloaded bundle locally, or ship a notarised build?",
      artefact: "tcc-signing-angles.md",
      members: ["anthropic/claude-sonnet-4-5", "openai/codex-default", "google/gemini-2-5-pro"],
      seats: [
        { member: "anthropic/claude-sonnet-4-5", provider: "anthropic", model: "claude-sonnet-4-5", headline: "Verdict: re-sign locally, with a stable designated requirement", text: "**Verdict: re-sign locally, with a stable designated requirement**\n\nA self-signed identity kept in its own keychain gives every update the same DR, so the TCC grant survives.", truncated: false, outputTokens: 1840, latencyMs: 41_200, costUsd: 0, blindLabel: "Response-B" },
        { member: "openai/codex-default", provider: "openai", model: "codex-default", headline: "Verdict: agree, but never touch the login keychain", text: "**Verdict: agree, but never touch the login keychain**\n\nPreserve the search list entry by entry; never regenerate a recorded identity silently.", truncated: false, outputTokens: 1210, latencyMs: 36_800, costUsd: 0, blindLabel: "Response-A" },
      ],
      rounds: [],
      absent: [{ member: "google/gemini-2-5-pro", reason: "no API key" }],
      quorum: { status: "concluded", threshold: 1, total: 3, present: 2 },
      costUsd: 0,
      decision: "Re-sign on the user's Mac with a local self-signed identity; notarisation stays a later option.",
      open: false,
      updatedAt: at(280),
    },
    {
      // A council running now with a live table: six seats on two providers, one chair empty, the human has spoken.
      name: "20261124T1735Z-board",
      kind: "run",
      mode: "design",
      ask: "Should the arena board hide eliminated lines by default?",
      members: [],
      seats: [],
      rounds: [],
      absent: [],
      open: true,
      updatedAt: at(0),
      live: {
        stem: "20261124T1735Z-board",
        subcommand: "run",
        status: "running",
        listening: true,
        turn: 1,
        refused: 0,
        said: [{ text: "Most people open the board to see who is still in — weigh that.", at: at(1), before: "openai#operator" }],
        seats: [
          { id: "anthropic#architect", member: "anthropic", model: "claude-sonnet-4-5", role: "Architect", brief: "Keep the board one consistent model.", state: "answered", turn: 1, headline: "Verdict: show them, dimmed — the history is the point", outputTokens: 1420, latencyMs: 38_000 },
          { id: "anthropic#skeptic", member: "anthropic", model: "claude-opus-4-1", role: "Skeptic", brief: "Find the flaw that sinks this.", state: "answered", turn: 1, headline: "Verdict: hide them — ten dead cards bury four live ones", outputTokens: 1610, latencyMs: 52_000 },
          { id: "openai#operator", member: "openai", model: "gpt-5", role: "Operator", brief: "What does the person at the screen need right now?", state: "thinking", turn: 1 },
          { id: "openai#designer", member: "openai", model: "gpt-5", role: "Designer", state: "waiting", turn: 0 },
          { id: "anthropic#newcomer", member: "anthropic", model: "claude-haiku-4-5", role: "Newcomer", brief: "Has never seen an arena before.", state: "waiting", turn: 0 },
          { id: "gemini#outsider", member: "gemini", role: "Outsider", state: "absent", turn: 0, absent: "no API key" },
        ],
        feed: [
          { at: at(4), text: "Architect is thinking (turn 1)", kind: "seat" },
          { at: at(3), text: "Architect: Verdict: show them, dimmed — the history is the point", kind: "seat" },
          { at: at(3), text: "Skeptic is thinking (turn 1)", kind: "seat" },
          { at: at(2), text: "Skeptic: Verdict: hide them — ten dead cards bury four live ones", kind: "seat" },
          { at: at(1), text: "You: Most people open the board to see who is still in — weigh that.", kind: "human" },
          { at: at(1), text: "Operator is thinking (turn 1)", kind: "seat" },
        ],
      },
    },
  ],
};

/**
 * The same tournament, finished (owner, 2026-11-25: a board for the win): round 3
 * decided, the final L003 vs L002, L003 champion with its shine.
 */
const WON_MATCHES: BracketMatch[] = [
  ...MATCHES.filter((x) => x.round < 3),
  m("R3M1", "L003", "L001", s(9, 9, 8, 8, 8), s(8, 8, 8, 9, 9), { appeal: "declined" }),
  m("R3M2", "L002", "L010", s(8, 9, 9, 8, 8), s(8, 8, 7, 8, 8), { appeal: "declined" }),
  m("R4M1", "L003", "L002", s(9, 9, 9, 8, 8), s(9, 8, 8, 8, 8), { appeal: "declined", notes: ["final"] }),
];
const WON_LINES: BracketLine[] = LINES.map((l) =>
  l.id === "L001" ? out("L001", ["L003"], "R3M1") : l.id === "L010" ? out("L010", ["L002"], "R3M2") : l.id === "L002" ? out("L002", ["L003"], "R4M1") : l,
);
export const BOARD_WON: Orchestration = {
  ...BOARD_FIXTURE,
  live: false,
  councilRunning: undefined,
  workflows: BOARD_FIXTURE.workflows.map((w) => (w.status === "running" ? { ...w, status: "completed" as const } : w)),
  brackets: BOARD_FIXTURE.brackets.map((b) => ({ ...b, round: 4, phase: "done", champion: "L003", lines: WON_LINES, matches: WON_MATCHES, log: [...b.log, "R3M1 L003 beats L001", "R3M2 L002 beats L010", "final R4M1: L003 beats L002 — champion L003"] })),
  councils: BOARD_FIXTURE.councils.map((c) => ({ ...c, open: false, live: c.live ? { ...c.live, listening: false } : c.live })),
};
