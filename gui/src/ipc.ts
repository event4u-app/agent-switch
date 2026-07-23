/**
 * IPC layer: the GUI drives the `agent-switch` binary through its `--json`
 * contract and never re-implements profile logic. Thin wrappers only — the
 * testable reshaping lives in transforms.ts.
 */

import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import type { ProfileRow, StatusJson, ProviderId, ProfileLabel, AutoSwitchTag, UsageSnapshot, ProvidersStatus, ProviderSurface, SessionRow, SessionPreview } from "./transforms.js";
import type { AppNotification, NotificationKind } from "./notifications.js";
import { parseAgentConfigVersion } from "./agent-config.js";

async function runCli(args: string[]): Promise<string> {
  const out = await Command.create("agent-switch", args).execute();
  if (out.code !== 0) throw new Error(out.stderr || `agent-switch ${args.join(" ")} failed`);
  return out.stdout;
}

// ---- agent-config companion CLI (separate binary; scoped shell entries) ----

/** Installed agent-config version via `agent-config --version`; null when the
 *  binary is absent (spawn fails / not on PATH) or prints nothing parseable. */
export async function agentConfigVersion(): Promise<string | null> {
  try {
    const out = await Command.create("agent-config-version", ["--version"]).execute();
    if (out.code !== 0) return null;
    return parseAgentConfigVersion(out.stdout);
  } catch {
    return null; // not installed / not on PATH
  }
}

// Install/upgrade are deliberately NOT spawned by the GUI (copy-command only):
// unattended `npm i -g` fails on most stock macOS/Linux setups and even a
// success stays invisible to the already-running process's PATH.

// ---- agent-config local server (embedded settings — ac.rs Tauri commands) ----
// All AC API traffic goes through Rust: a Rust request sends no Origin header,
// so AC's browser-origin allow-list is skipped by design; a fetch() from this
// webview (Origin tauri://localhost) would be 403'd. The webview only renders.

/** Discovery status of the agent-config local server (mirrors Rust `AcStatus`). */
export type AcStatus =
  | { status: "notInstalled" }
  | { status: "notRunning" }
  | { status: "live"; port: number; pid: number; version: string | null }
  | { status: "wedged"; pid: number; port: number };

/** Typed error union (mirrors Rust `AcError`); `invoke` rejects with one of these. */
export type AcError =
  | { kind: "notInstalled" }
  | { kind: "notRunning" }
  | { kind: "wedged"; pid: number }
  | { kind: "spawnFailed"; exitCode: number | null; stderr: string }
  | { kind: "startTimeout"; waitedMs: number; exitCode: number | null; stderr: string }
  | { kind: "tokenRotated" }
  | { kind: "tokenUnreadable"; message: string }
  | { kind: "request"; message: string };

export interface AcApiResponse {
  status: number;
  body: string;
}

/** Read-only discovery: discovery file + pid liveness + authed ping. */
export async function acDiscover(): Promise<AcStatus> {
  return invoke<AcStatus>("ac_discover");
}

/** Discover; when not live, spawn `agent-config ui:serve --no-open` and wait
 *  (bounded) for the discovery file + authed ping. Rejects with an AcError —
 *  a wedged server is never killed here (see acForceRestart). */
export async function acEnsure(): Promise<AcStatus> {
  return invoke<AcStatus>("ac_ensure");
}

/** Loopback AC API call via Rust. Non-2xx resolves with its status (the caller
 *  decides what a 404/422 means); a 401 that survives the built-in one-shot
 *  recovery (re-discover + token re-read + retry) rejects with tokenRotated. */
export async function acApi(method: string, path: string, body?: string): Promise<AcApiResponse> {
  return invoke<AcApiResponse>("ac_api", { method, path, body: body ?? null });
}

/** Wedged case ONLY (pid alive, ping dead): kill the recorded pid, respawn,
 *  take ownership. The UI must get explicit user consent before calling this. */
export async function acForceRestart(): Promise<AcStatus> {
  return invoke<AcStatus>("ac_force_restart");
}

/** Shut the server down if AS spawned it (POST /api/v1/shutdown, SIGTERM
 *  fallback); a server AS merely found is left running. Also runs
 *  automatically on app exit. */
