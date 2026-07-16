/**
 * Token + cost reporting (roadmap: road-to-agent-switch-session-telemetry,
 * Phase 5), DELEGATED to ccusage (council D2 — verified viable in spikes/t7).
 * agent-switch does NOT re-implement transcript aggregation, dedup, or a
 * pricing engine. It contributes two things ccusage cannot: (1) pointing
 * ccusage at a specific profile's config dir, and (2) the cost-honesty label —
 * agent-switch knows a profile is a subscription/OAuth login, so its cost is
 * "notional" (API-equivalent), not real spend.
 *
 * ccusage is an OPTIONAL external tool (the tmux/playwright pattern): detected
 * on PATH, never bundled. Absent → the caller prints an install pointer.
 */

import { spawnSync } from "node:child_process";

/** How a cost figure should be read (binding display rule, council #4). */
export type CostBasis = "vendor" | "computed" | "notional";

/** The command `tokens install` runs (in the GUI's embedded terminal or a
 *  user's shell) to install ccusage globally. Fixed literal — never bundled as
 *  a dependency (zero-dep invariant + council D2). */
export const CCUSAGE_INSTALL = ["npm", "install", "-g", "ccusage"] as const;

export interface TokenDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  models: string[];
}

export interface TokenReport {
  days: TokenDay[];
  totals: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalTokens: number; cost: number };
  costBasis: CostBasis;
}

/** Resolve the ccusage runner. A PATH binary is preferred; the
 *  `AGENT_SWITCH_CCUSAGE` env var overrides with an explicit argv prefix
 *  (e.g. "npx -y ccusage@latest") for a zero-install run or tests. Null when
 *  neither is available. */
export function resolveCcusageRunner(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const override = env.AGENT_SWITCH_CCUSAGE?.trim();
  if (override) return override.split(/\s+/);
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, ["ccusage"], { encoding: "utf8" });
  if (r.status === 0 && (r.stdout || "").trim()) return ["ccusage"];
  return null;
}

/** Parse ccusage `daily --json` output ({ daily: [...], totals: {...} }) into
 *  our shape. Pure + defensive: unknown/short shapes degrade to empty, never
 *  throw. `costBasis` is stamped by the caller (ccusage cannot know it). */
export function parseCcusageDaily(json: any, costBasis: CostBasis): TokenReport {
  const rows: any[] = Array.isArray(json?.daily) ? json.daily : Array.isArray(json) ? json : [];
  const num = (v: unknown) => (Number.isFinite(v) ? (v as number) : 0);
  const days: TokenDay[] = rows.map((r) => ({
    date: typeof r?.period === "string" ? r.period : typeof r?.date === "string" ? r.date : "?",
    inputTokens: num(r?.inputTokens),
    outputTokens: num(r?.outputTokens),
    cacheCreationTokens: num(r?.cacheCreationTokens),
    cacheReadTokens: num(r?.cacheReadTokens),
    totalTokens: num(r?.totalTokens),
    cost: num(r?.totalCost),
    models: Array.isArray(r?.modelsUsed) ? r.modelsUsed : [],
  }));
  const t = json?.totals ?? {};
  const totals = {
    inputTokens: num(t.inputTokens) || days.reduce((s, d) => s + d.inputTokens, 0),
    outputTokens: num(t.outputTokens) || days.reduce((s, d) => s + d.outputTokens, 0),
    cacheCreationTokens: num(t.cacheCreationTokens) || days.reduce((s, d) => s + d.cacheCreationTokens, 0),
    cacheReadTokens: num(t.cacheReadTokens) || days.reduce((s, d) => s + d.cacheReadTokens, 0),
    totalTokens: num(t.totalTokens) || days.reduce((s, d) => s + d.totalTokens, 0),
    cost: num(t.totalCost) || days.reduce((s, d) => s + d.cost, 0),
  };
  return { days, totals, costBasis };
}

/** The cost basis for a profile. agent-switch profiles are OAuth/subscription
 *  logins → their token cost is NOTIONAL (API-equivalent, not real spend). A
 *  raw API key credential (sk-ant-…) would be `computed`. */
export function costBasisFor(rawCredential: string | null): CostBasis {
  // A raw API key → real, computed spend. Anything else (OAuth login blob, or
  // unknown) → notional, the safe label that never overstates real spend.
  if (rawCredential && /^sk-(ant|proj)-/.test(rawCredential.trim())) return "computed";
  return "notional";
}

/** Run ccusage for one profile's config dir and return the parsed report, or
 *  null when ccusage failed / produced no JSON (caller degrades gracefully). */
export function runCcusage(
  runner: string[],
  provider: string,
  configDir: string,
  costBasis: CostBasis,
): TokenReport | null {
  const envKey = provider === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
  const [cmd, ...prefix] = runner;
  const r = spawnSync(cmd, [...prefix, "daily", "--json"], {
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, [envKey]: configDir },
  });
  const out = (r.stdout || "").trim();
  if (!out) return null;
  try {
    return parseCcusageDaily(JSON.parse(out), costBasis);
  } catch {
    return null;
  }
}
