/**
 * A session's children for `sessions --json` and `sessions --tree`
 * (road-to-agent-switch-v3-central Phase 2; ADR-007; docs/lineage-contract.md).
 *
 * Three kinds of child, each saying where it came from:
 *   - subagents, from SubagentStart/Stop hooks (`source: "hook"`);
 *   - helper sessions that named their parent through the lineage env vars
 *     (`source: "lineage"`) or were started inside an AS-hosted window
 *     (`source: "host"`);
 *   - for a profile without subagent hooks, only a count of the subagent
 *     transcript files next to the session (`source: "counted"`; counted by
 *     name only).
 * No parent is ever inferred from timing, folders or names.
 *
 * A hook-reported subagent also says what it was asked to do and which tool it
 * runs now (`subagentFacts`). That reads subagent files, which this module
 * used to refuse: a row that only says "general-purpose" three times cannot be
 * followed (arena r1, 04-subagents F1/F2). The reads stay narrow — a plain
 * agent id only, a bounded tail of each file, the first line of a description,
 * never the prompt or an answer.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { childrenOf, type HookEventRecord, type Lineage } from "./hooks.js";
import { toolSummary } from "./timeline/events.js";
import type { RuntimeState } from "./runtime-state.js";

export type Child =
  | { kind: "subagent"; agentId: string; type?: string; state: "running" | "done"; cwd?: string; source: "hook"; startedAt?: string; endedAt?: string } & SubagentFacts
  | { kind: Lineage["kind"]; sessionKey: string; label?: string; state: "running" | "done"; source: Lineage["source"]; runtime?: RuntimeState };

export interface HelperIndex {
  /** parent key or bare parent id → the helper sessions that named it. */
  byParent: Map<string, Extract<Child, { sessionKey: string }>[]>;
  /** child session key → its parent, as the child reported it. */
  parentOf: Map<string, string>;
}

/** Every helper session that named a parent, across accounts. Pure. */
export function helperIndex(provider: string, eventsByAccount: ReadonlyMap<string, readonly HookEventRecord[]>): HelperIndex {
  const byParent = new Map<string, Extract<Child, { sessionKey: string }>[]>();
  const parentOf = new Map<string, string>();
  for (const [account, events] of eventsByAccount) {
    const ended = new Set(events.filter((e) => e.event === "SessionEnd" && e.sessionId).map((e) => e.sessionId!));
    for (const e of events) {
      if (e.event !== "SessionStart" || !e.sessionId || !e.lineage) continue;
      const sessionKey = `${provider}/${account}/${e.sessionId}`;
      const child = { kind: e.lineage.kind, sessionKey, ...(e.lineage.label ? { label: e.lineage.label } : {}), state: ended.has(e.sessionId) ? ("done" as const) : ("running" as const), source: e.lineage.source };
      const list = byParent.get(e.lineage.parent) ?? [];
      if (!list.some((c) => c.sessionKey === sessionKey)) list.push(child);
      byParent.set(e.lineage.parent, list);
      parentOf.set(sessionKey, e.lineage.parent);
    }
  }
  return { byParent, parentOf };
}

/** One session's children with hooks: its subagents and the helpers that named it. Pure. */
export function childrenWithHooks(key: string, events: readonly HookEventRecord[], helpers: HelperIndex): Child[] {
  const sessionId = key.split("/").pop()!;
  const subagents: Child[] = childrenOf(events, sessionId).map((c) => ({ kind: "subagent", ...c, source: "hook" }));
  const named = [...(helpers.byParent.get(key) ?? []), ...(helpers.byParent.get(sessionId) ?? [])];
  return [...subagents, ...named];
}

/** What a subagent was asked to do and, while it runs, the tool it is in. */
export interface SubagentFacts {
  /** The first line of the Task call's `description`. */
  description?: string;
  /** "Bash · npm test": its last tool call without a result yet. */
  doing?: string;
}

