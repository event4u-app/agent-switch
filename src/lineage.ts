/**
 * A session's children for `sessions --json` and `sessions --tree`
 * (road-to-agent-switch-v3-central Phase 2; ADR-007; docs/lineage-contract.md).
 *
 * Three kinds of child, each saying where it came from:
 *   - subagents, from SubagentStart/Stop hooks (`source: "hook"`), else from
 *     Claude Code's own files under the session's `<sessionId>/subagents/`
 *     folder (`source: "files"`: `agent-<id>.meta.json` and `agent-<id>.jsonl`);
 *   - helper sessions that named their parent through the lineage env vars
 *     (`source: "lineage"`) or were started inside an AS-hosted window
 *     (`source: "host"`);
 *   - a subagent file that cannot be read safely (a link out of the session
 *     folder, not a regular file, a name that is not a plain agent id) is only
 *     counted (`source: "counted"`).
 * No parent is ever inferred from timing, order or names: a file under a
 * session's own folder belongs to that session.
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
  | SubagentChild
  | { kind: Lineage["kind"]; sessionKey: string; label?: string; state: "running" | "done"; source: Lineage["source"]; runtime?: RuntimeState };

/** A subagent, from its hooks or from Claude Code's files next to its session. `toolUseId`: the parent's Task call that started it. */
export type SubagentChild = { kind: "subagent"; agentId: string; type?: string; state: "running" | "done"; cwd?: string; source: "hook" | "files"; startedAt?: string; endedAt?: string; toolUseId?: string } & SubagentFacts;

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

/** The last `maxBytes` of an open file of `size` bytes, from the first whole line on. */
function tailOf(fd: number, size: number, maxBytes: number): string {
  // One byte more than asked, so a cut that falls on a line start keeps that line.
  const start = Math.max(0, size - maxBytes - 1);
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  const text = buf.toString("utf8");
  if (start === 0) return text;
  const nl = text.indexOf("\n");
  return nl < 0 ? "" : text.slice(nl + 1);
}

