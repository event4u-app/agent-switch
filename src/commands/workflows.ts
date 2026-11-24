/**
 * `agent-switch workflows <session> [--json] [--live] [--line RUN/LID]`:
 * what a session orchestrates — its Workflow runs, the agent-config bracket
 * runs ("arena") it drives, and the council runs it started — read-only, for
 * the board view. `sessions --json` carries only the compact `workflows` and
 * `boards` fields; this is the detail the board polls while it is open.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { bracketRoot, bracketRuns, readBracket, readLineOutput, type BracketView } from "../bracket.js";
import { councilNames, councilRoot, liveRoot, readCouncils, readLiveTables, writeInbox, type CouncilView, type InboxMessage } from "../council-runs.js";
import { openTool, readConfined, readTail, sessionFolder } from "../lineage.js";
import { die } from "../profiles.js";
import { readWorkflows, summarize, workflowRecordsDir, type WorkflowRun, type WorkflowSummary } from "../workflows.js";
import { readSessionHeader } from "../sessions.js";
import { target } from "./bridge.js";

/** How much of the parent transcript is searched for the runs it names. */
export const MENTION_BYTES = 8 * 1024 * 1024;
/** A transcript written this recently counts as a live session when the caller does not say. */
const LIVE_WINDOW_MS = 10 * 60 * 1000;
/** The session-list poll reads only this much of a live session to see whether it drives a board. */
export const BOARD_HINT_BYTES = 1024 * 1024;

export interface Orchestration {
  key: string;
  live: boolean;
  workflows: WorkflowRun[];
  brackets: BracketView[];
  councils: CouncilView[];
  /** The session runs a council command right now (no file until it ends). */
  councilRunning?: { doing: string };
}

/** What a session wrote that can name a run: its transcript's tail and its workflow scripts and arguments. */
export function mentionsOf(transcript: string, runs: readonly WorkflowRun[], bytes = MENTION_BYTES): string {
  const parts = [readTail(transcript, bytes)];
  const folder = sessionFolder(transcript);
  if (folder) {
    const dir = path.join(workflowRecordsDir(folder), "scripts");
    try {
      for (const n of fs.readdirSync(dir)) if (n.endsWith(".js")) parts.push(readConfined(folder, path.join(dir, n), 256 * 1024)?.text ?? "");
    } catch {
      /* no scripts */
    }
  }
  for (const r of runs) if (r.args !== undefined) parts.push(JSON.stringify(r.args));
  return parts.join("\n");
}

/** Bracket runs a session's text names by their folder. Pure over the inputs. */
export function namedBrackets(runs: readonly string[], mentions: string): string[] {
  return runs.filter((r) => mentions.includes(`runtime/bracket/${r}`) || mentions.includes(`bracket/${r}/`));
}

const COUNCIL_CALL = /\bcouncil[:_ ]|ai_council|council_cli/i;

/**
 * Everything a session orchestrates, read now. `cwds`: the folders the
 * session worked in — a session that moved (a resume in a worktree) keeps
 * its runs where it started them, so every one is searched; a run found in
 * two of them counts once.
 */
export function readOrchestration(transcript: string, cwds: string | readonly string[], key: string, live: boolean): Orchestration {
  const folders = [...new Set(typeof cwds === "string" ? [cwds] : cwds)];
  const workflows = readWorkflows(transcript, live, true);
  const mentions = mentionsOf(transcript, workflows);
  const brackets: BracketView[] = [];
  const councils: CouncilView[] = [];
  for (const cwd of folders) {
    const root = bracketRoot(cwd);
    if (root)
      for (const r of namedBrackets(bracketRuns(root), mentions)) {
        const b = readBracket(cwd, r, workflows);
        if (b && !brackets.some((x) => x.run === b.run)) brackets.push(b);
      }
    for (const c of readCouncils(cwd, mentions, live)) if (!councils.some((x) => x.name === c.name)) councils.push(c);
  }
  const out: Orchestration = { key, live, workflows, brackets, councils };
  if (live) {
    const doing = openTool(readTail(transcript, BOARD_HINT_BYTES));
    if (doing && doing.startsWith("Bash") && COUNCIL_CALL.test(doing)) out.councilRunning = { doing };
  }
  return out;
}

/** One bracket run in a session row: enough to say who is left without opening the board. */
export interface BracketSummary {
  run: string;
  round: number;
  phase: BracketView["phase"];
  alive: number;
  total: number;
  champion: string | null;
}

export interface BoardFields {
  workflows?: WorkflowSummary[];
  boards?: ("bracket" | "council")[];
  brackets?: BracketSummary[];
  /** A council table of this session listens right now (agent-config live.jsonl). */
  councilLive?: boolean;
}

/**
 * The compact fields `sessions --json` adds to a Claude row: workflow
 * summaries, which boards the session's recent text names, and — for a
 * named bracket under `cwd` — its round and who is left. Only a session
 * that runs or ran a workflow pays for the tail read.
 */
