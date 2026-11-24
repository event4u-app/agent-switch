/**
 * agent-config council runs as the session that started them sees them:
 * `<cwd>/agents/runtime/council/responses/<name>.json` (written once, at the
 * end of a run) and debate folders `responses/<name>/debate-round-N.json`
 * (written as each round completes — the only council state on disk while a
 * council still runs). Which runs belong to a session is read from what the
 * session wrote: a run counts only when its file name appears in the
 * session's transcript.
 *
 * Reads stay inside `<cwd>/agents/runtime/council/responses` once links are
 * followed; every read is bounded; each seat's text is cut for the view.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { readConfined } from "./lineage.js";

const NAME = /^[A-Za-z0-9._-]{1,120}$/;
const FILE_BYTES = 4 * 1024 * 1024;
export const SEAT_TEXT_MAX = 12 * 1024;
const ASK_MAX = 800;

export interface CouncilSeat {
  /** "anthropic/claude-sonnet-4-5" */
  member: string;
  provider: string;
  model: string;
  /** The seat's first line, cleaned: usually its verdict ("Verdict: C with caveats"). */
  headline?: string;
  text: string;
  truncated: boolean;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  error?: string;
  /** "Response-A" when the run was blinded. */
  blindLabel?: string;
  /** The table's id for a declared seat ("anthropic#skeptic") and its role. */
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
  /** How often this seat has been asked. */
  turn: number;
  headline?: string;
  error?: string;
  outputTokens?: number;
  latencyMs?: number;
  /** Why a declared seat could not sit. */
  absent?: string;
}

export type LiveStatus = "running" | "paused" | "stopping" | "completed" | "stopped" | "failed";

/** A council's live table (agent-config `live.jsonl`), as the board draws it. */
export interface CouncilLive {
  /** The live folder's name: the run's response stem or the debate's folder. */
  stem: string;
  subcommand: "run" | "debate";
  status: LiveStatus;
  seats: LiveSeat[];
  /** What the human said at the table, in order. */
  said: { text: string; at: string; before?: string }[];
  /** Remarks the council refused (its egress check); their text is not kept. */
  refused: number;
  /** The table's last moves, newest last, in words. */
  feed: { at: string; text: string; kind: "seat" | "human" | "table" }[];
  /** The highest turn any seat reached. */
  turn: number;
  startedAt?: string;
  finishedAt?: string;
  /** The inbox listens: the run is under way. */
  listening: boolean;
}

export interface CouncilRound {
  round: number;
  total: number;
  costUsd?: number;
  seats: CouncilSeat[];
}