export async function acRelease(): Promise<void> {
  return invoke("ac_release");
}

/** Open (or focus) the separate settings WebviewWindow. The URL — including
 *  the bearer token — is built entirely in Rust; the token never enters this
 *  webview's JS context. Emits `ac-settings-closed` to this window when the
 *  settings window is destroyed (the keepalive stops on it). */
export async function acOpenSettingsWindow(theme: "light" | "dark", profile?: string): Promise<AcStatus> {
  return invoke<AcStatus>("ac_open_settings_window", { theme, profile: profile ?? null });
}

/** The permanent "Open in browser" escape hatch — AC's own browser bootstrap
 *  URL, built and opened entirely in Rust (token stays out of this webview). */
export async function acOpenInBrowser(): Promise<void> {
  return invoke("ac_open_in_browser");
}

// ---- share: link the global (default ~/.claude) skills/commands/agents/CLAUDE.md
// into every Claude profile, so a profile inherits the globally-installed
// agent-config content. Account files (.credentials.json/.claude.json) are never
// shared. Directory links auto-reflect global updates; file links are reconciled
// by `share sync`. ----

export interface ShareStatus {
  active: boolean;
  source: string;
  profiles: { name: string; shared: boolean }[];
}

/** Real share state (from each profile's link manifest, not a cached flag).
 *  No `--source` flag: the CLI's `share status` only ECHOES a passed source
 *  back (it never persists one), so the GUI owns the source selection
 *  (settings-store) and reads the plain link state here. */
export async function shareStatus(): Promise<ShareStatus> {
  return JSON.parse(await runCli(["share", "status", "--json"]));
}

/** Link a source tree's content into every profile. `source` is a Claude
 *  profile name or "default" (= the global ~/.claude), matching the CLI's
 *  `share on --source <profile|default>`. */
export async function shareOn(source = "default"): Promise<void> {
  await runCli(["share", "on", "--source", source]);
}

/** Remove agent-switch-managed links from every profile (profile-own files untouched). */
export async function shareOff(): Promise<void> {
  await runCli(["share", "off"]);
}

/** Reconcile forked file-links (e.g. CLAUDE.md after an atomic write) back to
 *  links — against the same source the links were created from. */
export async function shareSync(source = "default"): Promise<void> {
  await runCli(["share", "sync", "--source", source]);
}

// ---- tooling readout (`agent-switch tooling --json`): the Tooling section's
// ONLY data channel. Detection lives in the CLI (src/tooling.ts) — the GUI
// renders the readout and never shells out to probe binaries on its own. ----

export type ToolingId = "agent-config" | "rtk" | "claude" | "codex" | "agy";
export type ToolingIdentity = "token-killer" | "unknown-rtk" | "unverified";

/** Mirrors the CLI's ToolStatus (src/tooling.ts) exactly. Absence is encoded as
 *  `present: false`; `identity` appears only for tools with a name-collision
 *  risk (today: rtk). */
export interface ToolingEntry {
  id: ToolingId;
  present: boolean;
  version: string | null;
  path: string | null;
  healthy: boolean;
  identity?: ToolingIdentity;
  /** One actionable sentence when unhealthy; empty string when healthy. */
  hint: string;
}

/** Full detection sweep, run by the CLI (measured ≈850 ms cold — the caller
 *  caches the result and shows its age rather than re-sweeping per render). */
