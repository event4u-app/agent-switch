/**
 * ⌘K index over the loaded view model (bundle `tP` / `rP`, app L170–192).
 * Client-side only; no backend call.
 */

import { shortPath } from "../ui/format.js";
import { t, type TKey } from "../i18n/index.js";
import { TOOL_LABEL, translatedRecord } from "./rules.js";
import type { Screen } from "./store.js";
import type { Account, Binding, Session, ToolEntry } from "./types.js";

export type SearchKind = "action" | "account" | "session" | "project" | "rule" | "tool" | "page";

/** Kind → plural label in the live language (translated on read). */
export const SEARCH_KIND_LABEL: Readonly<Record<SearchKind, string>> = translatedRecord<SearchKind>({
  action: "vm.search.kind.action",
  account: "vm.search.kind.account",
  session: "vm.search.kind.session",
  project: "vm.search.kind.project",
  rule: "vm.search.kind.rule",
  tool: "vm.search.kind.tool",
  page: "vm.search.kind.page",
});

/** Kind → singular label in the live language (a result row's kind chip). */
export const SEARCH_KIND_SINGULAR: Readonly<Record<SearchKind, string>> = translatedRecord<SearchKind>({
  action: "vm.search.kindOne.action",
  account: "vm.search.kindOne.account",
  session: "vm.search.kindOne.session",
  project: "vm.search.kindOne.project",
  rule: "vm.search.kindOne.rule",
  tool: "vm.search.kindOne.tool",
  page: "vm.search.kindOne.page",
});

const MATCH_KIND_KEY: Record<Binding["match"]["kind"], TKey> = {
  folder: "vm.search.match.folder",
  repo: "vm.search.match.repo",
  org: "vm.search.match.org",
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

const PAGES: [Screen, TKey, TKey][] = [
  ["home", "vm.search.page.home", "vm.search.page.homeMeta"],
  ["sessions", "vm.search.page.sessions", "vm.search.page.sessionsMeta"],
  ["accounts", "vm.search.page.accounts", "vm.search.page.accountsMeta"],
  ["tools", "vm.search.page.tools", "vm.search.page.toolsMeta"],
  ["activity", "vm.search.page.activity", "vm.search.page.activityMeta"],
  ["health", "vm.search.page.health", "vm.search.page.healthMeta"],
  ["settings", "vm.search.page.settings", "vm.search.page.settingsMeta"],
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
      meta: [a.identity ?? t("vm.search.notSignedIn"), a.plan, a.label].filter(Boolean).join(" · "),
      kids: kids.length ? kids : undefined,
      target: { type: "account", id: a.id },
    };
  });
  const projects = new Map<string, SearchItem & { kids: SearchItem[] }>();
  for (const s of vm.sessions) {
    const cwd = s.cwd;
    if (!cwd) continue;
    const existing = projects.get(cwd);
    const item = sessionItem(s);
    if (existing) existing.kids.push(item);
    else
      projects.set(cwd, {
        id: `p:${cwd}`,
        kind: "project",
        text: s.project,
        meta: shortPath(cwd),
        kids: [item],
        target: { type: "start", cwd },
      });
  }
  const rules = vm.rules.map(
    (r): SearchItem => ({
      id: `r:${r.id}`,
      kind: "rule",
      text: r.match.value,
      meta: [
        `${t(MATCH_KIND_KEY[r.match.kind])} → ${r.target.kind === "pool" ? t("vm.search.pool", { pool: r.target.pool }) : r.target.accountId}`,
        ...(r.enabled ? [] : [t("vm.search.off")]),
      ].join(" · "),
      target: { type: "projects" },
    }),
  );
  const actions: SearchItem[] = [
    { id: "x:start", kind: "action", text: t("vm.search.startSession"), meta: t("vm.search.startSessionMeta"), target: { type: "start" } },
    { id: "x:add", kind: "action", text: t("vm.search.addAccount"), meta: t("vm.search.addAccountMeta"), target: { type: "add-account" } },
  ];
  const pages = PAGES.map(
    ([screen, text, meta]): SearchItem => ({ id: `g:${screen}`, kind: "page", text: t(text), meta: t(meta), target: { type: "screen", screen } }),
  );
  const tools = vm.tools.map(
    (tool): SearchItem => ({
      id: `t:${tool.id}`,
      kind: "tool",
      text: tool.name,
      meta: [tool.version ?? t("vm.search.notInstalled"), tool.latest && tool.latest !== tool.version ? t("vm.search.update", { version: tool.latest }) : null, tool.role]
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
