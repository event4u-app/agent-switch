/**
 * Two update watchers from the classic window, both best-effort and silent on
 * failure (the Updates page / Tools card show live status):
 *
 * - agent-switch itself: once on open and every 24 h while the toggle is on. An
 *   enabled bump kind installs in place (`agent-switch update`); any other kind
 *   only notifies. A handled version is not re-announced; a FAILED install is
 *   not marked handled, so the next check retries.
 * - the agent-config companion: on open and hourly; notifies once per version,
 *   and only when it is installed and a newer release exists.
 */

import { useEffect } from "react";
import { agentConfigVersion, selfUpdate, type SelfUpdateResult } from "../../ipc.js";
import { AGENT_CONFIG_REPO } from "../../agent-config.js";
import { clampText, firstHighlight, releaseNoteBlocks } from "../../release-notes.js";
import {
  getAgentConfigNotifiedVersion,
  getAutoUpdateCheck,
  getAutoUpdateKinds,
  getUpdateNotifiedVersion,
  setAgentConfigNotifiedVersion,
  setUpdateNotifiedVersion,
} from "../../settings-store.js";
import {
  checkForUpdate,
  fetchLatestRelease,
  fetchReleases,
  isNewer,
  releaseKind,
  releasesNewerThan,
  type ReleaseInfo,
  type UpdateCheck,
  type UpdateKind,
} from "../../updates.js";
import type { NotificationKind } from "../../notifications.js";
import { notify } from "./bus.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
/** How often the update loop looks at its toggle and its 24 h deadline. */
export const UPDATE_TICK_MS = 60 * 1000;

type Notify = (kind: NotificationKind, title: string, message: string) => Promise<void>;

export interface AutoUpdateDeps {
  check(): Promise<UpdateCheck>;
  install(): Promise<SelfUpdateResult>;
  kinds(): UpdateKind[];
  notified(): string;
  markNotified(tag: string): void;
  notify: Notify;
}

const autoUpdateDeps: AutoUpdateDeps = {
  check: () => checkForUpdate(),
  install: () => selfUpdate(),
  kinds: () => getAutoUpdateKinds() as UpdateKind[],
  notified: getUpdateNotifiedVersion,
  markNotified: setUpdateNotifiedVersion,
  notify,
};

export async function runAutoUpdateCheck(d: AutoUpdateDeps = autoUpdateDeps): Promise<void> {
  const res = await d.check();
  if (res.kind !== "available") return;
  const tag = res.release.tag;
  if (d.notified() === tag) return;
  const kind = releaseKind(res.current, tag);
  if (kind && d.kinds().includes(kind)) {
    const r = await d.install();
    if (r.ok) d.markNotified(tag);
    await d.notify(
      r.ok ? "success" : "warning",
      r.ok ? `Updated to ${tag}` : `Update to ${tag} failed`,
      r.ok ? "Restart agent-switch to apply." : "Open Settings › Updates to retry.",
    );
  } else {
    d.markNotified(tag);
    await d.notify("info", `Update available — ${tag}`, `Open Settings › Updates to install it${kind ? ` (${kind})` : ""}.`);
  }
}

/** One tick of the 24 h loop: run when the toggle just came on, or a day passed. */
export function updateDue(state: { wasOn: boolean; lastRun: number | null }, on: boolean, now: number): boolean {
  const due = on && (!state.wasOn || state.lastRun == null || now - state.lastRun >= DAY_MS);
  state.wasOn = on;
  if (due) state.lastRun = now;
  return due;
}

export interface AgentConfigWatchDeps {
  current(): Promise<string | null>;
  releases(): Promise<ReleaseInfo[]>;
  latest(): Promise<ReleaseInfo | null>;
  notified(): string;
  markNotified(v: string): void;
  notify: Notify;
}

const agentConfigDeps: AgentConfigWatchDeps = {
  current: agentConfigVersion,
  releases: () => fetchReleases(AGENT_CONFIG_REPO),
  latest: () => fetchLatestRelease(AGENT_CONFIG_REPO),
  notified: getAgentConfigNotifiedVersion,
  markNotified: setAgentConfigNotifiedVersion,
  notify,
};

/** Notify (once per version) when agent-config is installed and outdated. The
 *  body carries the newest release's own first highlight when it has one. */
export async function checkAgentConfigUpdate(d: AgentConfigWatchDeps = agentConfigDeps): Promise<void> {
  const current = await d.current();
  if (!current) return;
  let latest: string | null = null;
  let newer: ReleaseInfo[] = [];
  try {
    const releases = await d.releases();
    if (releases.length > 0) {
      latest = releases[0].tag;
      newer = releasesNewerThan(releases, current);
    }
  } catch {
    /* rate-limited / offline → single-release fallback */
  }
  if (!latest) {
    try {
      latest = (await d.latest())?.tag ?? null;
    } catch {
      return;
    }
  }
  if (!latest || !isNewer(latest, current) || d.notified() === latest) return;
  d.markNotified(latest);
  const highlight = newer.length ? firstHighlight(releaseNoteBlocks(newer[0].notes)) : null;
  await d.notify(
    "info",
    "agent-config update available",
    `v${current} → v${latest}${highlight ? ` — ${clampText(highlight, 90)}` : ""} · read what's new under Tools → agent-config.`,
  );
}

export function useUpdateWatchers(): void {
  useEffect(() => {
    const state = { wasOn: false, lastRun: null as number | null };
    const tick = () => {
      if (updateDue(state, getAutoUpdateCheck(), Date.now())) void runAutoUpdateCheck().catch(() => {});
    };
    tick();
    const id = setInterval(tick, UPDATE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void checkAgentConfigUpdate().catch(() => {});
    const id = setInterval(() => void checkAgentConfigUpdate().catch(() => {}), HOUR_MS);
    return () => clearInterval(id);
  }, []);
}
