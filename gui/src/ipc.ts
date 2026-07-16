/**
 * IPC layer: the GUI drives the `agent-switch` binary through its `--json`
 * contract and never re-implements profile logic. Thin wrappers only — the
 * testable reshaping lives in transforms.ts.
 */

import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import type { ProfileRow, StatusJson, ProviderId, ProfileLabel, UsageSnapshot, ProvidersStatus, ProviderSurface, SessionRow, TokenRow } from "./transforms.js";
import type { AppNotification, NotificationKind } from "./notifications.js";

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

/** Rename a profile (name only; its tag is carried over). */
export async function renameProfile(provider: ProviderId, from: string, to: string): Promise<void> {
  assertValidName(to);
  await runCli(["rename", from, to, "--provider", provider]);
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

export type SwitchStrategy = "reset-first" | "rotation-first";

/** Global auto-switch strategy: reset-first (redeem a banked Codex reset before
 *  switching) vs rotation-first (switch to the account with most headroom). */
export async function getSwitchStrategy(): Promise<SwitchStrategy> {
  const { strategy } = JSON.parse(await runCli(["autoswitch", "strategy", "--json"]));
  return strategy === "rotation-first" ? "rotation-first" : "reset-first";
}

export async function setSwitchStrategy(strategy: SwitchStrategy): Promise<void> {
  await runCli(["autoswitch", "strategy", strategy]);
}

/** Manually redeem one banked Codex rate-limit reset. Consumes a real credit —
 *  the caller confirms first. */
export async function redeemReset(provider: ProviderId, name: string): Promise<void> {
  await runCli(["reset", name, "--provider", provider]);
}

/** Every provider's enabled surfaces + installed flag (the Providers settings
 *  tab). Thin wrapper over `providers status --json`; the GUI never
 *  re-implements the enabled-set. */
export async function getProviders(): Promise<ProvidersStatus> {
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

/** Claude sessions inventory (`sessions [profile] --recent N --json`). Read-only
 *  — returns [] on failure so the panel never blanks. */
export async function listSessions(profile?: string, recent = 20): Promise<SessionRow[]> {
  const args = ["sessions", ...(profile ? [profile] : []), "--recent", String(recent), "--json"];
  try {
    return JSON.parse(await runCli(args));
  } catch {
    return [];
  }
}

/** Args for `takeover`, run in the embedded terminal so the interactive resume
 *  (and any fork-cleanup) happens in a real pty. Pure builder. */
export function takeoverArgs(sessionId: string, to: string, keepSource = false): string[] {
  return ["takeover", sessionId, "--to", to, ...(keepSource ? ["--keep-source"] : [])];
}

/** Args for `compact <profile>`, run in the embedded terminal (same pattern as
 *  takeover) — types `/compact` into the profile's managed tmux pane and prints
 *  a line. `/clear` is intentionally not exposed here (destructive). Pure. */
export function compactArgs(profile: string): string[] {
  return ["compact", profile];
}

/** Args for `tokens install`, run in the embedded terminal so the ccusage
 *  install streams its output to a real pty (and the user can enter a sudo
 *  password if their npm needs one). Pure builder. */
export function tokensInstallArgs(): string[] {
  return ["tokens", "install"];
}

/** ccusage / token tracking is unavailable — the `tokens --json` payload
 *  carries an `error` (and usually a `hint`) instead of the per-profile array. */
export interface TokensError {
  error: string;
  hint?: string;
}

/** Per-profile token usage (`tokens [profile] --json`, Claude). Returns a
 *  {@link TokensError} when ccusage is missing — the `--json` path prints the
 *  error object rather than exiting on the non-json path. Pure `--json` client. */
export async function getTokens(profile?: string): Promise<TokenRow[] | TokensError> {
  const args = ["tokens", ...(profile ? [profile] : []), "--json"];
  const out = await Command.create("agent-switch", args).execute();
  try {
    const parsed = JSON.parse(out.stdout);
    if (parsed && !Array.isArray(parsed) && typeof parsed.error === "string") {
      return parsed as TokensError;
    }
    return parsed as TokenRow[];
  } catch {
    return { error: "tokens-unavailable", hint: out.stderr || "Install ccusage for token tracking." };
  }
}

/** Context-alert config (`alerts status --json`). `contextThresholds` are the
 *  context-fill percentages that record a crossing into the notification log.
 *  (The CLI command is `alerts`, distinct from `notify` which records a raw
 *  notification event.) */
export interface NotifyConfig {
  notify: boolean;
  contextThresholds: number[];
}

export async function getNotifyConfig(): Promise<NotifyConfig> {
  return JSON.parse(await runCli(["alerts", "status", "--json"]));
}

export async function setNotify(on: boolean, thresholds?: number[]): Promise<void> {
  const args = ["alerts", on ? "on" : "off"];
  if (thresholds && thresholds.length) args.push("--threshold", thresholds.join(","));
  await runCli(args);
}

/** Update the tray tooltip (active profile's worst live-session context fill).
 *  Best-effort — the caller ignores failures so a tray hiccup never blanks the
 *  UI. Backed by the `set_tray_tooltip` Tauri command. */
export async function setTrayTooltip(text: string): Promise<void> {
  await invoke("set_tray_tooltip", { text });
}

/** Quit the whole app (the `quit` Tauri command → app.exit). Closing the
 *  window only hides it, so this is the explicit way out. */
export async function quitApp(): Promise<void> {
  await invoke("quit");
}

/** Recent notifications, newest first (`notifications --json`). Read-only —
 *  returns [] on failure so the bell never blanks. */
export async function listNotifications(): Promise<AppNotification[]> {
  try {
    return JSON.parse(await runCli(["notifications", "--json"]));
  } catch {
    return [];
  }
}

/** Record a notification event in the shared log (the daemon appends its own). */
export async function recordNotification(kind: NotificationKind, title: string, message: string): Promise<void> {
  await runCli(["notify", "--kind", kind, "--title", title, "--message", message]);
}

/** Empty the notification log. */
export async function clearNotifications(): Promise<void> {
  await runCli(["notifications", "clear"]);
}
