/**
 * IPC layer: the GUI drives the `agent-switch` binary through its `--json`
 * contract and never re-implements profile logic. Thin wrappers only — the
 * testable reshaping lives in transforms.ts.
 */

import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import type { ProfileRow, StatusJson, ProviderId, ProfileLabel, UsageSnapshot, ProvidersConfig, ProviderSurface } from "./transforms.js";

async function runCli(args: string[]): Promise<string> {
  const out = await Command.create("agent-switch", args).execute();
  if (out.code !== 0) throw new Error(out.stderr || `agent-switch ${args.join(" ")} failed`);
  return out.stdout;
}

export async function listProfiles(): Promise<ProfileRow[]> {
  return JSON.parse(await runCli(["list", "--json"]));
}

export async function activeStatus(provider: ProviderId = "claude"): Promise<StatusJson | null> {
  // A non-zero exit here means "no active profile / no usage yet" — a normal
  // empty state, not an error. Only a spawn failure (binary not found) rejects,
  // which `execute()` surfaces by throwing. Never let a missing active profile
  // blank the whole panel.
  const out = await Command.create("agent-switch", ["status", "--provider", provider, "--json"]).execute();
  if (out.code !== 0) return null;
  return JSON.parse(out.stdout);
}

export async function switchProfile(provider: ProviderId, name: string): Promise<void> {
  await runCli(["use", name, "--provider", provider]);
}

/** Clear the active profile for a provider (no profile active afterwards). */
export async function deactivateProfile(provider: ProviderId): Promise<void> {
  await runCli(["deactivate", "--provider", provider]);
}

/**
 * Delete a profile. `--force` makes the CLI deactivate it first when it is the
 * active one (and skip the live-session guard), so an active profile is
 * deactivated-then-deleted in a single step. Destructive — the UI gates this
 * behind an explicit confirm.
 */
export async function removeProfile(provider: ProviderId, name: string): Promise<void> {
  await runCli(["remove", name, "--provider", provider, "--force"]);
}

/** Profile names allowed in the create form. Restricted so it is safe to pass
 *  as a pty command argument and matches the CLI's own name rule. */
export const PROFILE_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function assertValidName(name: string): void {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new Error("Name may only contain letters, numbers, dot, dash, underscore.");
  }
}

/**
 * Args for the interactive flows that run in the EMBEDDED terminal (no external
 * window). `add` triggers the provider's first login; `run` opens a session.
 * Both are TTY-interactive, so they run in the in-app pty rather than a
 * headless spawn or a Terminal.app window.
 */
export function loginArgs(provider: ProviderId, name: string): string[] {
  assertValidName(name);
  return ["add", name, "--provider", provider];
}

export function sessionArgs(provider: ProviderId, name: string): string[] {
  return ["run", name, "--provider", provider];
}

/** claude.ai in the persistent per-profile browser — a browser window, not a
 *  terminal, so it stays a fire-and-forget spawn. */
export async function openWeb(name: string): Promise<void> {
  Command.create("agent-switch", ["web", name]).spawn();
}

/** A single profile's own usage snapshot (Claude only; null for others or when
 *  no credential/usage is available). Per-profile — the GUI composes the view. */
export async function profileUsage(provider: ProviderId, name: string): Promise<UsageSnapshot | null> {
  const out = await Command.create("agent-switch", ["status", "--provider", provider, name, "--json"]).execute();
  if (out.code !== 0) return null;
  try {
    return (JSON.parse(out.stdout) as StatusJson).usage;
  } catch {
    return null;
  }
}

/** Set or clear a profile's label (Work / Personal / Other). */
export async function setProfileLabel(provider: ProviderId, name: string, label: ProfileLabel | null): Promise<void> {
  await runCli(["label", name, label ?? "none", "--provider", provider]);
}

export interface AutoSwitch {
  enabled: boolean;
  threshold: number;
}

/** Auto-switch is per provider; `status --json` returns every provider's config
 *  so the UI can show each tab's state at once. */
export type AutoSwitchMap = Record<ProviderId, AutoSwitch>;

export async function getAutoSwitch(): Promise<AutoSwitchMap> {
  return JSON.parse(await runCli(["autoswitch", "status", "--json"]));
}

export async function setAutoSwitch(provider: ProviderId, enabled: boolean, threshold?: number): Promise<void> {
  const args = ["autoswitch", enabled ? "on" : "off", "--provider", provider];
  if (threshold !== undefined) args.push("--threshold", String(threshold));
  await runCli(args);
}

/** Every provider's enabled surfaces (the Providers settings tab). Thin wrapper
 *  over `providers status --json`; the GUI never re-implements the enabled-set. */
export async function getProviders(): Promise<ProvidersConfig> {
  return JSON.parse(await runCli(["providers", "status", "--json"]));
}

export async function setProvider(provider: ProviderId, surface: ProviderSurface, enabled: boolean): Promise<void> {
  await runCli(["providers", enabled ? "enable" : "disable", "--provider", provider, "--surface", surface]);
}

/** Remove all agent-switch data + the daemon (`uninstall --force`). Destructive
 *  — the UI gates this behind an explicit confirm, then quits. */
export async function uninstall(): Promise<void> {
  await runCli(["uninstall", "--force"]);
}

/** Launch-at-login (Settings → General), backed by tauri-plugin-autostart. */
export async function getAutostart(): Promise<boolean> {
  return autostartIsEnabled();
}
export async function setAutostart(on: boolean): Promise<void> {
  if (on) await autostartEnable();
  else await autostartDisable();
}

/** Enable autostart ON by default, but only on the very first run — a one-shot
 *  keyed on localStorage so a user who later turns it OFF is never overridden. */
export async function applyAutostartDefault(): Promise<void> {
  const KEY = "agent-switch-autostart-defaulted";
  try {
    if (localStorage.getItem(KEY) === "1") return;
  } catch {
    /* treat unreadable storage as not-yet-defaulted */
  }
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* best-effort */
  }
  try {
    await autostartEnable();
  } catch {
    /* best-effort — the Settings toggle still reflects the real state */
  }
}

export interface AppInfo {
  id: string;
  displayName: string;
  provider: ProviderId;
  strategy: "env" | "user-data-dir";
  installed: boolean;
}

/** Launchable GUI apps registered in the CLI (empty until clients register). */
export async function listApps(): Promise<AppInfo[]> {
  try {
    return JSON.parse(await runCli(["apps", "--json"]));
  } catch {
    return [];
  }
}

/** Launch a GUI app on a profile, isolated (fire-and-forget; the CLI spawns it
 *  detached and returns immediately). */
export async function openApp(appId: string, name: string): Promise<void> {
  await runCli(["open", appId, name]);
}

/** Quit the whole app (the `quit` Tauri command → app.exit). Closing the
 *  window only hides it, so this is the explicit way out. */
export async function quitApp(): Promise<void> {
  await invoke("quit");
}
