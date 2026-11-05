/**
 * The agent-config link's CLI front door (road-to-the-agent-config-link).
 * `limits` reads every account's limits from cache; nothing here moves a session.
 */

import { FRESH_USAGE_MS } from "../dir-resolve.js";
import { buildLimits, type LimitsReport } from "../link/limits.js";
import { isDisabled, listAllProfiles } from "../profiles.js";
import { readProtection } from "../protection.js";
import type { ProviderId } from "../providers.js";
import { cachedUsage } from "./shared.js";

export function readLimits(provider?: ProviderId, now: number = Date.now()): LimitsReport {
  const accounts = listAllProfiles()
    .filter((p) => !provider || p.provider === provider)
    .map((p) => ({ provider: p.provider, name: p.name, disabled: isDisabled(p.provider, p.name) }));
  return buildLimits({
    now,
    accounts,
    usage: (p, n) => cachedUsage(p, n),
    threshold: (p, n) => readProtection(p, n).thresholdPct,
    freshMs: FRESH_USAGE_MS,
  });
}

export function cmdLimits(provider: ProviderId | undefined, flags: Record<string, unknown>): void {
  const r = readLimits(provider);
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }
  if (!r.accounts.length) {
    console.log("No accounts yet — add one with `agent-switch add <name>`.");
    return;
  }
  for (const a of r.accounts) {
    const windows = a.windows.map((w) => `${w.key} ${w.fill === null ? "?" : `${w.fill}%`}`).join(" · ") || "no readout";
    console.log(`${a.usable ? "✓" : "·"} ${a.id.padEnd(24)} ${windows}${a.why ? `  (${a.why})` : ""}`);
  }
}