/** The last `maxBytes` of a file from the first whole line on; "" when it cannot be read. */
export function readTail(file: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    return tailOf(fd, fs.fstatSync(fd).size, maxBytes);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * The folder every subagent read stays in: `<projects>/<dir>/<sessionId>` with
 * the project folder's links resolved. Null when that folder cannot be resolved.
 */
export function sessionFolder(transcript: string): string | null {
  try {
    return path.join(fs.realpathSync(path.dirname(transcript)), path.basename(transcript, ".jsonl"));
  } catch {
    return null;
  }
}

/** What a confined read returns: the tail asked for and the file's facts. */
export interface ConfinedRead {
  text: string;
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
}

const O_READ = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

/**
 * The opened file is the one `real` names now, with no link on the way from
 * `folder`: O_NOFOLLOW guards only the last component, so a directory swapped
 * for a link between the check and the open is caught here, after the open.
 */
function samePath(folder: string, real: string, opened: fs.Stats): boolean {
  let at = folder;
  let st = fs.lstatSync(at);
  if (!st.isDirectory()) return false;
  for (const part of path.relative(folder, real).split(path.sep)) {
    at = path.join(at, part);
    st = fs.lstatSync(at);
    if (st.isSymbolicLink()) return false;
  }
  return st.isFile() && st.dev === opened.dev && st.ino === opened.ino;
}

/**
 * The last `maxBytes` of `file` (0: its facts only), and only when it is a
 * regular file inside `folder` once every link is followed; null otherwise. A
 * link out of the session folder, a FIFO, a device or a folder reads nothing —
 * a FIFO is never even opened, so a read cannot hang on one.
 */
export function readConfined(folder: string, file: string, maxBytes: number): ConfinedRead | null {
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return null;
  }
  if (!real.startsWith(folder + path.sep)) return null;
  let fd: number | undefined;
  try {
    if (!fs.statSync(real).isFile()) return null;
    fd = fs.openSync(real, O_READ);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || !samePath(folder, real, st)) return null;
    return { text: maxBytes > 0 ? tailOf(fd, st.size, maxBytes) : "", size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs };
  } catch {
    return null;
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
 * time. The current tool is read for `running` ids only. Every read is bounded
 * and confined to the session's folder (`readConfined`).
 */
export function subagentFacts(parentTranscript: string, agentIds: readonly string[], running: ReadonlySet<string> = new Set(agentIds)): Map<string, SubagentFacts> {
  const out = new Map<string, SubagentFacts>();
  const folder = sessionFolder(parentTranscript);
  if (!folder) return out;
  const dir = subagentDir(parentTranscript);
  const pending: { id: string; toolUseId: string }[] = [];
  for (const id of agentIds) {
    if (!AGENT_ID.test(id)) continue;
    const meta = readMeta(folder, dir, id);
    const facts: SubagentFacts = {};
    const description = firstLine(str(meta.description));
    if (description) facts.description = description;
    else pending.push({ id, toolUseId: str(meta.toolUseId) });
    if (running.has(id)) {
      const doing = openTool(readConfined(folder, path.join(dir, `agent-${id}.jsonl`), SUBAGENT_TAIL_BYTES)?.text ?? "");
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

/** A subagent's `agent-<id>.meta.json`, as Claude Code wrote it; {} when it is missing or cannot be read safely. */
function readMeta(folder: string, dir: string, id: string): Json {
  return obj(jsonLines((readConfined(folder, path.join(dir, `agent-${id}.meta.json`), META_BYTES)?.text ?? "").replace(/\n/g, " "))[0]);
}

const iso = (ms: number): string | undefined => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined);

/**
 * A session's subagents from Claude Code's own files, for a profile whose
 * hooks did not report them (`skip`: the ids they did report). One child per
 * `agent-<id>.jsonl` under the session's folder, with what its meta file says:
 * type, task, its worktree, the Task call that started it, and `finished`.
 * A subagent runs inside its session, so one whose meta file does not say
 * `finished` runs while the session is live, and not otherwise. Times are the
 * transcript file's: created when the subagent started, last written when it
 * ended. A file that cannot be read safely is only counted (`unreadable`).
 * Never by order or time.
 */
export function subagentsFromFiles(transcript: string, parentLive: boolean, skip: ReadonlySet<string> = new Set()): { children: SubagentChild[]; unreadable: number } {
  const folder = sessionFolder(transcript);
  const dir = subagentDir(transcript);
  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return { children: [], unreadable: 0 };
  }
  const children: SubagentChild[] = [];
  let unreadable = 0;
  for (const name of names) {
    const id = /^agent-(.+)\.jsonl$/.exec(name)?.[1];
    if (id === undefined || skip.has(id)) continue;
    const file = folder && AGENT_ID.test(id) ? readConfined(folder, path.join(dir, name), 0) : null;
    if (!file || !folder) {
      unreadable++;
      continue;
    }
    const meta = readMeta(folder, dir, id);
    const state = meta.finished === true || !parentLive ? "done" : "running";
    const child: SubagentChild = { kind: "subagent", agentId: id, state, source: "files" };
    if (str(meta.agentType)) child.type = str(meta.agentType);
    if (str(meta.worktreePath)) child.cwd = str(meta.worktreePath);
    if (str(meta.toolUseId)) child.toolUseId = str(meta.toolUseId);
    const started = iso(file.birthtimeMs);
    if (started) child.startedAt = started;
    const ended = state === "done" ? iso(file.mtimeMs) : undefined;
    if (ended) child.endedAt = ended;
    children.push(child);
  }
  const running = new Set(children.filter((c) => c.state === "running").map((c) => c.agentId));
  const facts = subagentFacts(transcript, children.map((c) => c.agentId), running);
  return { children: children.map((c) => ({ ...c, ...facts.get(c.agentId) })), unreadable };
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
