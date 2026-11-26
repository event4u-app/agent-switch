/**
 * What the arena board draws, derived from a bracket view: each line's record
 * and why it is out, the rounds, each match's score and margin. Pure — the
 * board renders this and nothing it would have to work out itself.
 */

import { total, type BracketLine, type BracketMatch, type BracketView, type Verdict, type WorkflowAgent } from "./types.js";

export type Standing = "champion" | "alive" | "fighting" | "writing" | "appealing" | "out" | "no-output" | "duplicate" | "pending";

export interface LineCard {
  line: BracketLine;
  standing: Standing;
  /** W / L per match it played, oldest first. */
  record: { match: string; round: number; won: boolean | null; vs: string | null }[];
  wins: number;
  losses: number;
  /** For a line that is out: the match, who beat it, and why. */
  out?: { match: string; round: number; by: string | null; reason: string; score?: string };
  /** The line a duplicate copies. */
  copyOf?: string;
}

export interface MatchCard {
  match: BracketMatch;
  /** The verdict to draw: the recorded one, else a judge's provisional one. */
  verdict: Verdict | null;
  provisional: boolean;
  /** The winner to draw: recorded, else the provisional one. */
  winner: string | null;
  totals: { a: number; b: number } | null;
  /** Winner's points minus loser's. */
  margin: number | null;
  state: "waiting" | "judging" | "provisional" | "decided" | "bye";
}

export interface RoundColumn {
  round: number;
  matches: MatchCard[];
  current: boolean;
}

export interface ArenaModel {
  lines: LineCard[];
  rounds: RoundColumn[];
  alive: number;
  out: number;
  total: number;
  /** Lines in a match of the current round that is not decided yet. */
  inRing: Set<string>;
}

const STANDING_ORDER: Record<Standing, number> = { champion: 0, fighting: 1, appealing: 2, writing: 3, alive: 4, pending: 5, out: 6, duplicate: 7, "no-output": 8 };

/** A match as the board draws it. Pure. */
export function matchCard(m: BracketMatch): MatchCard {
  const verdict = m.verdict ?? m.provisional?.verdict ?? null;
  const provisional = !m.verdict && !!m.provisional;
  const winner = m.winner ?? m.provisional?.winner ?? null;
  const totals = verdict ? { a: total(verdict.a), b: total(verdict.b) } : null;
  const margin = totals && winner ? Math.round(Math.abs(totals.a - totals.b) * 100) / 100 : null;
  const bye = !m.a || !m.b;
  const state: MatchCard["state"] = bye ? "bye" : m.winner ? "decided" : provisional ? "provisional" : m.judging ? "judging" : "waiting";
  return { match: m, verdict, provisional, winner, totals, margin, state };
}

/** Why a match went the way it did, in a few words. Pure. */
export function reasonOf(m: BracketMatch, loser: string): string {
  const v = m.verdict;
  const side = m.a === loser ? "a" : "b";
  if (v && v.fatal[side] === "upheld") return "FATAL upheld";
  if (m.notes.some((n) => /overruled by points/.test(n))) return "on points (pick overruled)";
  if (m.notes.some((n) => /tie on points/.test(n))) return "tie, judge's pick";
  return "on points";
}

/** The score of a decided match as "winner : loser". Pure. */
function scoreOf(m: BracketMatch, winner: string | null): string | undefined {
  if (!m.verdict || !winner) return undefined;
  const ta = total(m.verdict.a);
  const tb = total(m.verdict.b);
  return winner === m.a ? `${ta} : ${tb}` : `${tb} : ${ta}`;
}

