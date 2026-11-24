/**
 * An agent-config bracket run ("arena", `/judge bracket`) as the session that
 * drives it sees it: `<cwd>/agents/runtime/bracket/<run>/bracket.json` (the
 * engine rewrites it atomically after every step), the line briefs and
 * outputs next to it, and — while a judge workflow is still out — the
 * verdicts its agents already returned, marked provisional until the engine
 * records them.
 *
 * Reads stay inside `<cwd>/agents/runtime/bracket` once links are followed,
 * a run name that is not plain reads nothing, and every file read is bounded.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { readConfined } from "./lineage.js";
import type { WorkflowRun } from "./workflows.js";

const RUN_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const LINE_ID = /^L\d{1,4}$/;
const STATE_BYTES = 4 * 1024 * 1024;
const TEXT_BYTES = 512 * 1024;
const RATIONALE_MAX = 1600;
const LOG_KEEP = 80;

/** agent-config's rubric: each criterion 0–10, weights sum to 100 (bracket/engine.ts RUBRIC). */
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
  /** From a judge agent's return, not the engine: the run-specific text fields. */
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
  /** The brief's `Approach:` angle. */
  approach?: string;
  /** The line's output before its diff: the rationale it gives. */
  rationale?: string;
  hasOutput: boolean;
  /** A workflow agent writing this line runs now. */
  writing?: { agentId: string; doing?: string };
  /** A workflow agent arguing this line's appeal runs now. */
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
  /** A judge's verdict the engine has not recorded yet, with the winner the engine's rule gives it. */
  provisional?: { verdict: Verdict; winner: string | null; agentId: string; notes: string[] };
  /** A judge agent on this match runs now. */
  judging?: { agentId: string; doing?: string };
  /** The judge agent's report for a recorded verdict, when the session's workflow kept it. */
  report?: { checks?: string; critique?: string; agentId: string };
}

