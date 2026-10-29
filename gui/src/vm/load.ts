/**
 * Assemble the ViewModel from the existing ipc.ts calls. Every readout is
 * independent (allSettled): one failing command degrades its own area instead
 * of blanking the window, and the failure surfaces as `error` / readiness.
 */

import * as ipc from "../ipc.js";
import type { ToolingEntry } from "../ipc.js";
import { getHideSummaries, getMutedKinds, getNextUsageRefreshAt, getNotifLastRead } from "../settings-store.js";
import { latestToolVersion, toolUpdateAvailable, UPDATE_CHECK_TOOLS, versionToken } from "../tool-updates.js";
import { hasUsageReadout, type ProfileRow, type UsageSnapshot } from "../transforms.js";
import {
  accountFromProfile,
  desktopForeign,
  accountIdFromMember,
  activityFromEntries,
  agentConfigFromStatus,
  authFromStatus,
  loginInUse,
  bindingsFromMappings,
  checksFromDoctor,
  deriveAttention,
  deriveReadiness,
  guardFromStatus,
  noticeFromNotification,
  poolMembership,
  poolsFromRows,
  protectionFromRow,
  providersFromStatus,
  sessionFromRow,
  launchersFromRows,
  surfacesFromApps,
  toolFromEntry,
} from "./build.js";
import type { ToolEntry, ViewModel } from "./types.js";
import { cachedDoctor, cachedLatest, cachedTooling } from "./slow-cache.js";
import { loadUsage } from "./usage-loader.js";

export function detectPlatform(): ViewModel["platform"] {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Mac/i.test(ua) ? "mac" : /Win/i.test(ua) ? "windows" : "linux";
}

/** The model before the first load lands: everything unknown, readiness starting. */
export function emptyViewModel(now: number = Date.now()): ViewModel {
  return {
    now,
    accounts: [],
    sessions: [],
    rules: [],
    pools: [],
    attention: [],
    checks: [],
    tools: [],
    toolsCheckedAt: null,
    agentConfig: { status: "unknown", port: null, pid: null, version: null, latest: null, checkedAt: null },
    notices: [],
    surfaces: [],
    launchers: [],
    activity: [],
    readiness: "starting",
    checksCheckedAt: null,
    guard: { policy: null, loaded: [] },
    autostart: { desired: null, actual: null },
    providers: [],
    error: null,
    platform: detectPlatform(),
    hideSummaries: false,
    usageNextAt: null,
  };
}

function value<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

async function toolWithLatest(e: ToolingEntry): Promise<ToolEntry> {
  const version = e.version ? (versionToken(e.version) ?? e.version) : null;
  if (!e.present || !UPDATE_CHECK_TOOLS.has(e.id)) return toolFromEntry({ ...e, version }, null);
  // Hourly at most (slow-cache.ts): the GitHub check is unauthenticated, 60/h.
  const latest = await cachedLatest(e.id, () => latestToolVersion(e.id));
  // Normalise to comparable tokens; an installed build newer than "latest" is up to date.
  const shown = latest == null ? null : toolUpdateAvailable(e, latest) ? (versionToken(latest) ?? latest) : version;
  return toolFromEntry({ ...e, version }, shown);
}

