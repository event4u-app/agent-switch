/**
 * Session protection — a per-profile policy, separate from the near-limit
 * notifications (`autoswitch`, 95 %) and the context alerts. Default ON at 98 %
 * for every profile, including ones that existed before this file did: a
 * profile with no stored entry simply reads the default.
 *
 * What it does today: the daemon WARNS when a polled profile reaches its
 * threshold. It does not pause anything. A real pause needs the provider to
 * hold the session (Claude Code's own auto-continue), which agent-switch cannot
 * verify from here, so every notice says "warn" — never "paused".
 */

import { withFileLockSync } from "./locks.js";
import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, ensureRoot } from "./profiles.js";
import { ProviderId } from "./providers.js";
import { UsageSnapshot } from "./usage.js";

export const PROTECTION_FILE = path.join(ROOT, "protection.json");

export interface ProtectionPolicy {
  enabled: boolean;
  thresholdPct: number;
}
export const DEFAULT_PROTECTION: ProtectionPolicy = { enabled: true, thresholdPct: 98 };

type Stored = Record<string, Partial<ProtectionPolicy>>;

function key(providerId: ProviderId, name: string): string {
  return `${providerId}/${name}`;
}

function validThreshold(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100;
}

function load(file: string): Stored {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw.profiles === "object" && raw.profiles ? raw.profiles : {};
  } catch {
    return {};
  }
}

function save(profiles: Stored, file: string): void {
  if (file === PROTECTION_FILE) ensureRoot();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ schema: 1, profiles }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function normalize(raw: Partial<ProtectionPolicy> | undefined): ProtectionPolicy {
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : DEFAULT_PROTECTION.enabled,
    thresholdPct: validThreshold(raw?.thresholdPct) ? raw!.thresholdPct! : DEFAULT_PROTECTION.thresholdPct,
  };
}

export function readProtection(providerId: ProviderId, name: string, file: string = PROTECTION_FILE): ProtectionPolicy {
  return normalize(load(file)[key(providerId, name)]);
}

export function setProtection(
  providerId: ProviderId,
  name: string,
  patch: Partial<ProtectionPolicy>,
  file: string = PROTECTION_FILE,
): ProtectionPolicy {
  return withFileLockSync(file, () => {
    if (patch.thresholdPct !== undefined && !validThreshold(patch.thresholdPct)) {
      throw new Error("threshold must be a whole number between 1 and 100");
    }
    const all = load(file);
    const next = normalize({ ...normalize(all[key(providerId, name)]), ...patch });
    all[key(providerId, name)] = next;
    save(all, file);
    return next;
  });
}

/** Carry a profile's policy across a rename; drop it on remove. */
export function renameProtection(providerId: ProviderId, from: string, to: string, file: string = PROTECTION_FILE): void {
  return withFileLockSync(file, () => {
    const all = load(file);
    if (!(key(providerId, from) in all)) return;
    all[key(providerId, to)] = all[key(providerId, from)];
    delete all[key(providerId, from)];
    save(all, file);
  });
}

export function forgetProtection(providerId: ProviderId, name: string, file: string = PROTECTION_FILE): void {
  return withFileLockSync(file, () => {
    const all = load(file);
    if (!(key(providerId, name) in all)) return;
    delete all[key(providerId, name)];
    save(all, file);
  });
}

/**
 * The threshold warning for one profile, or null. Pure. Fires once per reset
 * cycle of the window that crossed (`lastCycle` = what was announced before).
 */
export function protectionNotice(
  target: string,
  snap: UsageSnapshot,
  policy: ProtectionPolicy,
  lastCycle: string | undefined,
): { cycle: string; title: string; message: string } | null {
  if (!policy.enabled) return null;
  const hit = snap.windows.find((w) => typeof w.utilization === "number" && w.utilization >= policy.thresholdPct);
  if (!hit) return null;
  const cycle = `${hit.key}@${hit.resetsAt ?? ""}`;
  if (cycle === lastCycle) return null;
  return {
    cycle,
    title: "Session protection: limit almost reached",
    message:
      `${target} reached ${hit.utilization}% of its ${hit.label} limit (protection threshold ${policy.thresholdPct}%). ` +
      `This is a warning only — agent-switch does not pause running sessions.`,
  };
}
