/**
 * A session's Workflow runs, read from Claude Code's own files next to its
 * transcript. A run started with the Workflow tool leaves:
 *   - `<session>/subagents/workflows/<runId>/journal.jsonl` — `started` and
 *     `result` lines per agent call, keyed by a cache key that a resumed run
 *     reuses for the same call;
 *   - `<session>/subagents/workflows/<runId>/agent-<id>.jsonl` (+ `.meta.json`,
 *     whose `description` is the call's label and `workflowPhase` its phase);
 *   - `<session>/workflows/scripts/<name>-<runId>.js` — the script, whose
 *     `export const meta` names the run and its phases;
 *   - `<session>/workflows/<runId>.json` — only once the run has ended: status,
 *     duration, tokens and per-agent progress.
 * The arguments a run got are in the parent transcript's Workflow call.
 *
 * Every read is confined to the session's folder (`readConfined`) and bounded;
 * a run id or agent id that is not plain reads nothing. Nothing is inferred
 * from timing or order: a call is matched to its result by its journal key.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { openTool, readConfined, readTail, sessionFolder, SUBAGENT_TAIL_BYTES } from "./lineage.js";

const RUN_ID = /^wf_[A-Za-z0-9_-]{1,64}$/;
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const JOURNAL_BYTES = 8 * 1024 * 1024;
const RECORD_BYTES = 4 * 1024 * 1024;
const SCRIPT_BYTES = 256 * 1024;
const META_BYTES = 16 * 1024;
const PARENT_BYTES = 4 * 1024 * 1024;
/** A result larger than this, serialised, is cut to a preview: the view needs scores and verdicts, not a dump. */
export const RESULT_MAX = 24 * 1024;

export type WorkflowAgentState = "running" | "done" | "failed" | "stopped";
export type WorkflowStatus = "running" | "completed" | "failed" | "stopped";

export interface WorkflowAgent {
  agentId: string;
  /** The call's `label` ("judge:R1M3"), else its agent id. */
  label: string;
  phase?: string;
  state: WorkflowAgentState;
  /** How many times this call was started, across resumes. */
  attempts: number;
  startedAt?: string;
  endedAt?: string;
  /** "Bash · npm test" while it runs. */
  doing?: string;
  model?: string;
  tokens?: number;
  /** What the call returned, as the journal holds it (cut to a preview when large). */
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
  /** The arguments of the newest Workflow call that ran this run, when the parent transcript still holds it. */
  args?: unknown;
  /** Resumed at least once. */
  resumed: boolean;
}

/** The compact form `sessions --json` carries per run. */
export interface WorkflowSummary {
  runId: string;
  name: string;
  status: WorkflowStatus;
  /** The phase the newest running call is in, else the last phase. */
  phase?: string;
  done: number;
  failed: number;
  total: number;
  startedAt?: string;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const iso = (ms: number | undefined): string | undefined => (ms !== undefined && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined);

function jsonLines(text: string): Json[] {
  const out: Json[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(obj(JSON.parse(l)));
    } catch {
      /* a torn line at the tail of a file still being written */
    }
  }
  return out;
}

function parseJson(text: string): Json {
  try {
    return obj(JSON.parse(text));
  } catch {
    return {};
  }
}

/** `<session>/subagents/workflows` and `<session>/workflows` for a transcript. Pure. */
export const workflowAgentsDir = (folder: string): string => path.join(folder, "subagents", "workflows");
export const workflowRecordsDir = (folder: string): string => path.join(folder, "workflows");

/** `name`, `description` and phase titles from a script's `export const meta = {…}` literal. Pure; never evaluates the script. */
export function scriptMeta(script: string): { name?: string; description?: string; phases: string[] } {
  const at = script.indexOf("export const meta");
  if (at < 0) return { phases: [] };
  const body = script.slice(at, at + 4000);
  const lit = (key: string): string | undefined => {
    const m = new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(body);
    return m ? m[2].replace(/\\(.)/g, "$1") : undefined;
  };
  const phasesAt = body.search(/\bphases\s*:\s*\[/);
  const phases: string[] = [];
  if (phasesAt >= 0) {
    const close = body.indexOf("]", phasesAt);
    const list = body.slice(phasesAt, close < 0 ? undefined : close);
    for (const m of list.matchAll(/\btitle\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) phases.push(m[2].replace(/\\(.)/g, "$1"));
  }
  return { name: lit("name"), description: lit("description"), phases };
}

/** A result the view can carry: as is, or cut to a preview when it serialises larger than `max`. Pure. */
export function boundResult(v: unknown, max = RESULT_MAX): unknown {
  if (v === undefined) return undefined;
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    return { truncated: true, preview: "" };
  }
  if (s === undefined || s.length <= max) return v;
  return { truncated: true, preview: (typeof v === "string" ? v : s).slice(0, Math.floor(max / 2)) };
}

/** The run ids under a session folder: agent folders and finished records, plain ids only, sorted. */
export function workflowRunIds(folder: string): string[] {
  const ids = new Set<string>();
  for (const dir of [workflowAgentsDir(folder)]) {
    try {
      for (const d of fs.readdirSync(dir)) if (RUN_ID.test(d)) ids.add(d);
    } catch {
      /* no workflows */
    }
  }
  try {
    for (const f of fs.readdirSync(workflowRecordsDir(folder))) {
      const id = /^(wf_[A-Za-z0-9_-]{1,64})\.json$/.exec(f)?.[1];
      if (id) ids.add(id);
    }
  } catch {
    /* no records */
  }
  return [...ids].sort();
}

function scriptOf(folder: string, runId: string): string {
  const dir = path.join(workflowRecordsDir(folder), "scripts");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return "";
  }
  const name = names.find((n) => n.endsWith(`-${runId}.js`) || n === `${runId}.js`);
  return name ? (readConfined(folder, path.join(dir, name), SCRIPT_BYTES)?.text ?? "") : "";
}