export async function loadViewModel(): Promise<ViewModel> {
  const now = Date.now();
  const [profilesR, sessionsR, toolingR, notifsR, providersR, acR, autostartR, appsR] = await Promise.allSettled([
    ipc.listProfiles(),
    ipc.listSessions(undefined, 50),
    // Slow + cached between reloads (slow-cache.ts); see the cadence there.
    cachedTooling(() => ipc.toolingStatus()),
    ipc.listNotifications(),
    ipc.getProviders(),
    ipc.acDiscover(),
    ipc.getAutostart(),
    ipc.listApps(),
  ]);
  // The foundation readouts. Each degrades on its own: an older CLI without
  // the command leaves that area unknown, never fakes it.
  const [protectionR, authR, poolsR, mappingsR, doctorR, activityR, guardR, desktopR, launchersR] = await Promise.allSettled([
    ipc.listProtection(),
    ipc.authStatus(),
    ipc.listPools(),
    ipc.listMappings(),
    cachedDoctor(() => ipc.doctor()),
    ipc.listActivity(200),
    ipc.getGuard(),
    ipc.desktopInstances(),
    ipc.listLaunchers(),
  ]);
  const readAt = Date.now();

  const profiles: ProfileRow[] = value(profilesR) ?? [];
  // Cached + cooldown-gated (usage-loader.ts): a reload after every action must
  // not re-hit the rate-limited usage endpoint.
  const usageSnaps = await loadUsage(profiles).catch(() => profiles.map(() => null));
  const usage = (i: number): UsageSnapshot | null => (hasUsageReadout(profiles[i].provider) ? (usageSnaps[i] ?? null) : null);
  const protection = new Map((value(protectionR) ?? []).map((r) => [accountIdFromMember(r.profile), protectionFromRow(r)]));
  const auth = new Map((value(authR) ?? []).map((r) => [`${r.provider}:${r.name}`, authFromStatus(r, readAt)]));
  const pools = poolsFromRows(value(poolsR) ?? []);
  const membership = poolMembership(pools);
  const foreign = desktopForeign(value(desktopR) ?? []);
  const accounts = profiles.map((p, i) => {
    const id = `${p.provider}:${p.name}`;
    const a = accountFromProfile(p, usage(i), {
      protection: protection.get(id) ?? null,
      auth: loginInUse(p, value(providersR)) ? (auth.get(id) ?? null) : null,
      pools: membership.get(id) ?? [],
    });
    return foreign.has(id) ? { ...a, desktopForeign: foreign.get(id) } : a;
  });
  const doctorRun = value(doctorR);
  const doctor = doctorRun?.value ?? null;

  const toolingRun = value(toolingR);
  const tooling = toolingRun?.value ?? null;
  const tools = tooling ? await Promise.all(tooling.map(toolWithLatest)) : [];
  const toolsCheckedAt = toolingRun ? toolingRun.at : null;
  const acTool = tools.find((t) => t.id === "agent-config");

  const lastRead = getNotifLastRead();
  // Muted kinds stay out of the sheet and the unread badge (classic semantics).
  const muted = new Set(getMutedKinds());
  const autostart = value(autostartR);
  const failures = [profilesR, toolingR, providersR].filter((r) => r.status === "rejected");
  const cliError = profilesR.status === "rejected" ? String(profilesR.reason?.message ?? profilesR.reason) : null;

  return {
    now,
    accounts,
    sessions: (value(sessionsR) ?? []).map((s) => sessionFromRow(s, now)),
    rules: bindingsFromMappings(value(mappingsR) ?? []),
    pools,
    attention: deriveAttention(accounts, tools, toolsCheckedAt, now),
    checks: doctor ? checksFromDoctor(doctor) : [],
    tools,
    toolsCheckedAt,
    agentConfig: agentConfigFromStatus(value(acR), acTool?.latest ?? null, acR.status === "fulfilled" ? now : null),
    notices: (value(notifsR) ?? []).filter((n) => !muted.has(n.kind)).map((n) => noticeFromNotification(n, lastRead)),
    surfaces: surfacesFromApps(value(appsR) ?? []),
    launchers: launchersFromRows(value(launchersR) ?? []),
    activity: activityFromEntries(value(activityR) ?? []),
    readiness: deriveReadiness(true, profilesR.status === "fulfilled", failures.length > 0, doctor?.readiness ?? null),
    checksCheckedAt: doctorRun ? doctorRun.at : null,
    guard: guardFromStatus(value(guardR)),
    autostart: { desired: null, actual: autostart == null ? null : autostart ? "enabled" : "disabled" },
    providers: providersR.status === "fulfilled" ? providersFromStatus(providersR.value) : [],
    error: cliError ? `agent-switch didn't answer: ${cliError}` : null,
    platform: detectPlatform(),
    hideSummaries: getHideSummaries(),
    usageNextAt: getNextUsageRefreshAt() || null,
  };
}