export async function toolingStatus(): Promise<ToolingEntry[]> {
  return JSON.parse(await runCli(["tooling", "--json"]));
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

/** One stored usage-history sample (written hourly by the background service). */
export interface UsageHistorySample {
  at: string;
  windows: { key: string; utilization: number | null }[];
}

/** One profile's usage-history series from `usage history --provider <p> --json`. */
export interface UsageHistoryProfile {
  profile: string;
  samples: UsageHistorySample[];
}

/** Per-profile usage history for the Usage section's 30-day chart. Read-only —
 *  returns [] on any failure (including an older CLI without the subcommand)
 *  so the chart degrades to its empty state instead of erroring. */
export async function usageHistory(provider: ProviderId = "claude"): Promise<UsageHistoryProfile[]> {
  try {
    return JSON.parse(await runCli(["usage", "history", "--provider", provider, "--json"]));
  } catch {
    return [];
  }
}

/** Set or clear a profile's label (Work / Personal / Other). */
export async function setProfileLabel(provider: ProviderId, name: string, label: ProfileLabel | null): Promise<void> {
  await runCli(["label", name, label ?? "none", "--provider", provider]);
}

export interface AutoSwitch {
  enabled: boolean;
  threshold: number;
  tag: AutoSwitchTag;
}

/** Auto-switch is per provider; `status --json` returns every provider's config
 *  so the UI can show each tab's state at once. */
export type AutoSwitchMap = Record<ProviderId, AutoSwitch>;

export async function getAutoSwitch(): Promise<AutoSwitchMap> {
  return JSON.parse(await runCli(["autoswitch", "status", "--json"]));
}

export async function setAutoSwitch(
  provider: ProviderId,
  enabled: boolean,
  threshold?: number,
  tag?: AutoSwitchTag,
): Promise<void> {
  const args = ["autoswitch", enabled ? "on" : "off", "--provider", provider];
  if (threshold !== undefined) args.push("--threshold", String(threshold));
  if (tag !== undefined) args.push("--tag", tag);
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

/** Link a provider's CLI binary (when it isn't on PATH) by absolute path, or
 *  unlink it (path=null) to go back to PATH resolution. */
export async function linkProviderBinary(provider: ProviderId, binPath: string): Promise<void> {
  await runCli(["providers", "link", "--provider", provider, "--path", binPath]);
}

export async function unlinkProviderBinary(provider: ProviderId): Promise<void> {
  await runCli(["providers", "unlink", "--provider", provider]);
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
export async function listSessions(profile?: string, recent = 20, provider?: ProviderId): Promise<SessionRow[]> {
  const args = [
    "sessions",
    ...(profile ? [profile] : []),
    "--recent",
    String(recent),
    ...(provider ? ["--provider", provider] : []),
    "--json",
  ];
  try {
    return JSON.parse(await runCli(args));
  } catch {
    return [];
  }
}

/** The first few conversation turns of one session, for the collapsible preview.
 *  Bounded, local-only read (ADR-002); degrades to an empty preview on any error
 *  so an expand never throws. Fetched lazily (on expand), gated by the caller on
 *  the "Hide session summaries" setting. */
export async function sessionPreview(
  provider: ProviderId,
  sessionId: string,
  profile: string,
): Promise<SessionPreview> {
  const empty: SessionPreview = { messages: [], truncated: false };
  try {
    const out = await runCli(["sessions", "preview", sessionId, "--provider", provider, "--from", profile]);
    const parsed = JSON.parse(out) as Partial<SessionPreview>;
    return { messages: parsed.messages ?? [], truncated: !!parsed.truncated };
  } catch {
    return empty;
  }
}

/** Args for `sessions rm` — carries ONLY id/provider/from(/`--purge`)/`--yes`,
 *  NEVER a `live` flag: the CLI re-resolves + re-checks liveness at exec (TOCTOU).
 *  Pure builder. */
export function deleteSessionArgs(
  provider: ProviderId,
  sessionId: string,
  from: string,
  opts: { purge?: boolean } = {},
): string[] {
  return ["sessions", "rm", sessionId, "--provider", provider, "--from", from, ...(opts.purge ? ["--purge"] : []), "--yes"];
}

/** Delete a session (default = recoverable trash). Returns the trash handle for
 *  Undo (Claude); codex archives natively (no trash handle). */
export async function deleteSession(
  provider: ProviderId,
  sessionId: string,
  from: string,
  opts: { purge?: boolean } = {},
): Promise<{ mode: string; trashId: string | null }> {
  const out = await runCli([...deleteSessionArgs(provider, sessionId, from, opts), "--json"]);
  try {
    const parsed = JSON.parse(out);
    return { mode: parsed.mode ?? (opts.purge ? "purge" : "trash"), trashId: parsed.trashId ?? null };
  } catch {
    return { mode: opts.purge ? "purge" : "trash", trashId: null };
  }
}

/** Undo a delete. Claude: `handle` is the trash-id. Codex: `handle` is the
 *  session id (native `codex unarchive`). Both need the owning profile. */
export async function restoreSession(provider: ProviderId, handle: string, from: string): Promise<void> {
  await runCli(["sessions", "restore", handle, "--provider", provider, "--from", from]);
}

/** Extract a metadata-only handoff brief from a source session. Writes the
 *  0600 brief file and returns its text (for the preview) + path (for seeding).
 *  Reads no transcript body. */
export async function extractHandoffBrief(
  provider: ProviderId,
  profile: string,
  sessionId: string,
  targetProvider: ProviderId,
): Promise<{ brief: string; briefPath: string }> {
  const printed = await runCli([
    "handoff", "extract", sessionId, "--provider", provider, "--from", profile, "--to", targetProvider, "--print-only",
  ]);
  const json = await runCli([
    "handoff", "extract", sessionId, "--provider", provider, "--from", profile, "--to", targetProvider, "--json",
  ]);
  let briefPath = "";
  try {
    briefPath = JSON.parse(json).briefPath ?? "";
  } catch {
    /* leave empty — seed will guard */
  }
  return { brief: printed, briefPath };
}

/** Args to seed the TARGET session in the embedded pty. References the brief BY
 *  PATH only — content never enters argv. Interactive (auth is interactive). Pure. */
export function handoffSeedArgs(targetProvider: ProviderId, targetProfile: string, briefPath: string): string[] {
  return ["handoff", "seed", "--to", targetProfile, "--provider", targetProvider, "--brief", briefPath];
}

/** Args for `takeover`, run in the embedded terminal so the interactive resume
 *  (and any fork-cleanup) happens in a real pty. Same-provider only; `--provider`
 *  is emitted for non-claude so a codex row takes over within codex. Pure builder. */
export function takeoverArgs(sessionId: string, to: string, keepSource = false, provider: ProviderId = "claude"): string[] {
  return [
    "takeover",
    sessionId,
    "--to",
    to,
    ...(provider !== "claude" ? ["--provider", provider] : []),
    ...(keepSource ? ["--keep-source"] : []),
  ];
}

/** Args for `compact <profile>`, run in the embedded terminal (same pattern as
 *  takeover) — types `/compact` into the profile's managed tmux pane and prints
 *  a line. `/clear` is intentionally not exposed here (destructive). Pure. */
export function compactArgs(profile: string): string[] {
  return ["compact", profile];
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

/** Show the window and give the app its Dock icon back (the `show_window` Tauri
 *  command → Regular activation policy + show + focus). Routed through Rust so
 *  every show path restores the Dock presence. */
export async function showWindow(): Promise<void> {
  await invoke("show_window");
}

/** Push the "minimize into Dock" preference to Rust (the `set_minimize_to_dock`
 *  command). Called on startup and on every toggle so the window-event handler
 *  reads a value in sync with the UI. */
export async function setMinimizeToDock(enabled: boolean): Promise<void> {
  await invoke("set_minimize_to_dock", { enabled });
}

export interface SelfUpdateResult {
  ok: boolean;
  output: string;
}

/** Update the installed CLI in place by running `agent-switch update`
 *  (`npm install -g @event4u/agent-switch@latest`). The GUI itself is fetched
 *  per-version from the release, so applying the update needs a restart; the
 *  caller surfaces that. Returns ok=false with the captured output on failure
 *  (e.g. no write access to the global npm prefix) rather than throwing. */
export async function selfUpdate(): Promise<SelfUpdateResult> {
  const out = await Command.create("agent-switch", ["update"]).execute();
  return { ok: out.code === 0, output: `${out.stdout}\n${out.stderr}`.trim() };
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

/** Whether the background daemon fires OS notifications itself (default off). */
export async function getOsNotify(): Promise<boolean> {
  const { enabled } = JSON.parse(await runCli(["os-notify", "status", "--json"]));
  return !!enabled;
}

export async function setOsNotify(on: boolean): Promise<void> {
  await runCli(["os-notify", on ? "on" : "off"]);
}