interface JournalCall {
  key: string;
  agentId: string;
  label?: string;
  phase?: string;
  attempts: number;
  result?: unknown;
  hasResult: boolean;
  error?: string;
}

/** A journal's calls by key, in first-start order; a resumed call keeps its key and counts an attempt. Pure. */
export function journalCalls(text: string): { calls: JournalCall[]; launches: number } {
  const byKey = new Map<string, JournalCall>();
  let launches = 0;
  for (const e of jsonLines(text)) {
    const type = str(e.type);
    if (type === "launched") {
      launches++;
      continue;
    }
    const key = str(e.key) || str(e.agentId);
    if (!key) continue;
    const c = byKey.get(key) ?? { key, agentId: str(e.agentId), attempts: 0, hasResult: false };
    if (type === "started") {
      c.attempts++;
      if (str(e.agentId)) c.agentId = str(e.agentId);
      if (str(e.label)) c.label = str(e.label);
      if (str(e.phase)) c.phase = str(e.phase);
    } else if (type === "result") {
      c.hasResult = true;
      c.result = e.result;
      if (str(e.agentId)) c.agentId = str(e.agentId);
    } else if (/error|fail/i.test(type)) {
      c.error = str(e.error) || str(e.message) || type;
    }
    byKey.set(key, c);
  }
  return { calls: [...byKey.values()], launches };
}

/** The arguments of each Workflow call in a parent transcript text, by the run id its input or result names. Pure. */
export function workflowArgs(text: string): Map<string, unknown> {
  const byUse = new Map<string, { runId?: string; args?: unknown }>();
  const out = new Map<string, unknown>();
  for (const e of jsonLines(text)) {
    for (const b of arr(obj(e.message).content).map(obj)) {
      if (b.type === "tool_use" && str(b.name) === "Workflow" && str(b.id)) {
        const input = obj(b.input);
        let args: unknown = input.args;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            /* keep the string */
          }
        }
        const named = str(input.resumeFromRunId) || /wf_[A-Za-z0-9_-]{1,64}/.exec(str(input.scriptPath))?.[0];
        byUse.set(str(b.id), { runId: named, args });
        if (named && args !== undefined) out.set(named, args);
      } else if (b.type === "tool_result") {
        const use = byUse.get(str(b.tool_use_id));
        if (!use || use.runId || use.args === undefined) continue;
        const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        const id = /wf_[A-Za-z0-9_-]{1,64}/.exec(text)?.[0];
        if (id) out.set(id, use.args);
      }
    }
  }
  return out;
}

/**
 * One run, read from the session folder. `parentLive`: the session still runs,
 * so a call without a result is running, not stopped. `deep`: also read each
 * running agent's current tool and the run's arguments (the detail view); the
 * summary the session list polls leaves both out.
 */