export interface BracketView {
  run: string;
  /** `agents/runtime/bracket/<run>`, relative to the session's cwd. */
  dir: string;
  taskTitle?: string;
  tier?: string;
  seed?: number;
  round: number;
  auditRate?: number;
  lines: BracketLine[];
  matches: BracketMatch[];
  log: string[];
  /** The one line left alive once no match is open: agent-config's `done`. */
  champion: string | null;
  phase: "generating" | "judging" | "appeals" | "advancing" | "done";
  updatedAt?: string;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Weighted points 0–100, as agent-config totals them. Pure. */
export function total(sc: Scores): number {
  let t = 0;
  for (const k of Object.keys(RUBRIC) as Criterion[]) t += (RUBRIC[k] * sc[k]) / 10;
  return Math.round(t * 100) / 100;
}

/** The winning side by agent-config's rule: an upheld FATAL loses, else points, a tie falls to the pick. Pure. */
export function decide(v: Verdict): { winner: "a" | "b"; notes: string[] } {
  const fa = v.fatal.a === "upheld";
  const fb = v.fatal.b === "upheld";
  if (fa !== fb) return { winner: fa ? "b" : "a", notes: ["upheld FATAL decides"] };
  const ta = total(v.a);
  const tb = total(v.b);
  if (ta === tb) return { winner: v.pick, notes: ["tie on points; pick decides"] };
  const byPoints = ta > tb ? "a" : "b";
  return { winner: byPoints, notes: byPoints !== v.pick ? [`pick ${v.pick} overruled by points (${ta} vs ${tb})`] : [] };
}

function scores(v: unknown): Scores | null {
  const o = obj(v);
  const out = {} as Scores;
  for (const k of Object.keys(RUBRIC) as Criterion[]) {
    const n = o[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10) return null;
    out[k] = n;
  }
  return out;
}

const fatalOf = (v: unknown): Fatal => (v === "upheld" || v === "rebutted" ? v : "none");

/** A verdict from the engine's file or a judge's return; null when its scores are not the rubric's. Pure. */
export function toVerdict(raw: unknown): Verdict | null {
  const o = obj(raw);
  const a = scores(o.a);
  const b = scores(o.b);
  if (!a || !b) return null;
  const f = obj(o.fatal);
  const v: Verdict = { a, b, fatal: { a: fatalOf(f.a), b: fatalOf(f.b) }, pick: o.pick === "b" ? "b" : "a" };
  const seat = obj(o.seat);
  if (Object.keys(seat).length) v.seat = { id: str(seat.id) || undefined, family: str(seat.family) || undefined, billing: str(seat.billing) || undefined };
  if (str(o.checks)) v.checks = str(o.checks).slice(0, 2000);
  if (str(o.critique)) v.critique = str(o.critique).slice(0, 3000);
  return v;
}

const LINE_STATUSES = new Set<LineStatus>(["pending", "alive", "eliminated", "no-output", "duplicate"]);

/** `bracket.json` as the view needs it, from its text; null when it is not a bracket state. Pure. */
export function parseBracket(text: string, run: string): BracketView | null {
  let s: Json;
  try {
    s = obj(JSON.parse(text));
  } catch {
    return null;
  }
  if (!Array.isArray(s.lines) || !Array.isArray(s.matches)) return null;
  const lines: BracketLine[] = arr(s.lines)
    .map(obj)
    .filter((l) => LINE_ID.test(str(l.id)))
    .map((l) => {
      const loss = obj(l.lastLoss);
      return {
        id: str(l.id),
        lineage: str(l.lineage) || str(l.id),
        status: LINE_STATUSES.has(str(l.status) as LineStatus) ? (str(l.status) as LineStatus) : "pending",
        attempts: num(l.attempts),
        eliminations: num(l.eliminations),
        cards: num(l.cards),
        lostTo: arr(l.lostTo).map(str).filter(Boolean),
        lastLoss: str(loss.match) ? { match: str(loss.match), upheldFatal: loss.upheldFatal === true } : null,
        hasOutput: false,
      };
    });
  const matches: BracketMatch[] = arr(s.matches)
    .map(obj)
    .filter((m) => str(m.id))
    .map((m) => {
      const out: BracketMatch = {
        id: str(m.id),
        round: num(m.round),
        a: strOrNull(m.a),
        b: strOrNull(m.b),
        verdict: m.verdict ? toVerdict(m.verdict) : null,
        winner: strOrNull(m.winner),
        loser: strOrNull(m.loser),
        notes: arr(m.notes).map(str).filter(Boolean),
        signals: arr(m.signals).map(str).filter(Boolean),
        appeal: strOrNull(m.appeal),
      };
      const jury = obj(m.jury);
      if (Object.keys(jury).length) out.jury = { outcome: str(jury.outcome) || undefined, reason: str(jury.reason).slice(0, 600) || undefined };
      return out;
    });
  const view: BracketView = {
    run,
    dir: path.posix.join("agents", "runtime", "bracket", run),
    round: num(s.round),
    lines,
    matches,
    log: arr(s.log).map(str).filter(Boolean).slice(-LOG_KEEP),
    champion: null,
    phase: "judging",
  };
  if (str(s.tier)) view.tier = str(s.tier);
  if (typeof s.seed === "number") view.seed = s.seed;
  if (typeof s.auditRate === "number") view.auditRate = s.auditRate;
  view.phase = phaseOf(view);
  const alive = lines.filter((l) => l.status === "alive");
  if (view.phase === "done" && alive.length === 1) view.champion = alive[0].id;
  return view;
}

/** What the engine's `next` would do now, as a phase name. Pure. */
export function phaseOf(v: Pick<BracketView, "lines" | "matches" | "round">): BracketView["phase"] {
  if (v.lines.some((l) => l.status === "pending")) return "generating";
  const current = v.matches.filter((m) => m.round === v.round);
  if (current.some((m) => m.winner === null)) return "judging";
  if (current.some((m) => m.appeal === "open")) return "appeals";
  return v.lines.filter((l) => l.status === "alive").length <= 1 && v.round > 0 ? "done" : "advancing";
}

/** A brief's `Approach:` angle: the text after it, up to the next heading. Pure. */
export function approachOf(brief: string): string | undefined {
  const m = /^Approach:\s*([\s\S]*?)(?=^#|$(?![\s\S]))/m.exec(brief);
  const text = m?.[1].replace(/^\s*-\s*/gm, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 400) : undefined;
}

/** A line output's rationale: everything before its first fenced block, without the title. Pure. */
export function rationaleOf(output: string): string | undefined {
  const fence = output.search(/^```/m);
  const head = (fence < 0 ? output : output.slice(0, fence)).replace(/^#.*$/m, "").trim();
  return head ? head.slice(0, RATIONALE_MAX) : undefined;
}

/** Match id and line id named in a workflow label ("judge:R1M3", "line:L004"). Pure. */
export function labelIds(label: string): { match?: string; line?: string } {
  return { match: /\bR\d+M\d+\b/.exec(label)?.[0], line: /\bL\d{1,4}\b/.exec(label)?.[0] };
}

/**
 * Lay the session's workflow agents over the engine's state: a running judge
 * marks its match, a judge's return on an unrecorded match becomes a
 * provisional verdict, a running line writer marks its line. The newest run
 * wins for a label. Pure.
 */
export function overlay(view: BracketView, runs: readonly WorkflowRun[]): BracketView {
  const matches = new Map(view.matches.map((m) => [m.id, m]));
  const lines = new Map(view.lines.map((l) => [l.id, l]));
  for (const run of runs) {
    for (const a of run.agents) {
      const { match, line } = labelIds(a.label);
      const m = match ? matches.get(match) : undefined;
      if (m) {
        if (a.state === "running") m.judging = { agentId: a.agentId, ...(a.doing ? { doing: a.doing } : {}) };
        const v = a.state === "done" ? toVerdict(a.result) : null;
        if (v && m.verdict === null && m.a && m.b) {
          const d = decide(v);
          m.provisional = { verdict: v, winner: d.winner === "a" ? m.a : m.b, agentId: a.agentId, notes: d.notes };
          delete m.judging;
        } else if (v && m.verdict) {
          m.report = { agentId: a.agentId, ...(v.checks ? { checks: v.checks } : {}), ...(v.critique ? { critique: v.critique } : {}) };
        }
        continue;
      }
      const l = line && !match ? lines.get(line) : undefined;
      if (!l || a.state !== "running") continue;
      const what = `${a.label} ${a.phase ?? ""}`;
      const who = { agentId: a.agentId, ...(a.doing ? { doing: a.doing } : {}) };
      if (/appeal/i.test(what)) l.appealing = who;
      else if (/line|gen|write/i.test(what)) l.writing = who;
    }
  }
  return view;
}

function readIn(root: string, file: string, max: number): ReturnType<typeof readConfined> {
  return readConfined(root, file, max);
}

/** `<cwd>/agents/runtime/bracket`, links resolved; null when there is none. */
export function bracketRoot(cwd: string): string | null {
  try {
    const root = fs.realpathSync(path.join(cwd, "agents", "runtime", "bracket"));
    return fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

/** The run names under a bracket root: plain names whose folder holds a `bracket.json`. */
export function bracketRuns(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .filter((n) => RUN_NAME.test(n) && fs.existsSync(path.join(root, n, "bracket.json")))
      .sort();
  } catch {
    return [];
  }
}

/** One run, read from disk and laid over the session's workflow runs; null when it cannot be read. */
export function readBracket(cwd: string, run: string, runs: readonly WorkflowRun[] = []): BracketView | null {
  const root = bracketRoot(cwd);
  if (!root || !RUN_NAME.test(run)) return null;
  const dir = path.join(root, run);
  const state = readIn(root, path.join(dir, "bracket.json"), STATE_BYTES);
  if (!state) return null;
  const view = parseBracket(state.text, run);
  if (!view) return null;
  view.updatedAt = new Date(state.mtimeMs).toISOString();
  const task = readIn(root, path.join(dir, "task.md"), 8 * 1024)?.text ?? "";
  const title = /^#\s+(?:Task:\s*)?(.+)$/m.exec(task)?.[1]?.trim();
  if (title) view.taskTitle = title.slice(0, 200);
  for (const l of view.lines) {
    const brief = readIn(root, path.join(dir, "briefs", `${l.id}.md`), 16 * 1024)?.text;
    const approach = brief ? approachOf(brief) : undefined;
    if (approach) l.approach = approach;
    const out = readIn(root, path.join(dir, "lines", `${l.id}.md`), TEXT_BYTES);
    l.hasOutput = !!out && out.size > 0;
    const rationale = out ? rationaleOf(out.text) : undefined;
    if (rationale) l.rationale = rationale;
  }
  return overlay(view, runs);
}

/** A line's full output file, for the detail drawer; null when the line or file is not readable. */
export function readLineOutput(cwd: string, run: string, line: string): string | null {
  const root = bracketRoot(cwd);
  if (!root || !RUN_NAME.test(run) || !LINE_ID.test(line)) return null;
  return readIn(root, path.join(root, run, "lines", `${line}.md`), TEXT_BYTES)?.text ?? null;
}
