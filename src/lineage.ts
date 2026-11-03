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
 *     transcript files next to the session (`source: "counted"`; their content
 *     is never read).
 * No parent is ever inferred from timing, folders or names.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { childrenOf, type HookEventRecord, type Lineage } from "./hooks.js";

export type Child =
  | { kind: "subagent"; agentId: string; type?: string; state: "running" | "done"; cwd?: string; source: "hook" }
  | { kind: Lineage["kind"]; sessionKey: string; label?: string; state: "running" | "done"; source: Lineage["source"] };

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
