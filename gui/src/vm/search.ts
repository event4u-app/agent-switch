/**
 * ⌘K index over the loaded view model (bundle `tP` / `rP`, app L170–192).
 * Client-side only; no backend call.
 */

import { shortPath } from "../ui/format.js";
import { TOOL_LABEL } from "./rules.js";
import type { Screen } from "./store.js";
import type { Account, Binding, Session, ToolEntry } from "./types.js";

export type SearchKind = "action" | "account" | "session" | "project" | "rule" | "tool" | "page";

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  action: "Actions",
  account: "Accounts",
  session: "Sessions",
  project: "Projects",
  rule: "Bindings",
  tool: "Tools",
  page: "Pages",
};

export type SearchTarget =
  | { type: "screen"; screen: Screen }
  | { type: "account"; id: string }
  | { type: "session"; id: string }
  | { type: "start"; cwd?: string }
  | { type: "tools" }
  | { type: "projects" }
  | { type: "add-account" };

export interface SearchItem {
  id: string;
  kind: SearchKind;
  text: string;
  meta: string;
  kids?: SearchItem[];
  target: SearchTarget;
}

const PAGES: [Screen, string, string][] = [
  ["home", "Home", "What needs you, what runs, what's left"],
  ["sessions", "Sessions", "All running and recent sessions"],
  ["accounts", "Accounts", "Sign-ins, capacity, protection, project bindings"],
  ["tools", "Tools", "agent-config, rtk, agent CLIs, updates, apps"],
  ["activity", "Activity", "What happened and why"],
  ["health", "Health", "Readiness, checks, repairs"],
  ["settings", "Settings", "Start at login, protection, notifications, pet, updates"],
];

export function buildSearchIndex(vm: {
  accounts: Account[];
  sessions: Session[];
  rules: Binding[];
  tools: ToolEntry[];
}): SearchItem[] {
  const sessionItem = (s: Session): SearchItem => {
    const account = vm.accounts.find((a) => a.id === s.accountId);
    return {
      id: `s:${s.id}`,
      kind: "session",
      text: `${s.project} · ${s.title}`,
      meta: `${TOOL_LABEL[s.tool]} · ${account?.name ?? "?"} · ${s.state}`,
      target: { type: "session", id: s.id },
    };
  };
  const accounts = vm.accounts.map((a): SearchItem => {
    const kids = vm.sessions.filter((s) => s.accountId === a.id).map(sessionItem);
    return {
      id: `a:${a.id}`,
      kind: "account",
      text: `${TOOL_LABEL[a.tool]} · ${a.name}`,
      meta: [a.identity ?? "not signed in", a.plan, a.label].filter(Boolean).join(" · "),
      kids: kids.length ? kids : undefined,
      target: { type: "account", id: a.id },
    };
  });
  const projects = new Map<string, SearchItem & { kids: SearchItem[] }>();
  for (const s of vm.sessions) {
    const existing = projects.get(s.cwd);
    const item = sessionItem(s);
    if (existing) existing.kids.push(item);
    else
      projects.set(s.cwd, {
        id: `p:${s.cwd}`,
        kind: "project",
        text: s.project,
        meta: shortPath(s.cwd),
        kids: [item],
        target: { type: "start", cwd: s.cwd },
      });
  }
  const rules = vm.rules.map(
    (r): SearchItem => ({
      id: `r:${r.id}`,
      kind: "rule",
      text: r.match.value,
      meta: `${r.match.kind} → ${r.target.kind === "pool" ? `pool ${r.target.pool}` : r.target.accountId}${r.enabled ? "" : " · off"}`,
      target: { type: "projects" },
    }),
  );
  const actions: SearchItem[] = [
    { id: "x:start", kind: "action", text: "Start session", meta: "Pick a folder, tool and account", target: { type: "start" } },
    { id: "x:add", kind: "action", text: "Add account", meta: "Sign in with Claude, Codex or Gemini", target: { type: "add-account" } },
  ];
  const pages = PAGES.map(
    ([screen, text, meta]): SearchItem => ({ id: `g:${screen}`, kind: "page", text, meta, target: { type: "screen", screen } }),
  );
  const tools = vm.tools.map(
    (t): SearchItem => ({
      id: `t:${t.id}`,
      kind: "tool",
      text: t.name,
      meta: [t.version ?? "not installed", t.latest && t.latest !== t.version ? `update ${t.latest}` : null, t.role]
        .filter(Boolean)
        .join(" · "),
      target: { type: "tools" },
    }),
  );
  return [...actions, ...accounts, ...vm.sessions.map(sessionItem), ...projects.values(), ...rules, ...tools, ...pages];
}

export const SEARCH_LIMIT = 12;

export interface SearchCrumb {
  crumb: string;
  kids: SearchItem[];
  q: string;
  kind: SearchKind | "all";
  index: number;
}

export interface SearchResult {
  all: SearchItem[];
  shown: SearchItem[];
  counts: Partial<Record<SearchKind, number>>;
  order: SearchKind[];
  kind: SearchKind | "all";
}

/** Top level needs ≥2 characters; inside a drill-in every child shows. */
export function filterSearch(index: SearchItem[], trail: SearchCrumb[], query: string, kind: SearchKind | "all"): SearchResult {
  const parent = trail[trail.length - 1];
  const q = query.trim().toLowerCase();
  if (!parent && q.length < 2) return { all: [], shown: [], counts: {}, order: [], kind: "all" };
  const all = (parent ? parent.kids : index).filter((m) => !q || `${m.text} ${m.meta}`.toLowerCase().includes(q));
  const counts: Partial<Record<SearchKind, number>> = {};
  const order: SearchKind[] = [];
  for (const m of all) {
    if (!counts[m.kind]) {
      counts[m.kind] = 0;
      order.push(m.kind);
    }
    counts[m.kind]! += 1;
  }
  const effective = kind !== "all" && !counts[kind] ? "all" : kind;
  const shown = all.filter((m) => effective === "all" || m.kind === effective).slice(0, SEARCH_LIMIT);
  return { all, shown, counts, order, kind: effective };
}
