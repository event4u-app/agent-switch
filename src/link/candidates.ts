/**
 * Where a session near its limit could go, as a switch request offers it.
 *
 * Same-provider accounts first, emptiest first, each with the moves that path
 * supports: Claude by credential rebind (after the turn or now), Codex by
 * takeover. An account running its own session is never lent its credential
 * (rebind would cut that session off), so it is offered as a handoff only. One
 * other-provider account — the emptiest — is offered as a handoff: a new
 * session seeded with a brief, never the same conversation. Antigravity has no
 * move path and is never a target.
 */

import type { LimitsReport, AccountLimits } from "./limits.js";
import type { Candidate, MoveHow } from "./requests.js";

const MOVABLE = new Set(["claude", "codex"]);

function peak(a: AccountLimits): number | null {
  const known = a.windows.map((w) => w.fill).filter((f): f is number => typeof f === "number");
  return known.length ? Math.max(...known) : null;
}

function byRoom(a: AccountLimits, b: AccountLimits): number {
  return (peak(a) ?? 100) - (peak(b) ?? 100) || a.id.localeCompare(b.id);
}

function candidate(a: AccountLimits, how: MoveHow[]): Candidate {
  const resets = a.windows.map((w) => w.resetsAt).filter((r): r is string => !!r).sort();
  return { target: a.id, provider: a.provider, fill: peak(a), resetsAt: resets[0] ?? null, how };
}

export function candidatesFor(source: string, report: LimitsReport, busy: (id: string) => boolean): Candidate[] {
  const provider = source.split("/")[0];
  const open = report.accounts.filter((a) => a.usable && a.id !== source && MOVABLE.has(a.provider));
  const same = open.filter((a) => a.provider === provider).sort(byRoom);
  const other = open.filter((a) => a.provider !== provider).sort(byRoom);
  const out = same.map((a) => {
    if (a.provider === "codex") return candidate(a, ["now", "handoff"]);
    return candidate(a, busy(a.id) ? ["handoff"] : ["after-turn", "now"]);
  });
  if (other[0]) out.push(candidate(other[0], ["handoff"]));
  return out;
}