export interface CouncilView {
  /** The response file or debate folder name. */
  name: string;
  kind: "run" | "debate";
  mode?: string;
  promptMode?: string;
  ask?: string;
  artefact?: string;
  members: string[];
  /** Rounds of a run: its last round's seats are `seats`. Rounds of a debate: `rounds`. */
  seats: CouncilSeat[];
  rounds: CouncilRound[];
  costUsd?: number;
  quorum?: { status?: string; threshold?: number; total?: number; present?: number };
  absent: { member: string; reason?: string }[];
  chairman?: { member?: string; text: string };
  decision?: string;
  /** A debate whose last round says more rounds follow, or a live table still under way. */
  open: boolean;
  updatedAt?: string;
  /** The live table, when agent-config wrote one for this run. */
  live?: CouncilLive;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The first meaningful line of a seat's answer, without markdown marks. Pure. */
export function headlineOf(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((raw) => raw.replace(/^#+\s*/, "").replace(/[*_`>]/g, "").trim())
    .filter(Boolean);
  // A seat that states its verdict near the top is read by it; otherwise by its first line.
  const verdict = lines.slice(0, 20).find((l) => /^(verdict|recommendation|stance|empfehlung|urteil)\b/i.test(l));
  const pick = verdict ?? lines[0];
  return pick ? pick.slice(0, 160) : undefined;
}

/** One seat from a council response entry. Pure. */
export function toSeat(raw: unknown, blind: ReadonlyMap<string, string>): CouncilSeat {
  const r = obj(raw);
  const provider = str(r.provider);
  const model = str(r.model);
  const text = str(r.text);
  const meta = obj(r.metadata);
  const seat: CouncilSeat = { member: `${provider}/${model}`, provider, model, text: text.slice(0, SEAT_TEXT_MAX), truncated: text.length > SEAT_TEXT_MAX };
  const h = headlineOf(text);
  if (h) seat.headline = h;
  if (num(r.input_tokens) !== undefined) seat.inputTokens = num(r.input_tokens);
  if (num(r.output_tokens) !== undefined) seat.outputTokens = num(r.output_tokens);
  if (num(r.latency_ms) !== undefined) seat.latencyMs = num(r.latency_ms);
  const cost = num(meta.cost_usd) ?? num(meta.reported_cost_usd);
  if (cost !== undefined) seat.costUsd = cost;
  if (str(r.error)) seat.error = str(r.error).slice(0, 400);
  const label = blind.get(`${provider}:${model}`);
  if (label) seat.blindLabel = label;
  const declared = obj(meta.seat);
  if (str(declared.id)) seat.seatId = str(declared.id);
  if (str(declared.role)) seat.role = str(declared.role);
  return seat;
}

function blindMap(v: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const [label, who] of Object.entries(obj(v))) if (typeof who === "string") out.set(who, label);
  return out;
}

/** A finished council run's file, as the view needs it; null when it is not one. Pure. */
export function parseCouncil(text: string, name: string): CouncilView | null {
  let j: Json;
  try {
    j = obj(JSON.parse(text));
  } catch {
    return null;
  }
  if (!Array.isArray(j.responses) || !Array.isArray(j.members)) return null;
  const blind = blindMap(j.blind_review_map);
  const view: CouncilView = {
    name,
    kind: "run",
    members: arr(j.members).map(str).filter(Boolean),
    seats: arr(j.responses).map((r) => toSeat(r, blind)),
    rounds: [],
    absent: arr(j.absent_members).map(obj).map((a) => ({ member: str(a.member), ...(str(a.reason) ? { reason: str(a.reason) } : {}) })).filter((a) => a.member),
    open: false,
  };
  if (str(j.mode)) view.mode = str(j.mode);
  if (str(j.prompt_mode)) view.promptMode = str(j.prompt_mode);
  if (str(j.original_ask)) view.ask = str(j.original_ask).slice(0, ASK_MAX);
  if (str(j.artefact)) view.artefact = path.basename(str(j.artefact));
  const cost = num(j.cost_usd_actual) ?? num(j.cost_usd_estimated);
  if (cost !== undefined) view.costUsd = cost;
  const q = obj(j.quorum);
  if (Object.keys(q).length) view.quorum = { status: str(q.status) || undefined, threshold: num(q.threshold), total: num(q.total), present: num(q.present) };
  const ch = obj(j.chairman);
  if (str(ch.text)) view.chairman = { member: str(ch.member) || undefined, text: str(ch.text).slice(0, SEAT_TEXT_MAX) };
  const decision = obj(j.handoff).decision;
  if (typeof decision === "string" && decision) view.decision = decision.slice(0, 2000);
  return view;
}

/** A debate folder's rounds, in round order, as one view. Pure over the round texts. */
export function parseDebate(rounds: readonly string[], name: string): CouncilView | null {
  const parsed = rounds
    .map((t) => {
      try {
        return obj(JSON.parse(t));
      } catch {
        return {};
      }
    })
    .filter((j) => Array.isArray(j.responses))
    .sort((a, b) => (num(a.debate_round) ?? 0) - (num(b.debate_round) ?? 0));
  if (!parsed.length) return null;
  const last = parsed[parsed.length - 1];
  const view: CouncilView = {
    name,
    kind: "debate",
    members: arr(last.members).map(str).filter(Boolean),
    seats: [],
    rounds: parsed.map((j) => ({ round: num(j.debate_round) ?? 0, total: num(j.debate_total_rounds) ?? 0, ...(num(j.cost_usd_actual) !== undefined ? { costUsd: num(j.cost_usd_actual) } : {}), seats: arr(j.responses).map((r) => toSeat(r, new Map())) })),
    absent: [],
    open: (num(last.debate_round) ?? 0) < (num(last.debate_total_rounds) ?? 0),
  };
  view.mode = "debate";
  const ask = str(last.original_ask) || str(parsed[0].original_ask);
  if (ask) view.ask = ask.slice(0, ASK_MAX);
  if (str(last.artefact)) view.artefact = path.basename(str(last.artefact));
  const cost = view.rounds.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  if (cost > 0) view.costUsd = Math.round(cost * 1e6) / 1e6;
  view.seats = view.rounds[view.rounds.length - 1].seats;
  return view;
}

/** `<cwd>/agents/runtime/council/responses`, links resolved; null when there is none. */
export function councilRoot(cwd: string): string | null {
  try {
    const root = fs.realpathSync(path.join(cwd, "agents", "runtime", "council", "responses"));
    return fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

/** The council runs a session's text names: response files and debate folders whose name it mentions. */
export function councilNames(root: string, mentions: string): { files: string[]; debates: string[] } {
  const files: string[] = [];
  const debates: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return { files, debates };
  }
  for (const n of names) {
    if (!NAME.test(n)) continue;
    const full = path.join(root, n);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && n.endsWith(".json") && !n.startsWith("debate-round-") && mentions.includes(`responses/${n}`)) files.push(n);
    else if (st.isDirectory() && mentions.includes(`responses/${n}`)) debates.push(n);
  }
  return { files: files.sort(), debates: debates.sort() };
}

/** The council runs a session started, oldest first. `mentions`: the session's own text (transcript tail, workflow scripts). */
export function readCouncils(cwd: string, mentions: string, sessionLive = true): CouncilView[] {
  const root = councilRoot(cwd);
  const out: CouncilView[] = [];
  const { files, debates } = root ? councilNames(root, mentions) : { files: [], debates: [] };
  if (root) {
  for (const f of files) {
    const r = readConfined(root, path.join(root, f), FILE_BYTES);
    const v = r ? parseCouncil(r.text, f.replace(/\.json$/, "")) : null;
    if (v && r) out.push({ ...v, updatedAt: new Date(r.mtimeMs).toISOString() });
  }
  for (const d of debates) {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(root, d)).filter((n) => /^debate-round-\d{1,2}\.json$/.test(n));
    } catch {
      continue;
    }
    const reads = names.map((n) => readConfined(root, path.join(root, d, n), FILE_BYTES)).filter((r): r is NonNullable<typeof r> => r !== null);
    const v = parseDebate(reads.map((r) => r.text), d);
    if (v) out.push({ ...v, updatedAt: new Date(Math.max(...reads.map((r) => r.mtimeMs))).toISOString() });
  }
  }
  // A live table joins the view of its run, or stands as the view while the run has no file yet.
  for (const t of readLiveTables(cwd, mentions, sessionLive)) {
    const v = out.find((c) => c.name === t.live.stem);
    if (v) {
      v.live = t.live;
      v.open = v.open || t.live.listening;
      const roles = new Map(t.live.seats.map((s) => [s.id, s.role]));
      for (const s of [...v.seats, ...v.rounds.flatMap((r) => r.seats)]) if (s.seatId && !s.role && roles.get(s.seatId)) s.role = roles.get(s.seatId);
    } else out.push({ ...viewFromLive(t.live, t.ask), updatedAt: new Date(t.mtimeMs).toISOString() });
  }
  return out.sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
}