/** The arena board's model. Pure. */
export function arenaModel(v: BracketView): ArenaModel {
  const cards = v.matches.map(matchCard);
  const current = cards.filter((c) => c.match.round === v.round);
  const inRing = new Set<string>();
  for (const c of current) if (c.state === "judging" || c.state === "waiting" || c.state === "provisional") for (const id of [c.match.a, c.match.b]) if (id) inRing.add(id);

  const lines: LineCard[] = v.lines.map((line) => {
    const played = v.matches.filter((m) => m.a === line.id || m.b === line.id);
    const record = played.map((m) => ({ match: m.id, round: m.round, won: m.winner ? m.winner === line.id : null, vs: m.a === line.id ? m.b : m.a }));
    const card: LineCard = { line, standing: "alive", record, wins: record.filter((r) => r.won === true).length, losses: record.filter((r) => r.won === false).length };
    if (line.status === "eliminated") {
      const lostIn = line.lastLoss ? v.matches.find((m) => m.id === line.lastLoss!.match) : [...played].reverse().find((m) => m.loser === line.id);
      card.standing = "out";
      if (lostIn) card.out = { match: lostIn.id, round: lostIn.round, by: lostIn.winner, reason: line.lastLoss?.upheldFatal ? "FATAL upheld" : reasonOf(lostIn, line.id), score: scoreOf(lostIn, lostIn.winner) };
    } else if (line.status === "duplicate") {
      card.standing = "duplicate";
      if (line.lineage !== line.id) card.copyOf = line.lineage;
    } else if (line.status === "no-output") card.standing = "no-output";
    else if (line.status === "pending") card.standing = line.writing ? "writing" : "pending";
    else if (v.champion === line.id) card.standing = "champion";
    else if (line.appealing) card.standing = "appealing";
    else if (inRing.has(line.id)) card.standing = "fighting";
    else if (line.writing) card.standing = "writing";
    return card;
  });
  lines.sort((a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] || a.line.id.localeCompare(b.line.id, undefined, { numeric: true }));

  const roundNos = [...new Set(v.matches.map((m) => m.round))].sort((a, b) => a - b);
  const rounds = roundNos.map((round) => ({ round, matches: cards.filter((c) => c.match.round === round), current: round === v.round }));
  const alive = v.lines.filter((l) => l.status === "alive").length;
  return { lines, rounds, alive, out: v.lines.filter((l) => l.status === "eliminated").length, total: v.lines.length, inRing };
}

/** The phase in words. Pure. */
export function phaseLabel(v: Pick<BracketView, "phase" | "round" | "champion">): string {
  switch (v.phase) {
    case "generating":
      return "Lines are being written";
    case "judging":
      return `Round ${v.round} — judges at work`;
    case "appeals":
      return `Round ${v.round} — appeals`;
    case "advancing":
      return `Round ${v.round} done — pairing the next`;
    case "done":
      return v.champion ? `${v.champion} wins` : "Finished";
  }
}

/** Lines whose standing changed between two models: the board animates these. Pure. */
export function changed(prev: ArenaModel | null, next: ArenaModel): { knockedOut: Set<string>; decided: Set<string> } {
  const knockedOut = new Set<string>();
  const decided = new Set<string>();
  if (!prev) return { knockedOut, decided };
  const before = new Map(prev.lines.map((l) => [l.line.id, l.standing]));
  for (const l of next.lines) if (l.standing === "out" && before.has(l.line.id) && before.get(l.line.id) !== "out") knockedOut.add(l.line.id);
  const was = new Map(prev.rounds.flatMap((r) => r.matches.map((m) => [m.match.id, m.state] as const)));
  for (const r of next.rounds) for (const m of r.matches) if ((m.state === "decided" || m.state === "provisional") && was.get(m.match.id) !== m.state) decided.add(m.match.id);
  return { knockedOut, decided };
}

/** The judge agent of a match: the one whose report stands, else the provisional one, else the one at work. */
export const judgeOf = (m: BracketMatch): string | undefined => m.report?.agentId ?? m.provisional?.agentId ?? m.judging?.agentId;

