/**
 * Lowering the near-limit threshold below where the active account already
 * sits fires the notice at once (classic window), so the setting can be tried
 * without running an account down. Title and message match the daemon's
 * verbatim so the log's dedup window coalesces the two.
 */

import { pickMostHeadroom, type AutoSwitchTag, type ProviderId } from "../../transforms.js";
import type { Account } from "../../vm/types.js";
import { notify } from "./bus.js";

function maxUse(a: Account): number | null {
  const vals = a.windows.map((w) => w.utilization).filter((u): u is number => typeof u === "number");
  return vals.length ? Math.max(...vals) : null;
}

/** The daemon's near-limit message for `tool` at `threshold`, or null when the
 *  active account is below it or nothing else could take over. */
export function nearLimitMessage(accounts: readonly Account[], tool: ProviderId, threshold: number, tag: AutoSwitchTag = "all"): string | null {
  const own = accounts.filter((a) => a.tool === tool);
  const active = own.find((a) => a.isDefault);
  if (!active) return null;
  const max = maxUse(active);
  if (max === null || max < threshold) return null;
  const target = pickMostHeadroom(
    own.filter((a) => a.id !== active.id && (tag === "all" || a.label === tag)).map((a) => ({ name: a.name, max: maxUse(a) })),
  );
  if (!target) return null;
  const how = tool === "claude" ? "Run `agent-switch rebind` to switch (no automatic switch)." : "Switch manually (no automatic switch).";
  return `${tool}/${active.name} hit ≥${threshold}% — suggested profile: ${tool}/${target}. ${how}`;
}

export async function fireNearLimitIfCrossed(accounts: readonly Account[], tool: ProviderId, threshold: number, tag?: AutoSwitchTag): Promise<boolean> {
  const message = nearLimitMessage(accounts, tool, threshold, tag);
  if (!message) return false;
  await notify("warning", "Usage limit near", message);
  return true;
}