const LIVE_BYTES = 2 * 1024 * 1024;
const STEM = /^[A-Za-z0-9._-]{1,120}$/;
const FEED_KEEP = 40;
/** What one remark may carry; agent-config cuts at the same length. */
export const SAY_MAX = 2000;

/** `<cwd>/agents/runtime/council/live`, links resolved; null when there is none. */
export function liveRoot(cwd: string): string | null {
  try {
    const root = fs.realpathSync(path.join(cwd, "agents", "runtime", "council", "live"));
    return fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

/**
 * A `live.jsonl` as the board draws it. `sessionLive`: the session that runs
 * the council still runs — a log that never finished, from a session that
 * ended, is a failed run, not a table still waiting. Pure.
 */
export function parseLive(text: string, stem: string, sessionLive: boolean): CouncilLive | null {
  const lines = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return obj(JSON.parse(l));
      } catch {
        return null;
      }
    })
    .filter((e): e is Json => e !== null);
  const head = lines.find((e) => e.type === "run.started");
  if (!head) return null;
  const seats = new Map<string, LiveSeat>();
  for (const raw of arr(head.seats).map(obj)) {
    const id = str(raw.id);
    if (!id) continue;
    const seat: LiveSeat = { id, member: str(raw.member) || id, state: str(raw.absent) ? "absent" : "waiting", turn: 0 };
    if (str(raw.model)) seat.model = str(raw.model);
    if (str(raw.role)) seat.role = str(raw.role);
    if (str(raw.brief)) seat.brief = str(raw.brief);
    if (str(raw.absent)) seat.absent = str(raw.absent);
    seats.set(id, seat);
  }
  const live: CouncilLive = { stem, subcommand: head.subcommand === "debate" ? "debate" : "run", status: "running", seats: [], said: [], refused: 0, feed: [], turn: 0, listening: false };
  if (str(head.at)) live.startedAt = str(head.at);
  const name = (id: string) => seats.get(id)?.role ?? id;
  const feed = (e: Json, text: string, kind: "seat" | "human" | "table") => live.feed.push({ at: str(e.at), text, kind });
  let paused = false;
  let stopping = false;
  for (const e of lines) {
    const seat = seats.get(str(e.seat));
    switch (e.type) {
      case "seat.started":
        if (!seat) break;
        seat.state = "thinking";
        seat.turn = num(e.turn) ?? seat.turn + 1;
        live.turn = Math.max(live.turn, seat.turn);
        feed(e, `${name(seat.id)} is thinking (turn ${seat.turn})`, "seat");
        break;
      case "seat.finished":
        if (!seat) break;
        seat.state = e.ok === false ? "failed" : "answered";
        if (str(e.headline)) seat.headline = str(e.headline).slice(0, 160);
        else delete seat.headline;
        if (str(e.error)) seat.error = str(e.error).slice(0, 300);
        if (num(e.output_tokens) !== undefined) seat.outputTokens = num(e.output_tokens);
        if (num(e.latency_ms) !== undefined) seat.latencyMs = num(e.latency_ms);
        feed(e, seat.state === "failed" ? `${name(seat.id)} failed: ${seat.error ?? "no answer"}` : `${name(seat.id)}: ${seat.headline ?? "answered"}`, "seat");
        break;
      case "seat.skipped":
        if (seat) seat.state = "skipped";
        break;
      case "human.said":
        if (str(e.text)) {
          live.said.push({ text: str(e.text).slice(0, SAY_MAX), at: str(e.at), ...(str(e.before) ? { before: str(e.before) } : {}) });
          feed(e, `You: ${str(e.text).slice(0, 200)}`, "human");
        }
        break;
      case "human.refused":
        live.refused++;
        feed(e, "A remark was refused by the council's secret check and not sent", "table");
        break;
      case "run.paused":
        paused = true;
        feed(e, "Hand raised — the table waits", "table");
        break;
      case "run.resumed":
        paused = false;
        feed(e, "The table goes on", "table");
        break;
      case "run.stopping":
        stopping = true;
        feed(e, e.by === "pause-limit" ? "The pause ran out — the table stops" : "You stopped the table", "table");
        break;
      case "run.finished":
        live.status = e.status === "completed" || e.status === "stopped" ? e.status : "failed";
        if (str(e.at)) live.finishedAt = str(e.at);
        feed(e, `The table ${live.status === "completed" ? "finished" : live.status}`, "table");
        break;
    }
  }
  if (!live.finishedAt) {
    if (!sessionLive) live.status = "failed";
    else live.status = stopping ? "stopping" : paused ? "paused" : "running";
  }
  live.listening = live.status === "running" || live.status === "paused";
  live.seats = [...seats.values()];
  live.feed = live.feed.slice(-FEED_KEEP);
  return live;
}

