/**
 * Assemble the ViewModel from the existing ipc.ts calls. Every readout is
 * independent (allSettled): one failing command degrades its own area instead
 * of blanking the window, and the failure surfaces as `error` / readiness.
 */

import * as ipc from "../ipc.js";
import type { ToolingEntry } from "../ipc.js";
import { getHideSummaries, getNextUsageRefreshAt, getNotifLastRead } from "../settings-store.js";
import { latestToolVersion, toolUpdateAvailable, UPDATE_CHECK_TOOLS, versionToken } from "../tool-updates.js";
import { hasUsageReadout, type ProfileRow, type UsageSnapshot } from "../transforms.js";
import {
  accountFromProfile,
  agentConfigFromStatus,
  DEFAULT_THRESHOLD,
  deriveAttention,
  deriveReadiness,
  noticeFromNotification,
  providersFromStatus,
  sessionFromRow,
  surfacesFromApps,
  toolFromEntry,
} from "./build.js";
import type { ToolEntry, ViewModel } from "./types.js";

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
    activity: [],
    readiness: "starting",
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
  const latest = await latestToolVersion(e.id);
  // Normalise to comparable tokens; an installed build newer than "latest" is up to date.
  const shown = latest == null ? null : toolUpdateAvailable(e, latest) ? (versionToken(latest) ?? latest) : version;
  return toolFromEntry({ ...e, version }, shown);
}

export async function loadViewModel(): Promise<ViewModel> {
  const now = Date.now();
  const [profilesR, sessionsR, toolingR, notifsR, providersR, acR, autostartR, autoswitchR, appsR] = await Promise.allSettled([
    ipc.listProfiles(),
    ipc.listSessions(undefined, 50),
    ipc.toolingStatus(),
    ipc.listNotifications(),
    ipc.getProviders(),
    ipc.acDiscover(),
    ipc.getAutostart(),
    ipc.getAutoSwitch(),
    ipc.listApps(),
  ]);

  const profiles: ProfileRow[] = value(profilesR) ?? [];
  const autoswitch = value(autoswitchR);
  const usageR = await Promise.allSettled(
    profiles.map((p) => (hasUsageReadout(p.provider) ? ipc.profileUsage(p.provider, p.name) : Promise.resolve(null))),
  );
  const usage = (i: number): UsageSnapshot | null => value(usageR[i]) ?? null;
  const accounts = profiles.map((p, i) => accountFromProfile(p, usage(i), autoswitch?.[p.provider]?.threshold ?? DEFAULT_THRESHOLD));

  const tooling = value(toolingR);
  const tools = tooling ? await Promise.all(tooling.map(toolWithLatest)) : [];
  const toolsCheckedAt = tooling ? Date.now() : null;
  const acTool = tools.find((t) => t.id === "agent-config");

  const lastRead = getNotifLastRead();
  const autostart = value(autostartR);
  const failures = [profilesR, toolingR, providersR, autoswitchR].filter((r) => r.status === "rejected");
  const cliError = profilesR.status === "rejected" ? String(profilesR.reason?.message ?? profilesR.reason) : null;

  return {
    now,
    accounts,
    sessions: (value(sessionsR) ?? []).map((s) => sessionFromRow(s, now)),
    rules: [],
    pools: [],
    attention: deriveAttention(accounts, tools, toolsCheckedAt, now),
    checks: [],
    tools,
    toolsCheckedAt,
    agentConfig: agentConfigFromStatus(value(acR), acTool?.latest ?? null, acR.status === "fulfilled" ? now : null),
    notices: (value(notifsR) ?? []).map((n) => noticeFromNotification(n, lastRead)),
    surfaces: surfacesFromApps(value(appsR) ?? []),
    activity: [],
    readiness: deriveReadiness(true, profilesR.status === "fulfilled", failures.length > 0),
    autostart: { desired: null, actual: autostart == null ? null : autostart ? "enabled" : "disabled" },
    providers: providersR.status === "fulfilled" ? providersFromStatus(providersR.value) : [],
    error: cliError ? `agent-switch didn't answer: ${cliError}` : null,
    platform: detectPlatform(),
    hideSummaries: getHideSummaries(),
    usageNextAt: getNextUsageRefreshAt() || null,
  };
}