export function boardFields(transcript: string, live: boolean, cwd?: string): BoardFields {
  const out: BoardFields = {};
  const runs = readWorkflows(transcript, live, false);
  if (runs.length) out.workflows = runs.map(summarize);
  // Every agent-config session carries rule and skill text that names councils
  // and brackets, so a word is no evidence: only a run's own folder or file is.
  const bRoot = cwd ? bracketRoot(cwd) : null;
  const cRoot = cwd ? councilRoot(cwd) : null;
  if (!cwd || (!bRoot && !cRoot && !liveRoot(cwd))) return out;
  if (!live && !runs.length) return out;
  const mentions = `${readTail(transcript, BOARD_HINT_BYTES)}\n${mentionsOf(transcript, [], 0)}`;
  const boards: ("bracket" | "council")[] = [];
  if (bRoot) {
    const brackets = namedBrackets(bracketRuns(bRoot), mentions)
      .map((r) => readBracket(cwd, r))
      .filter((b): b is BracketView => b !== null)
      .map((b) => ({ run: b.run, round: b.round, phase: b.phase, alive: b.lines.filter((l) => l.status === "alive").length, total: b.lines.length, champion: b.champion }));
    if (brackets.length) {
      out.brackets = brackets;
      boards.push("bracket");
    }
  }
  const named = cRoot ? councilNames(cRoot, mentions) : { files: [], debates: [] };
  const tables = readLiveTables(cwd, mentions, live);
  if (named.files.length || named.debates.length || tables.length) boards.push("council");
  if (tables.some((t) => t.live.listening)) out.councilLive = true;
  if (boards.length) out.boards = boards;
  return out;
}

/** The folders a session worked in: where it runs now (its last hook), and where its transcript says it started. */
function sessionCwds(t: { cwd: string; transcript: string | null }): string[] {
  const started = t.transcript ? readSessionHeader(t.transcript).cwd : null;
  return [...new Set([t.cwd, ...(started ? [started] : [])])];
}

/** The inbox message the council flags ask for; null when none is given. Pure. */
export function councilMessage(flags: Record<string, string | boolean>): InboxMessage | null {
  const asked = [typeof flags.say === "string" ? "say" : null, flags.pause ? "pause" : null, flags.resume ? "resume" : null, flags.stop ? "stop" : null].filter(Boolean);
  if (asked.length > 1) throw new Error("say, pause, resume and stop are one at a time");
  if (typeof flags.say === "string") return { type: "say", text: flags.say };
  return flags.pause ? { type: "pause" } : flags.resume ? { type: "resume" } : flags.stop ? { type: "stop" } : null;
}

export function cmdWorkflows(arg: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg) die("usage: agent-switch workflows <session> [--json] [--live] [--line RUN/LINE] [--council RUN --say TEXT|--pause|--resume|--stop]");
  const t = target(arg);
  if (t.provider !== "claude" || !t.transcript) die("workflows reads Claude sessions only");
  if (typeof flags.council === "string") {
    let msg: InboxMessage | null;
    try {
      msg = councilMessage(flags);
    } catch (err) {
      return die((err as Error).message);
    }
    if (!msg) die("--council needs --say TEXT, --pause, --resume or --stop");
    const errors: string[] = [];
    for (const cwd of sessionCwds(t)) {
      try {
        writeInbox(cwd, flags.council, msg);
        if (flags.json) console.log(JSON.stringify({ key: t.key, council: flags.council, sent: msg.type }));
        return;
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    die(errors[errors.length - 1] ?? "no live council");
  }
  if (typeof flags.line === "string") {
    const [run, line] = flags.line.split("/");
    const text = run && line ? (sessionCwds(t).map((c) => readLineOutput(c, run, line)).find((x) => x !== null) ?? null) : null;
    if (text === null) die(`no readable output for ${flags.line}`);
    if (flags.json) return void console.log(JSON.stringify({ key: t.key, run, line, text }));
    return void process.stdout.write(text);
  }
  let live = flags.live === true;
  if (!live) {
    try {
      live = Date.now() - fs.statSync(t.transcript).mtimeMs < LIVE_WINDOW_MS;
    } catch {
      live = false;
    }
  }
  const o = readOrchestration(t.transcript, sessionCwds(t), t.key, live);
  if (flags.json) return void console.log(JSON.stringify(o));
  for (const w of o.workflows) {
    const s = summarize(w);
    console.log(`workflow ${w.name} (${w.runId}) · ${w.status} · ${s.done}/${s.total} done${s.failed ? ` · ${s.failed} failed` : ""}${s.phase ? ` · ${s.phase}` : ""}`);
  }
  for (const b of o.brackets) {
    const alive = b.lines.filter((l) => l.status === "alive").length;
    console.log(`bracket ${b.run} · round ${b.round} · ${b.phase} · ${alive}/${b.lines.length} alive${b.champion ? ` · champion ${b.champion}` : ""}`);
  }
  for (const c of o.councils) console.log(`council ${c.name} · ${c.kind} · ${c.members.length} seats${c.open ? " · open" : ""}`);
  if (o.councilRunning) console.log(`council running: ${o.councilRunning.doing}`);
}