/** A view for a live table whose response file is not written yet. Pure. */
export function viewFromLive(live: CouncilLive, ask: string | undefined): CouncilView {
  const present = live.seats.filter((s) => s.state !== "absent");
  return {
    name: live.stem,
    kind: live.subcommand === "debate" ? "debate" : "run",
    ...(ask ? { ask: ask.slice(0, ASK_MAX) } : {}),
    members: present.map((s) => `${s.member}/${s.model ?? "?"}`),
    seats: present.map((s) => ({ member: s.id, provider: s.member, model: s.model ?? "", text: "", truncated: false, seatId: s.id, ...(s.role ? { role: s.role } : {}), ...(s.headline ? { headline: s.headline } : {}), ...(s.error ? { error: s.error } : {}) })),
    rounds: [],
    absent: live.seats.filter((s) => s.state === "absent").map((s) => ({ member: s.id, ...(s.absent ? { reason: s.absent } : {}) })),
    open: live.listening,
    live,
  };
}

/** The live tables under `cwd` a session's text names by their response stem. */
export function readLiveTables(cwd: string, mentions: string, sessionLive: boolean): { live: CouncilLive; ask?: string; mtimeMs: number }[] {
  const root = liveRoot(cwd);
  if (!root) return [];
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((n) => STEM.test(n) && mentions.includes(`responses/${n}`));
  } catch {
    return [];
  }
  const out: { live: CouncilLive; ask?: string; mtimeMs: number }[] = [];
  for (const n of names.sort()) {
    const r = readConfined(root, path.join(root, n, "live.jsonl"), LIVE_BYTES);
    if (!r) continue;
    const live = parseLive(r.text, n, sessionLive);
    if (!live) continue;
    const head = r.text.split("\n").find((l) => l.includes('"run.started"'));
    let ask: string | undefined;
    try {
      ask = head ? str(obj(JSON.parse(head)).ask) || undefined : undefined;
    } catch {
      ask = undefined;
    }
    out.push({ live, ...(ask ? { ask } : {}), mtimeMs: r.mtimeMs });
  }
  return out;
}

