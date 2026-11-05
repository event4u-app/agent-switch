/** Settings › Claude Code: what `agent-switch claude-settings status --json`
 *  returns, and how the page groups it. One file (~/.claude/settings.json)
 *  applies to every Claude account; the CLI does the merge. Pure. */

import type { TKey } from "./i18n/index.js";

export type ProfileState = "in-sync" | "pending" | "linked" | "invalid";

export interface ClaudeSettingsStatus {
  file: string;
  exists: boolean;
  valid: boolean;
  settings: Record<string, unknown>;
  withheld: string[];
  profiles: { name: string; state: ProfileState; extras: string[] }[];
}

const STATES = new Set<ProfileState>(["in-sync", "pending", "linked", "invalid"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseClaudeSettings(raw: unknown): ClaudeSettingsStatus {
  const o = isObj(raw) ? raw : {};
  const profiles = Array.isArray(o.profiles) ? o.profiles : [];
  return {
    file: typeof o.file === "string" ? o.file : "",
    exists: o.exists === true,
    valid: o.valid !== false,
    settings: isObj(o.settings) ? o.settings : {},
    withheld: strings(o.withheld),
    profiles: profiles.filter(isObj).map((p) => ({
      name: String(p.name ?? ""),
      state: STATES.has(p.state as ProfileState) ? (p.state as ProfileState) : "invalid",
      extras: strings(p.extras),
    })),
  };
}

/** Environment switches Claude Code reads; "on" means the variable is "1". */
export const ENV_FLAGS: { name: string; title: TKey; detail: TKey }[] = [
  { name: "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", title: "settings.claude.env.survey", detail: "settings.claude.env.surveyDetail" },
  { name: "DISABLE_AUTOUPDATER", title: "settings.claude.env.autoupdater", detail: "settings.claude.env.autoupdaterDetail" },
  { name: "DISABLE_TELEMETRY", title: "settings.claude.env.telemetry", detail: "settings.claude.env.telemetryDetail" },
  { name: "DISABLE_ERROR_REPORTING", title: "settings.claude.env.errors", detail: "settings.claude.env.errorsDetail" },
  { name: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", title: "settings.claude.env.traffic", detail: "settings.claude.env.trafficDetail" },
  { name: "DISABLE_COST_WARNINGS", title: "settings.claude.env.cost", detail: "settings.claude.env.costDetail" },
  { name: "CLAUDE_CODE_DISABLE_TERMINAL_TITLE", title: "settings.claude.env.title", detail: "settings.claude.env.titleDetail" },
];

export const MODES = ["default", "acceptEdits", "plan", "auto"] as const;
export const MODELS = ["opus", "sonnet", "haiku", "opusplan"] as const;

/** Allow rules people commonly turn on, grouped. Exact strings: the file holds them verbatim. */
export const RULE_GROUPS: { id: string; title: TKey; rules: string[] }[] = [
  {
    id: "read",
    title: "settings.claude.rules.read",
    rules: ["Read(**)", "Bash(cat *)", "Bash(ls *)", "Bash(find *)", "Bash(grep *)", "Bash(rg *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(sort *)", "Bash(uniq *)", "Bash(tree *)", "Bash(file *)", "Bash(stat *)", "Bash(jq *)", "Bash(yq *)", "Bash(awk *)"],
  },
  {
    id: "system",
    title: "settings.claude.rules.system",
    rules: ["Bash(echo *)", "Bash(pwd)", "Bash(which *)", "Bash(date *)", "Bash(whoami)", "Bash(uname *)", "Bash(env)", "Bash(printenv *)", "Bash(ps *)", "Bash(df *)", "Bash(du *)"],
  },
  { id: "git", title: "settings.claude.rules.git", rules: ["Bash(git *)"] },
  {
    id: "github",
    title: "settings.claude.rules.github",
    rules: ["Bash(gh pr view*)", "Bash(gh pr list*)", "Bash(gh pr diff*)", "Bash(gh pr checks*)", "Bash(gh pr status*)", "Bash(gh pr create*)", "Bash(gh pr comment*)", "Bash(gh issue view*)", "Bash(gh issue list*)", "Bash(gh issue create*)", "Bash(gh issue comment*)", "Bash(gh repo view*)", "Bash(gh run view*)", "Bash(gh run list*)", "Bash(gh run watch*)", "Bash(gh auth status*)", "Bash(gh api *)"],
  },
  { id: "js", title: "settings.claude.rules.js", rules: ["Bash(npm *)", "Bash(npx *)", "Bash(node *)", "Bash(pnpm *)", "Bash(yarn *)"] },
  { id: "php", title: "settings.claude.rules.php", rules: ["Bash(composer *)", "Bash(php artisan *)", "Bash(phpstan *)", "Bash(rector *)", "Bash(ecs *)"] },
  { id: "tools", title: "settings.claude.rules.tools", rules: ["Bash(task *)", "Bash(agent-config *)", "Bash(./agent-config *)", "Bash(codex *)", "Bash(rtk *)"] },
];

export interface RuleGroupView {
  id: string;
  title: TKey;
  rules: { rule: string; on: boolean }[];
  on: number;
}

/** The catalog groups with their state, then "other" for rules the file has beyond the catalog. Pure. */
export function ruleGroups(allow: string[]): RuleGroupView[] {
  const have = new Set(allow);
  const known = new Set(RULE_GROUPS.flatMap((g) => g.rules));
  const groups: RuleGroupView[] = RULE_GROUPS.map((g) => {
    const rules = g.rules.map((rule) => ({ rule, on: have.has(rule) }));
    return { id: g.id, title: g.title, rules, on: rules.filter((r) => r.on).length };
  });
  const other = allow.filter((r) => !known.has(r)).map((rule) => ({ rule, on: true }));
  if (other.length) groups.push({ id: "other", title: "settings.claude.rules.other", rules: other, on: other.length });
  return groups;
}

/** Rules that change when a whole group is switched to `on`. Pure. */
export function groupToggle(g: RuleGroupView, on: boolean): string[] {
  return g.rules.filter((r) => r.on !== on).map((r) => r.rule);
}

/** A rule worth sending: `Tool` or `Tool(spec)`, no line breaks. Pure. */
export function validRule(s: string): boolean {
  return /^[A-Za-z][\w.-]*(\(.+\))?$/.test(s.trim()) && !/[\r\n]/.test(s);
}

/** Keys the page shows as controls; everything else is listed as "more in the file". */
const MANAGED = new Set(["env", "permissions", "model", "enabledPlugins", "hooks"]);

export function readEnv(s: Record<string, unknown>): Record<string, string> {
  const env = isObj(s.env) ? s.env : {};
  return Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
}

export function readPermissions(s: Record<string, unknown>): { allow: string[]; deny: string[]; ask: string[]; defaultMode: string | null } {
  const p = isObj(s.permissions) ? s.permissions : {};
  return { allow: strings(p.allow), deny: strings(p.deny), ask: strings(p.ask), defaultMode: typeof p.defaultMode === "string" ? p.defaultMode : null };
}

export function readPlugins(s: Record<string, unknown>): { id: string; on: boolean }[] {
  const p = isObj(s.enabledPlugins) ? s.enabledPlugins : {};
  return Object.entries(p).map(([id, v]) => ({ id, on: v === true }));
}

/** Hook events with the number of commands each runs. Pure. */
export function hookSummary(s: Record<string, unknown>): { event: string; commands: number }[] {
  const h = isObj(s.hooks) ? s.hooks : {};
  return Object.entries(h).map(([event, groups]) => ({
    event,
    commands: (Array.isArray(groups) ? groups : []).reduce((n: number, g) => n + (isObj(g) && Array.isArray(g.hooks) ? g.hooks.length : 0), 0),
  }));
}

/** The file's other top-level values, compact, for the read-only list. Pure. */
export function otherValues(s: Record<string, unknown>): { key: string; preview: string }[] {
  return Object.entries(s)
    .filter(([k]) => !MANAGED.has(k))
    .map(([key, v]) => {
      const text = JSON.stringify(v) ?? "";
      return { key, preview: text.length > 80 ? `${text.slice(0, 79)}…` : text };
    });
}