/**
 * How far an arena is and roughly how long it still runs (owner, 2026-11-26), read from the judges it already
 * ran. A knockout ends when one line is left, so every remaining match takes one contender out: `left` is the
 * contenders less one. Appeals and comebacks can add matches, so this is a floor and the time an estimate.
 * `perMatchMs` is the arena's own pace — the span from the first judge's start to the last one's end over the
 * judges done — so judges running side by side count as they ran. No judge done yet: no estimate. Pure.
 */
export interface ArenaPace {
  decided: number;
  /** Matches still to judge, at least. */
  left: number;
  /** A judge's median run, from the ones done. */
  typicalMs: number | null;
  perMatchMs: number | null;
  etaMs: number | null;
}

const at = (iso?: string): number | null => (iso ? Date.parse(iso) || null : null);

export function arenaPace(v: BracketView, agents: readonly WorkflowAgent[], nowMs: number): ArenaPace {
  const byId = new Map(agents.map((a) => [a.agentId, a]));
  const cards = v.matches.map(matchCard);
  const decided = cards.filter((c) => c.state === "decided" || c.state === "provisional").length;
  const contenders = v.lines.filter((l) => l.status === "alive" || l.status === "pending").length;
  const left = v.phase === "done" || v.champion ? 0 : Math.max(0, contenders - 1);
  const runs = v.matches
    .map((m) => byId.get(judgeOf(m) ?? ""))
    .filter((a): a is WorkflowAgent => !!a && a.state === "done")
    .map((a) => ({ start: at(a.startedAt), end: at(a.endedAt) }))
    .filter((r): r is { start: number; end: number } => r.start !== null && r.end !== null && r.end >= r.start);
  if (!runs.length) return { decided, left, typicalMs: null, perMatchMs: null, etaMs: null };
  const lengths = runs.map((r) => r.end - r.start).sort((a, b) => a - b);
  const mid = lengths.length >> 1;
  const typicalMs = lengths.length % 2 ? lengths[mid] : Math.round((lengths[mid - 1] + lengths[mid]) / 2);
  const perMatchMs = Math.round((Math.max(...runs.map((r) => r.end)) - Math.min(...runs.map((r) => r.start))) / runs.length);
  // Matches a provisional verdict already settled need no judge; one at work has part of its run behind it.
  const settled = cards.filter((c) => c.state === "provisional").length;
  const working = v.matches.map((m) => (m.judging ? byId.get(m.judging.agentId) : undefined)).filter((a): a is WorkflowAgent => !!a && a.state === "running");
  const spent = working.reduce((s, a) => s + Math.min(typicalMs, Math.max(0, nowMs - (at(a.startedAt) ?? nowMs))), 0);
  const etaMs = left === 0 ? 0 : Math.max(0, Math.max(0, left - settled) * perMatchMs - Math.round((spent * perMatchMs) / typicalMs));
  return { decided, left, typicalMs, perMatchMs, etaMs };
}

/** One match's judge against the arena's typical run: how long it has run and roughly how long it still takes. Pure. */
export function matchPace(m: BracketMatch, agents: readonly WorkflowAgent[], typicalMs: number | null, nowMs: number): { running: boolean; elapsedMs: number | null; leftMs: number | null; ratio: number | null; doing?: string } {
  const a = agents.find((x) => x.agentId === judgeOf(m));
  const start = at(a?.startedAt);
  const running = a?.state === "running" || (!a && !!m.judging);
  const end = running ? nowMs : (at(a?.endedAt) ?? null);
  const elapsedMs = start !== null && end !== null ? Math.max(0, end - start) : null;
  const leftMs = running && elapsedMs !== null && typicalMs ? Math.max(0, typicalMs - elapsedMs) : null;
  const ratio = !running && (m.winner || m.provisional) ? 1 : running && elapsedMs !== null && typicalMs ? Math.min(0.95, elapsedMs / typicalMs) : null;
  return { running, elapsedMs, leftMs, ratio, doing: m.judging?.doing ?? a?.doing };
}