export type InboxMessage = { type: "say"; text: string } | { type: "pause" } | { type: "resume" } | { type: "stop" };

/**
 * Speak at a live table: append one message to its inbox. Only a table still
 * under way listens; the folder and the inbox must be the council's own, with
 * no link on the way out of `agents/runtime/council/live`.
 */
export function writeInbox(cwd: string, stem: string, msg: InboxMessage, sessionLive = true): void {
  if (!STEM.test(stem)) throw new Error(`${stem} is not a council run name`);
  const root = liveRoot(cwd);
  if (!root) throw new Error("this session's folder has no live council");
  const dir = path.join(root, stem);
  const log = readConfined(root, path.join(dir, "live.jsonl"), LIVE_BYTES);
  const live = log ? parseLive(log.text, stem, sessionLive) : null;
  if (!live) throw new Error(`no live council ${stem}`);
  if (!live.listening) throw new Error(`the council ${stem} is ${live.status}; it no longer listens`);
  const inbox = path.join(dir, "inbox.jsonl");
  let st: fs.Stats;
  try {
    st = fs.lstatSync(inbox);
  } catch {
    throw new Error(`the council ${stem} has no inbox`);
  }
  if (!st.isFile() || st.isSymbolicLink() || !fs.realpathSync(inbox).startsWith(root + path.sep)) throw new Error(`the inbox of ${stem} is not the council's own file`);
  const line = msg.type === "say" ? { type: "say", text: msg.text.trim().slice(0, SAY_MAX), at: new Date().toISOString() } : { type: msg.type, at: new Date().toISOString() };
  if (msg.type === "say" && !line.text) throw new Error("nothing to say");
  fs.appendFileSync(inbox, JSON.stringify(line) + "\n", { flag: "a" });
}
