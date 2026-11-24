/**
 * The board's data: `agent-switch workflows <session> --json`, as the CLI's
 * src/workflows.ts, src/bracket.ts and src/council-runs.ts write it.
 * Structural copies — the GUI never imports CLI code.
 */

export type WorkflowAgentState = "running" | "done" | "failed" | "stopped";
export type WorkflowStatus = "running" | "completed" | "failed" | "stopped";

export interface WorkflowAgent {
  agentId: string;
  label: string;
  phase?: string;
  state: WorkflowAgentState;
  attempts: number;
  startedAt?: string;
  endedAt?: string;
  doing?: string;
  model?: string;
  tokens?: number;
  result?: unknown;
  error?: string;
}

export interface WorkflowRun {
  runId: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  phases: string[];
  startedAt?: string;
  durationMs?: number;
  totalTokens?: number;
  agents: WorkflowAgent[];
  args?: unknown;
  resumed: boolean;
}

export const RUBRIC = { correctness: 35, requirements: 25, robustness: 20, clarity: 10, efficiency: 10 } as const;
export type Criterion = keyof typeof RUBRIC;
export type Scores = Record<Criterion, number>;
export type Fatal = "none" | "upheld" | "rebutted";

export interface Verdict {
  a: Scores;
  b: Scores;
  fatal: { a: Fatal; b: Fatal };
  pick: "a" | "b";
  seat?: { id?: string; family?: string; billing?: string };
  checks?: string;
  critique?: string;
}

export type LineStatus = "pending" | "alive" | "eliminated" | "no-output" | "duplicate";

export interface BracketLine {
  id: string;
  lineage: string;
  status: LineStatus;
  attempts: number;
  eliminations: number;
  cards: number;
  lostTo: string[];
  lastLoss: { match: string; upheldFatal: boolean } | null;
  approach?: string;
  rationale?: string;
  hasOutput: boolean;
  writing?: { agentId: string; doing?: string };
  appealing?: { agentId: string; doing?: string };
}

export interface BracketMatch {
  id: string;
  round: number;
  a: string | null;
  b: string | null;
  verdict: Verdict | null;
  winner: string | null;
  loser: string | null;
  notes: string[];
  signals: string[];
  appeal: string | null;
  jury?: { outcome?: string; reason?: string };
  provisional?: { verdict: Verdict; winner: string | null; agentId: string; notes: string[] };
  judging?: { agentId: string; doing?: string };
  report?: { checks?: string; critique?: string; agentId: string };
}

export type BracketPhase = "generating" | "judging" | "appeals" | "advancing" | "done";

export interface BracketView {
  run: string;
  dir: string;
  taskTitle?: string;
  tier?: string;
  seed?: number;
  round: number;
  auditRate?: number;
  lines: BracketLine[];
  matches: BracketMatch[];
  log: string[];
  champion: string | null;
  phase: BracketPhase;
  updatedAt?: string;
}

export interface CouncilSeat {
  member: string;
  provider: string;
  model: string;
  headline?: string;
  text: string;
  truncated: boolean;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  error?: string;
  blindLabel?: string;
  seatId?: string;
  role?: string;
}

export type LiveSeatState = "waiting" | "thinking" | "answered" | "failed" | "skipped" | "absent";

export interface LiveSeat {
  id: string;
  member: string;
  model?: string;
  role?: string;
  brief?: string;
  state: LiveSeatState;
  turn: number;
  headline?: string;
  error?: string;
  outputTokens?: number;
  latencyMs?: number;
  absent?: string;
}

export type LiveStatus = "running" | "paused" | "stopping" | "completed" | "stopped" | "failed";

export interface CouncilLive {
  stem: string;
  subcommand: "run" | "debate";
  status: LiveStatus;
  seats: LiveSeat[];
  said: { text: string; at: string; before?: string }[];
  refused: number;
  feed: { at: string; text: string; kind: "seat" | "human" | "table" }[];
  turn: number;
  startedAt?: string;
  finishedAt?: string;
  listening: boolean;
}

export type CouncilMessage = { type: "say"; text: string } | { type: "pause" } | { type: "resume" } | { type: "stop" };

export interface CouncilRound {
  round: number;
  total: number;
  costUsd?: number;
  seats: CouncilSeat[];
}

export interface CouncilView {
  name: string;
  kind: "run" | "debate";
  mode?: string;
  promptMode?: string;
  ask?: string;
  artefact?: string;
  members: string[];
  seats: CouncilSeat[];
  rounds: CouncilRound[];
  costUsd?: number;
  quorum?: { status?: string; threshold?: number; total?: number; present?: number };
  absent: { member: string; reason?: string }[];
  chairman?: { member?: string; text: string };
  decision?: string;
  open: boolean;
  updatedAt?: string;
  live?: CouncilLive;
}

export interface Orchestration {
  key: string;
  live: boolean;
  workflows: WorkflowRun[];
  brackets: BracketView[];
  councils: CouncilView[];
  councilRunning?: { doing: string };
}

/** Weighted points 0–100, as agent-config totals them. Pure. */
export function total(sc: Scores): number {
  let t = 0;
  for (const k of Object.keys(RUBRIC) as Criterion[]) t += (RUBRIC[k] * sc[k]) / 10;
  return Math.round(t * 100) / 100;
}