/** What Claude Code names a subagent file after. Anything else reads nothing, so an id can never leave the folder. */
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The tail of a subagent transcript read for its current tool. */
export const SUBAGENT_TAIL_BYTES = 256 * 1024;
/** The tail of the parent transcript searched for Task calls, read only when a meta file does not name the task. */
export const PARENT_TAIL_BYTES = 2 * 1024 * 1024;
const META_BYTES = 16 * 1024;
const DESCRIPTION_MAX = 120;

/** `<projects>/<dir>/<sessionId>/subagents` for the session transcript `<projects>/<dir>/<sessionId>.jsonl`. Pure. */
export const subagentDir = (transcript: string): string => path.join(path.dirname(transcript), path.basename(transcript, ".jsonl"), "subagents");

/** One subagent's transcript, or null when the id is not a plain agent id. Pure. */
export function subagentTranscript(transcript: string, agentId: string): string | null {
  return AGENT_ID.test(agentId) ? path.join(subagentDir(transcript), `agent-${agentId}.jsonl`) : null;
}

/** The last `maxBytes` of a file from the first whole line on; "" when it cannot be read. */
export function readTail(file: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    // One byte more than asked, so a cut that falls on a line start keeps that line.
    const start = Math.max(0, size - maxBytes - 1);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    if (start === 0) return text;
    const nl = text.indexOf("\n");
    return nl < 0 ? "" : text.slice(nl + 1);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const firstLine = (s: string) => s.split("\n")[0].trim().slice(0, DESCRIPTION_MAX);
const TASK_TOOLS = new Set(["Agent", "Task"]);

function jsonLines(text: string): Json[] {
  const out: Json[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(obj(JSON.parse(l)));
    } catch {
      /* a torn or foreign line */
    }
  }
  return out;
}

/** A parent transcript's Task calls: their description by tool-use id, and by the agent id a finished call's result names. Pure. */
export function taskDescriptions(text: string): { byToolUse: Map<string, string>; byAgent: Map<string, string> } {
  const byToolUse = new Map<string, string>();
  const byAgent = new Map<string, string>();
  for (const e of jsonLines(text)) {
    const blocks = arr(obj(e.message).content).map(obj);
    if (e.type === "assistant") {
      for (const b of blocks) if (b.type === "tool_use" && TASK_TOOLS.has(str(b.name)) && str(b.id)) byToolUse.set(str(b.id), firstLine(str(obj(b.input).description)));
    } else if (e.type === "user") {
      const agentId = str(obj(e.toolUseResult ?? e.tool_use_result).agentId);
      if (!agentId) continue;
      for (const b of blocks) {
        const d = b.type === "tool_result" ? byToolUse.get(str(b.tool_use_id)) : undefined;
        if (d) byAgent.set(agentId, d);
      }
    }
  }
  return { byToolUse, byAgent };
}

/** The last tool call in a transcript text that has no result yet, as "Name · summary". Pure. */
export function openTool(text: string): string | undefined {
  const open = new Map<string, string>();
  for (const e of jsonLines(text)) {
    for (const b of arr(obj(e.message).content).map(obj)) {
      if (b.type === "tool_use" && str(b.id)) {
        const name = str(b.name);
        const summary = firstLine(toolSummary(name, obj(b.input)));
        open.delete(str(b.id));
        open.set(str(b.id), summary ? `${name} · ${summary}` : name);
      } else if (b.type === "tool_result") open.delete(str(b.tool_use_id));
    }
  }
  return [...open.values()].pop();
}

/**
 * Description and current tool of a session's subagents. The description comes
 * from Claude Code's `agent-<id>.meta.json`; when that file does not carry it,
 * from the parent transcript's Task call — joined by the meta file's
 * `toolUseId`, or by the agent id the call's result names. Never by order or
 * time. The current tool is read for `running` ids only. Every read is bounded.
 */