export function readWorkflowRun(transcript: string, runId: string, parentLive: boolean, deep = true): WorkflowRun | null {
  const folder = sessionFolder(transcript);
  if (!folder || !RUN_ID.test(runId)) return null;
  const agentsDir = path.join(workflowAgentsDir(folder), runId);
  const record = parseJson(readConfined(folder, path.join(workflowRecordsDir(folder), `${runId}.json`), RECORD_BYTES)?.text ?? "");
  const journalRead = readConfined(folder, path.join(agentsDir, "journal.jsonl"), JOURNAL_BYTES);
  const { calls, launches } = journalCalls(journalRead?.text ?? "");
  const meta = scriptMeta(str(record.script) || scriptOf(folder, runId));
  const recordStatus = str(record.status);
  const ended = recordStatus === "completed" || recordStatus === "failed";
  const status: WorkflowStatus = recordStatus === "completed" ? "completed" : recordStatus === "failed" ? "failed" : parentLive ? "running" : "stopped";
  const progress = new Map<string, Json>();
  for (const p of arr(record.workflowProgress).map(obj)) if (p.type === "workflow_agent" && str(p.agentId)) progress.set(str(p.agentId), p);

  const agents: WorkflowAgent[] = [];
  for (const c of calls) {
    if (!AGENT_ID.test(c.agentId)) continue;
    const file = readConfined(folder, path.join(agentsDir, `agent-${c.agentId}.jsonl`), 0);
    const m = parseJson((readConfined(folder, path.join(agentsDir, `agent-${c.agentId}.meta.json`), META_BYTES)?.text ?? "").replace(/\n/g, " "));
    const p = progress.get(c.agentId) ?? {};
    const state: WorkflowAgentState = c.error ? "failed" : c.hasResult || str(p.state) === "done" ? "done" : str(p.state) === "failed" ? "failed" : ended || !parentLive ? "stopped" : "running";
    const a: WorkflowAgent = { agentId: c.agentId, label: c.label || str(m.description) || str(p.label) || c.agentId, state, attempts: Math.max(1, c.attempts) };
    const phase = c.phase || str(m.workflowPhase) || str(p.phaseTitle);
    if (phase) a.phase = phase;
    const started = num(p.startedAt) ?? file?.birthtimeMs;
    if (iso(started)) a.startedAt = iso(started);
    if (state !== "running" && file && iso(file.mtimeMs)) a.endedAt = iso(file.mtimeMs);
    if (str(m.model) || str(p.model)) a.model = str(m.model) || str(p.model);
    const tokens = num(p.tokens) ?? num(p.totalTokens);
    if (tokens !== undefined) a.tokens = tokens;
    if (c.hasResult) a.result = boundResult(c.result);
    if (c.error) a.error = c.error.slice(0, 300);
    if (deep && state === "running") {
      const doing = openTool(readConfined(folder, path.join(agentsDir, `agent-${c.agentId}.jsonl`), SUBAGENT_TAIL_BYTES)?.text ?? "");
      if (doing) a.doing = doing;
    }
    agents.push(a);
  }

  if (!agents.length && !Object.keys(record).length && !journalRead) return null;
  const run: WorkflowRun = {
    runId,
    name: str(record.workflowName) || meta.name || runId,
    status,
    phases: arr(record.phases).map((p) => str(obj(p).title)).filter(Boolean).length ? arr(record.phases).map((p) => str(obj(p).title)).filter(Boolean) : meta.phases,
    agents,
    resumed: launches > 1 || agents.some((a) => a.attempts > 1),
  };
  const description = str(record.summary) || meta.description;
  if (description) run.description = description;
  const startedAt = iso(num(record.startTime)) ?? iso(journalRead?.birthtimeMs);
  if (startedAt) run.startedAt = startedAt;
  if (num(record.durationMs) !== undefined) run.durationMs = num(record.durationMs);
  if (num(record.totalTokens) !== undefined) run.totalTokens = num(record.totalTokens);
  if (deep) {
    const args = workflowArgs(readTail(transcript, PARENT_BYTES)).get(runId);
    if (args !== undefined) run.args = boundResult(args);
  }
  return run;
}

/** Every run of a session, oldest first. */
export function readWorkflows(transcript: string, parentLive: boolean, deep = true): WorkflowRun[] {
  const folder = sessionFolder(transcript);
  if (!folder) return [];
  return workflowRunIds(folder)
    .map((id) => readWorkflowRun(transcript, id, parentLive, deep))
    .filter((r): r is WorkflowRun => r !== null)
    .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

/** The compact form of a run. Pure. */
export function summarize(run: WorkflowRun): WorkflowSummary {
  const running = run.agents.filter((a) => a.state === "running");
  const phase = running.length ? running[running.length - 1].phase : run.phases[run.phases.length - 1];
  const s: WorkflowSummary = {
    runId: run.runId,
    name: run.name,
    status: run.status,
    done: run.agents.filter((a) => a.state === "done").length,
    failed: run.agents.filter((a) => a.state === "failed").length,
    total: run.agents.length,
  };
  if (phase) s.phase = phase;
  if (run.startedAt) s.startedAt = run.startedAt;
  return s;
}

/** A workflow agent's transcript, when `agentId` is one of the session's workflow agents; null otherwise. */
export function workflowAgentTranscript(transcript: string, agentId: string): string | null {
  const folder = sessionFolder(transcript);
  if (!folder || !AGENT_ID.test(agentId)) return null;
  for (const runId of workflowRunIds(folder)) {
    const file = path.join(workflowAgentsDir(folder), runId, `agent-${agentId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}
