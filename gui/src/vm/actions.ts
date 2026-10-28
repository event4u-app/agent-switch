/**
 * The backend seam (`act` in the design store). Each method maps to exactly one
 * existing ipc.ts call. Design actions without a backend are ABSENT from the
 * object — callers check presence and hide or disable the control with its
 * reason; nothing is faked.
 *
 * Absent today: addAccount, signIn, startSession, takeOver, handOff, compact,
 * runTool (these run in the built-in terminal — wired by the screens lane via
 * the existing *Args builders), decideLimit, setProtection, setLauncher,
 * toggleRule, runFix, pickFolder, exportDiagnostics, openUsagePage, setSetting,
 * petTest, movePet.
 */

import * as ipc from "../ipc.js";
import { requestDesktopPermission, type DesktopPermission } from "../notifications.js";
import type { ProfileLabel, ProviderId, ProviderSurface } from "../transforms.js";
import { checkForUpdate, type UpdateCheck } from "../updates.js";
import type { Session, ViewModel } from "./types.js";

export interface Actions {
  setDefault?(accountId: string): Promise<void>;
  deactivate?(tool: ProviderId): Promise<void>;
  removeAccount?(accountId: string): Promise<void>;
  updateAccount?(accountId: string, patch: { name?: string; label?: ProfileLabel | null }): Promise<void>;
  redeemReset?(accountId: string): Promise<void>;
  refreshUsage?(): Promise<void>;
  recheckTools?(): Promise<void>;
  trashSession?(sessionId: string): Promise<{ trashId: string | null }>;
  restoreSession?(sessionId: string, handle: string): Promise<void>;
  /** Live switch of a running Claude session's account (macOS, ADR-003). */
  rebind?(sessionId: string, targetAccountId: string): Promise<void>;
  openApp?(appId: string, accountId: string): Promise<void>;
  openAgentConfig?(): Promise<void>;
  restartAgentConfig?(): Promise<void>;
  setSharedSetup?(enabled: boolean, source?: string): Promise<void>;
  setAutostart?(on: boolean): Promise<void>;
  setProvider?(tool: ProviderId, surface: ProviderSurface, on: boolean): Promise<void>;
  linkProviderBinary?(tool: ProviderId, path: string): Promise<void>;
  unlinkProviderBinary?(tool: ProviderId): Promise<void>;
  clearNotifications?(): Promise<void>;
  requestNotifyPermission?(): Promise<DesktopPermission>;
  checkForUpdate?(): Promise<UpdateCheck>;
  selfUpdate?(): Promise<ipc.SelfUpdateResult>;
  uninstall?(): Promise<void>;
  quit?(): Promise<void>;
  /** First turns of a session, read on demand (ADR-002). */
  previewSession?(sessionId: string): Promise<{ role: "you" | "agent"; text: string }[]>;
  /** Metadata-only handoff brief of a session for a target account; writes the
   *  brief file the seed command references by path. */
  handoffBrief?(sessionId: string, targetAccountId: string): Promise<{ brief: string; briefPath: string }>;
}

/** `claude:work` → ["claude", "work"]. Names never contain ":" (PROFILE_NAME_RE). */
export function splitAccountId(id: string): [ProviderId, string] {
  const i = id.indexOf(":");
  return [id.slice(0, i) as ProviderId, id.slice(i + 1)];
}

function sessionParts(s: Session): { provider: ProviderId; sessionId: string; profile: string } {
  const [provider, profile] = splitAccountId(s.accountId);
  return { provider, sessionId: s.id.slice(s.id.indexOf(":") + 1), profile };
}

export function createActions(getVm: () => ViewModel, reload: () => Promise<void>): Actions {
  const session = (id: string) => {
    const s = getVm().sessions.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown session ${id}`);
    return sessionParts(s);
  };
  const thenReload =
    <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      await fn(...a);
      await reload();
    };

  return {
    setDefault: thenReload((id: string) => ipc.switchProfile(...splitAccountId(id))),
    deactivate: thenReload((tool: ProviderId) => ipc.deactivateProfile(tool)),
    removeAccount: thenReload((id: string) => ipc.removeProfile(...splitAccountId(id))),
    updateAccount: thenReload(async (id: string, patch: { name?: string; label?: ProfileLabel | null }) => {
      const [provider, name] = splitAccountId(id);
      if (patch.label !== undefined) await ipc.setProfileLabel(provider, name, patch.label);
      if (patch.name && patch.name !== name) await ipc.renameProfile(provider, name, patch.name);
    }),
    redeemReset: thenReload((id: string) => ipc.redeemReset(...splitAccountId(id))),
    refreshUsage: reload,
    recheckTools: reload,
    trashSession: async (id: string) => {
      const p = session(id);
      const res = await ipc.deleteSession(p.provider, p.sessionId, p.profile);
      await reload();
      return { trashId: res.trashId };
    },
    restoreSession: thenReload(async (id: string, handle: string) => {
      const p = session(id);
      await ipc.restoreSession(p.provider, handle, p.profile);
    }),
    rebind: thenReload(async (id: string, target: string) => {
      const p = session(id);
      await ipc.rebindTo(splitAccountId(target)[1], p.profile);
    }),
    openApp: (appId: string, id: string) => ipc.openApp(appId, splitAccountId(id)[1]),
    openAgentConfig: async () => {
      await ipc.acOpenInBrowser();
    },
    restartAgentConfig: thenReload(() => ipc.acForceRestart()),
    setSharedSetup: thenReload((enabled: boolean, source?: string) => (enabled ? ipc.shareOn(source) : ipc.shareOff())),
    setAutostart: thenReload((on: boolean) => ipc.setAutostart(on)),
    setProvider: thenReload((tool: ProviderId, surface: ProviderSurface, on: boolean) => ipc.setProvider(tool, surface, on)),
    linkProviderBinary: thenReload((tool: ProviderId, path: string) => ipc.linkProviderBinary(tool, path)),
    unlinkProviderBinary: thenReload((tool: ProviderId) => ipc.unlinkProviderBinary(tool)),
    clearNotifications: thenReload(() => ipc.clearNotifications()),
    requestNotifyPermission: () => requestDesktopPermission(),
    checkForUpdate: () => checkForUpdate(),
    selfUpdate: () => ipc.selfUpdate(),
    uninstall: () => ipc.uninstall(),
    quit: () => ipc.quitApp(),
    previewSession: async (id: string) => {
      const p = session(id);
      const res = await ipc.sessionPreview(p.provider, p.sessionId, p.profile);
      return res.messages.map((m) => ({ role: m.role === "user" ? ("you" as const) : ("agent" as const), text: m.text }));
    },
    handoffBrief: (id: string, target: string) => {
      const p = session(id);
      return ipc.extractHandoffBrief(p.provider, p.profile, p.sessionId, splitAccountId(target)[0]);
    },
  };
}