export function subagentFacts(dir: string, parentTranscript: string, agentIds: readonly string[], running: ReadonlySet<string> = new Set(agentIds)): Map<string, SubagentFacts> {
  const out = new Map<string, SubagentFacts>();
  const pending: { id: string; toolUseId: string }[] = [];
  for (const id of agentIds) {
    if (!AGENT_ID.test(id)) continue;
    const meta = obj(jsonLines(readTail(path.join(dir, `agent-${id}.meta.json`), META_BYTES).replace(/\n/g, " "))[0]);
    const facts: SubagentFacts = {};
    const description = firstLine(str(meta.description));
    if (description) facts.description = description;
    else pending.push({ id, toolUseId: str(meta.toolUseId) });
    if (running.has(id)) {
      const doing = openTool(readTail(path.join(dir, `agent-${id}.jsonl`), SUBAGENT_TAIL_BYTES));
      if (doing) facts.doing = doing;
    }
    if (Object.keys(facts).length) out.set(id, facts);
  }
  if (pending.length) {
    const tasks = taskDescriptions(readTail(parentTranscript, PARENT_TAIL_BYTES));
    for (const { id, toolUseId } of pending) {
      const d = (toolUseId && tasks.byToolUse.get(toolUseId)) || tasks.byAgent.get(id);
      if (d) out.set(id, { description: d, ...out.get(id) });
    }
  }
  return out;
}

/** Subagent transcripts next to a session, counted by name only. */
export function countSubagentFiles(configDir: string, projectDir: string, sessionId: string): number {
  try {
    return fs.readdirSync(path.join(configDir, "projects", projectDir, sessionId, "subagents")).filter((n) => /^agent-.+\.jsonl$/.test(n)).length;
  } catch {
    return 0;
  }
}

/** `childSource`: where the children came from, in one word or a `+` list. */
export function childSource(children: readonly Child[]): string | null {
  const s = [...new Set(children.map((c) => c.source))].sort();
  return s.length ? s.join("+") : null;
}

export interface TreeNode<T> {
  row: T;
  children: TreeNode<T>[];
}

/**
 * Nest rows under the parent a row reported, when that parent is in the list;
 * a row whose parent is not listed stays a root and keeps `parent` so the UI can
 * say "started by …". Cycles cannot form: a row is nested at most once and a
 * row never becomes its own ancestor. Pure.
 */
export function buildTree<T>(rows: readonly T[], keyOf: (r: T) => string, parentOf: (r: T) => string | undefined): TreeNode<T>[] {
  const byKey = new Map(rows.map((r) => [keyOf(r), { row: r, children: [] as TreeNode<T>[] }]));
  const byId = new Map(rows.map((r) => [keyOf(r).split("/").pop()!, keyOf(r)]));
  const roots: TreeNode<T>[] = [];
  const ancestorOf = (k: string, maybe: string): boolean => {
    for (let cur: string | undefined = maybe, n = 0; cur && n < rows.length; n++) {
      if (cur === k) return true;
      const p = parentOf(byKey.get(cur)!.row);
      cur = p ? (byKey.has(p) ? p : byId.get(p)) : undefined;
    }
    return false;
  };
  for (const r of rows) {
    const k = keyOf(r);
    const p = parentOf(r);
    const parentKey = p ? (byKey.has(p) ? p : byId.get(p)) : undefined;
    if (parentKey && parentKey !== k && !ancestorOf(k, parentKey)) byKey.get(parentKey)!.children.push(byKey.get(k)!);
    else roots.push(byKey.get(k)!);
  }
  return roots;
}

/**
 * A session nobody claims and that ran in a temp folder looks like a helper
 * (a council seat, a script's `claude -p`) — but looking like one proves no
 * parent. It is marked "relation unknown", never attached anywhere. Pure.
 */
export function relationUnknown(cwd: string | null, hasParent: boolean, tempRoots: readonly string[]): boolean {
  if (hasParent || !cwd) return false;
  return tempRoots.some((t) => cwd === t || cwd.startsWith(t.endsWith("/") ? t : t + "/"));
}
