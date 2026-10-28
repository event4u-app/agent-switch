/**
 * IPC layer: the GUI drives the `agent-switch` binary through its `--json`
 * contract and never re-implements profile logic. Thin wrappers only — the
 * testable reshaping lives in transforms.ts.
 */

import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import type { ProfileRow, StatusJson, ProviderId, ProfileLabel, AutoSwitchTag, UsageSnapshot, ProvidersStatus, ProviderSurface, SessionRow, SessionPreview } from "./transforms.js";
import type { AppNotification, NotificationKind } from "./notifications.js";
import { parseAgentConfigVersion } from "./agent-config.js";
import type { BubbleAction } from "./pet/model.js";
import { getPetPresence, getPetWelcomed, setPetWelcomedFlag } from "./settings-store.js";
import {
  LEGACY_AUTOSTART_KEY,
  reconcileAutostart,
  setAutostartPreference,
  type AutostartDeps,
  type AutostartPref,
  type AutostartStatus,
} from "./autostart.js";
import { claimPetWelcome as claimPetWelcomeWith } from "./pet/welcome.js";

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
 *  settings window is destroyed. Currently not UI-wired (owner decision
 *  2026-07-24: the browser flow is the Settings entry) — returns to the UI
 *  once agent-config ships its embed contract. */
export async function acOpenSettingsWindow(theme: "light" | "dark", profile?: string): Promise<AcStatus> {
  return invoke<AcStatus>("ac_open_settings_window", { theme, profile: profile ?? null });
}

/** The "Settings" entry: opens AC's own browser bootstrap URL, built and
 *  opened entirely in Rust (token stays out of this webview). Ensures a live
 *  server first and returns its status for the card's provenance line. */
export async function acOpenInBrowser(): Promise<AcStatus> {
  return invoke<AcStatus>("ac_open_in_browser");
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

/** Run `agent-switch tooling install|upgrade <id>` in the background (no
 *  terminal). Rejects with the CLI's stderr on a non-zero exit. The CLI runner
 *  augments PATH itself (npmSearchPath), so npm resolves even from the
 *  stripped GUI environment. */
export async function runToolingAction(action: "install" | "upgrade", id: ToolingId): Promise<void> {
  await runCli(["tooling", action, id]);
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

/** Args for `rebind <account> --profile <running>` — point the RUNNING claude
 *  profile's credential store at another account (macOS live rebind, ADR-003).
 *  Pure builder (testable); claude-only, matching the CLI default. */
export function rebindArgs(account: string, profile: string): string[] {
  return ["rebind", account, "--profile", profile];
}

/** Switch a RUNNING claude profile to another account via the CLI `rebind` path.
 *  User-interaction-gated: only ever called on an explicit click in the
 *  Switch-account dialog — there is NO automatic switch. The live session adopts
 *  the new account on its next message. Rejects with the CLI stderr on failure
 *  (e.g. the non-macOS refusal), which the caller surfaces. */
export async function rebindTo(account: string, profile: string): Promise<void> {
  await runCli(rebindArgs(account, profile));
}

/** Clear the active profile for a provider (no profile active afterwards). */
export async function deactivateProfile(provider: ProviderId): Promise<void> {
  await runCli(["deactivate", "--provider", provider]);
}

/** Session monitoring: install / remove the agent-switch lifecycle hooks in EVERY
 *  Claude profile's settings.json (additive, idempotent, reversible). No profile
 *  arg → the CLI applies it to all claude profiles. */
export async function installSessionHooks(): Promise<void> {
  await runCli(["hooks", "install"]);
}

export async function uninstallSessionHooks(): Promise<void> {
  await runCli(["hooks", "uninstall"]);
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

export function sessionArgs(provider: ProviderId, name: string, cwd?: string): string[] {
  const args = ["run", name, "--provider", provider];
  return cwd ? [...args, "--cwd", cwd] : args;
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

/** File-backed GUI preferences (`agent-switch gui-settings`, see the CLI's
 *  gui-settings.ts) — the parts that must outlive the webview's localStorage. */
interface GuiSettingsJson {
  petWelcomed: boolean;
  autostart: { state: "unset" | "enabled" | "disabled"; by?: "first-run" | "user" };
}

async function readGuiSettings(): Promise<GuiSettingsJson> {
  return JSON.parse(await runCli(["gui-settings", "--json"]));
}

const autostartDeps: AutostartDeps = {
  readPref: async () => {
    const a = (await readGuiSettings()).autostart;
    return (a.state === "unset" ? { state: "unset" } : { state: a.state, by: a.by }) as AutostartPref;
  },
  writePref: async (state, by) => {
    await runCli(["gui-settings", "set", "autostart", state, "--by", by]);
  },
  markDegraded: async (reason) => {
    await runCli(["gui-settings", "set", "autostart-degraded", "--reason", reason]);
  },
  osEnable: () => autostartEnable(),
  osDisable: () => autostartDisable(),
  osIsEnabled: () => autostartIsEnabled(),
  legacyDefaulted: () => {
    try {
      return localStorage.getItem(LEGACY_AUTOSTART_KEY) === "1";
    } catch {
      return false;
    }
  },
};

/** Launch-at-login (Settings → General), backed by tauri-plugin-autostart. */
export async function getAutostart(): Promise<boolean> {
  return autostartIsEnabled();
}
/** The Settings toggle — recorded as the user's own choice, so the first-run
 *  default never overrides it later. */
export async function setAutostart(on: boolean): Promise<void> {
  await setAutostartPreference(on, autostartDeps);
}

/** Per-launch reconcile: default ON for a fresh install (confirmed with the OS
 *  before it is recorded), a stored user OFF is never overridden. Returns the
 *  state for display; `degraded` = could not be confirmed, retried next launch. */
export async function applyAutostartDefault(): Promise<AutostartStatus> {
  return reconcileAutostart(autostartDeps);
}

/** True exactly once per install: whether to show the Pet intro now (D36). */
export async function claimPetWelcome(): Promise<boolean> {
  return claimPetWelcomeWith({
    readFileFlag: async () => (await readGuiSettings()).petWelcomed,
    writeFileFlag: async () => {
      await runCli(["gui-settings", "set", "pet-welcomed"]);
    },
    legacyWelcomed: getPetWelcomed,
    markLegacy: setPetWelcomedFlag,
  });
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

// ---- desktop pet (road-to-desktop-pet) --------------------------------------

/** Show the pet overlay window. Resolves true when the window was freshly
 *  CREATED (its webview boots asynchronously — give it a beat before emitting
 *  events at it), false when an existing window was shown or nothing happened
 *  (non-Tauri env). */
export async function petShow(): Promise<boolean> {
  try {
    return await invoke<boolean>("pet_show");
  } catch {
    return false; // non-Tauri env / creation failed → the toggle has no effect
  }
}

export async function petHide(): Promise<void> {
  try {
    await invoke("pet_hide");
  } catch {
    /* non-Tauri env */
  }
}

/** Move the pet back to its default corner (Settings → Pet → Reset position).
 *  The caller clears the persisted drag position first (shared localStorage). */
export async function petResetPosition(): Promise<void> {
  try {
    await invoke("pet_reset_position");
  } catch {
    /* non-Tauri env */
  }
}

// Events are addressed to the exact WebviewWindow target (and the pet listens
// on its own window) — the unambiguous pairing in Tauri v2's event matching.
const PET_TARGET = { kind: "WebviewWindow", label: "pet" } as const;

/** Fan one notification event out to the pet window (fire-and-forget).
 *  `action` marks the bubble clickable (navigation target, see BubbleAction);
 *  `force` bypasses the pet-side reaction cooldown (dev bubble test). */
export async function petEmitNotification(
  kind: NotificationKind,
  title: string,
  action: BubbleAction | null,
  force = false,
): Promise<void> {
  try {
    await emitTo(PET_TARGET, "pet-notification", { kind, title, action, force });
  } catch {
    /* pet window closed / non-Tauri env */
  }
}

/** Push the ambient context fill (tray-tooltip number) to the pet's mood dot. */
export async function petEmitContext(pct: number | null, busy = false): Promise<void> {
  try {
    await emitTo(PET_TARGET, "pet-context", { pct, busy });
  } catch {
    /* pet window closed / non-Tauri env */
  }
}

/** An actionable pet bubble was clicked → the main window navigates to the
 *  matching surface (switch dialog / Settings-Updates / Ecosystem / Tooling).
 *  Returns an unregister function; no-op outside Tauri. */
export async function onPetAction(cb: (action: BubbleAction) => void): Promise<() => void> {
  try {
    const unlisten = await getCurrentWebviewWindow().listen<{ action: BubbleAction }>("pet-action", (e) =>
      cb(e.payload.action),
    );
    return () => unlisten();
  } catch {
    return () => {};
  }
}

/** Show the pet (creating it if needed) and wait for a FRESH webview to
 *  register its listeners before anything is emitted at it. */
async function petEnsureShown(): Promise<void> {
  const created = await petShow();
  if (created) await new Promise((r) => setTimeout(r, 900));
}

/** Deliver one event to the pet, presence-aware: in "message-only" the window
 *  is normally hidden — show it first (the pet hides itself again once the
 *  bubble and reaction settle). THE delivery path for notifications and the
 *  dev bubble tests; raw petEmitNotification skips the show. */
export async function petDeliver(
  kind: NotificationKind,
  title: string,
  action: BubbleAction | null,
  force = false,
): Promise<void> {
  try {
    if (getPetPresence() === "message-only") await petEnsureShown();
    await petEmitNotification(kind, title, action, force);
  } catch {
    /* non-Tauri env */
  }
}

/** Dev-mode pose picker: make the pet hold one spritesheet row for QA. Shows
 *  the window first — under "message-only" presence it is usually hidden. */
export async function petEmitPose(reaction: string): Promise<void> {
  try {
    await petEnsureShown();
    await emitTo(PET_TARGET, "pet-pose", { reaction });
  } catch {
    /* pet window closed / non-Tauri env */
  }
}

/** Move the pet window to an absolute physical position ("Reset to last
 *  position" in the Pet section). */
export async function petMoveTo(pos: { x: number; y: number }): Promise<void> {
  try {
    await emitTo(PET_TARGET, "pet-move", pos);
  } catch {
    /* pet window closed / non-Tauri env */
  }
}

// ---- honest foundations: protection, pools, folder rules, auth, health, activity, guard ----
// Each readout throws on a non-zero exit (an older CLI without the command
// included) so the view model's allSettled degrades that one area to unknown.

/** `<provider>/<name>` — the member key the CLI uses for protection and pools. */
export function memberKey(provider: ProviderId, name: string): string {
  return `${provider}/${name}`;
}

/** One profile's limit warning (`protection --json`). Warn-only: nothing is paused. */
export interface ProtectionRow {
  /** `provider/name` */
  profile: string;
  enabled: boolean;
  thresholdPct: number;
}

export async function listProtection(): Promise<ProtectionRow[]> {
  return JSON.parse(await runCli(["protection", "--json"]));
}

/** `protection set <provider/name> [--on|--off] [--threshold N] --json`. An empty
 *  patch is a caller bug — the CLI refuses it too. */
export async function setProtection(
  provider: ProviderId,
  name: string,
  patch: { enabled?: boolean; thresholdPct?: number },
): Promise<ProtectionRow> {
  const args = ["protection", "set", memberKey(provider, name)];
  if (patch.enabled !== undefined) args.push(patch.enabled ? "--on" : "--off");
  if (patch.thresholdPct !== undefined) {
    if (!Number.isInteger(patch.thresholdPct) || patch.thresholdPct < 1 || patch.thresholdPct > 100) {
      throw new Error("Threshold must be a whole number between 1 and 100.");
    }
    args.push("--threshold", String(patch.thresholdPct));
  }
  if (args.length === 3) throw new Error("Nothing to change.");
  return JSON.parse(await runCli([...args, "--json"]));
}

/** A pool as `pool --json` reports it. */
export interface PoolRow {
  id: string;
  name: string;
  /** `provider/name` keys, insertion order. */
  members: string[];
  createdAt: string;
}

/** `pool list --json` adds the folder rules that point at each pool. */
export interface PoolListRow extends PoolRow {
  /** `<path> (<provider>)` per rule. */
  rules: string[];
}

export interface PoolProposal {
  id: string;
  name: string;
  members: string[];
  /** A pool with this id exists already — confirming skips it. */
  exists: boolean;
}

export async function listPools(): Promise<PoolListRow[]> {
  return JSON.parse(await runCli(["pool", "list", "--json"]));
}

export async function createPool(name: string): Promise<PoolRow> {
  return JSON.parse(await runCli(["pool", "create", name, "--json"]));
}

export async function renamePool(id: string, name: string): Promise<PoolRow> {
  return JSON.parse(await runCli(["pool", "rename", id, name, "--json"]));
}

/** Refused by the CLI while a folder rule still points at the pool. */
export async function deletePool(id: string): Promise<void> {
  await runCli(["pool", "delete", id, "--json"]);
}

export async function addPoolMember(id: string, provider: ProviderId, name: string): Promise<PoolRow> {
  return JSON.parse(await runCli(["pool", "add", id, memberKey(provider, name), "--json"]));
}

export async function removePoolMember(id: string, provider: ProviderId, name: string): Promise<PoolRow> {
  return JSON.parse(await runCli(["pool", "remove", id, memberKey(provider, name), "--json"]));
}

/** Preview of pools derived from profile labels — creates nothing. */
export async function suggestPools(): Promise<PoolProposal[]> {
  const out = JSON.parse(await runCli(["pool", "suggest", "--json"])) as { proposals?: PoolProposal[] };
  return out.proposals ?? [];
}

/** Create the suggested pools; returns the ids actually created. */
export async function confirmPoolSuggestions(): Promise<string[]> {
  const out = JSON.parse(await runCli(["pool", "suggest", "--confirm", "--json"])) as { created?: string[] };
  return out.created ?? [];
}

/** One directory mapping (folder rule). `target` is a profile name or `pool:<id>`. */
export interface MappingRow {
  path: string;
  provider: ProviderId;
  target: string;
}

const MAPPING_PROVIDERS: readonly string[] = ["claude", "codex", "antigravity"];

/** Parse the TEXT form of `agent-switch mappings` — only for a CLI older than
 *  `mappings --json`, which ignores the flag and prints text: one
 *  `<path> -> <provider>/<target>` line per rule. Split on the LAST arrow so a
 *  path containing " -> " survives; unparseable lines are skipped. */
export function parseMappings(text: string): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const line of text.split("\n")) {
    const i = line.lastIndexOf(" -> ");
    if (i < 0) continue;
    const right = line.slice(i + 4).trim();
    const slash = right.indexOf("/");
    if (slash < 0) continue;
    const provider = right.slice(0, slash);
    if (!MAPPING_PROVIDERS.includes(provider)) continue;
    rows.push({ path: line.slice(0, i), provider: provider as ProviderId, target: right.slice(slash + 1) });
  }
  return rows;
}

/** Folder rules via `mappings --json` → `[{path, provider, target}]`. A CLI
 *  without `--json` prints the text form instead, which {@link parseMappings} reads. */
export async function listMappings(): Promise<MappingRow[]> {
  const out = await runCli(["mappings", "--json"]);
  let rows: unknown;
  try {
    rows = JSON.parse(out);
  } catch {
    return parseMappings(out);
  }
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is MappingRow =>
      !!r &&
      typeof r.path === "string" &&
      typeof r.target === "string" &&
      MAPPING_PROVIDERS.includes(r.provider),
  );
}

/** Map a folder to a profile or a pool (`map <name|pool:<id>> <dir> --provider P`). */
export async function mapFolder(
  provider: ProviderId,
  target: { profile: string } | { pool: string },
  dir: string,
): Promise<void> {
  if ("profile" in target) assertValidName(target.profile);
  const ref = "pool" in target ? `pool:${target.pool}` : target.profile;
  await runCli(["map", ref, dir, "--provider", provider]);
}

/** Remove a folder's rule; without a provider every provider's rule there goes. */
export async function unmapFolder(dir: string, provider?: ProviderId): Promise<void> {
  await runCli(["unmap", dir, ...(provider ? ["--provider", provider] : [])]);
}

/** `dir --json` — which profile a start in `cwd` would load, and why. */
export interface DirResolution {
  /** `provider/name`, or null when the default config dir is used. */
  profile: string | null;
  configDir: string | null;
  why: string[];
}

export async function resolveDir(provider: ProviderId, cwd: string): Promise<DirResolution> {
  const out = await Command.create("agent-switch", ["dir", "--provider", provider, "--json"], { cwd }).execute();
  if (out.code !== 0) throw new Error(out.stderr || "agent-switch dir failed");
  return JSON.parse(out.stdout);
}

/** Per-profile login state from the provider's own store (no tokens). */
export interface AuthStatusRow {
  provider: ProviderId;
  name: string;
  state: "connected" | "expiring" | "sign-in-needed" | "unknown";
  expiresAt: string | null;
  lastRefreshAt: string | null;
  keptFreshBy: string;
  detail: string;
}

export async function authStatus(provider?: ProviderId): Promise<AuthStatusRow[]> {
  return JSON.parse(await runCli(["auth-status", ...(provider ? ["--provider", provider] : []), "--json"]));
}

export interface DoctorCheckRow {
  id: string;
  status: "ok" | "warn" | "error" | "info";
  title: string;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  readiness: "ready" | "attention" | "blocked";
  platform: string;
  checks: DoctorCheckRow[];
}

/** `doctor --json`. Exit 1 means "blocked" and still carries the report, so a
 *  non-zero exit is only an error when stdout is not the report. */
export async function doctor(): Promise<DoctorReport> {
  const out = await Command.create("agent-switch", ["doctor", "--json"]).execute();
  try {
    const report = JSON.parse(out.stdout) as DoctorReport;
    if (report && Array.isArray(report.checks)) return report;
  } catch {
    /* fall through */
  }
  throw new Error(out.stderr || "agent-switch doctor failed");
}

export type ActivityEntryKind =
  | "switch"
  | "rebind"
  | "login"
  | "redeem"
  | "autostart"
  | "guard"
  | "update"
  | "protection"
  | "pool"
  | "remove";

export interface ActivityEntry {
  at: string;
  kind: ActivityEntryKind;
  /** `provider/name`, a pool id, or null. */
  target: string | null;
  action: string;
  reason: string;
  ok: boolean;
}

export async function listActivity(limit?: number): Promise<ActivityEntry[]> {
  const args = ["activity", ...(limit !== undefined ? ["--limit", String(limit)] : []), "--json"];
  const out = JSON.parse(await runCli(args)) as { entries?: ActivityEntry[] };
  return out.entries ?? [];
}

export type GuardPolicy = "block" | "warn" | "off";

export interface GuardStatus {
  policy: GuardPolicy;
  /** Profiles loaded by a live session right now (sessions > 1 = doubled). */
  loaded: { provider: ProviderId; name: string; sessions: number }[];
}

export async function getGuard(): Promise<GuardStatus> {
  return JSON.parse(await runCli(["guard", "--json"]));
}

export async function setGuard(policy: GuardPolicy): Promise<GuardStatus> {
  return JSON.parse(await runCli(["guard", policy, "--json"]));
}

/** The stored start-at-login preference (what the user / first run wanted) and
 *  why the last attempt could not be confirmed — read-only, unlike
 *  {@link applyAutostartDefault}, which reconciles. */
export async function getAutostartPreference(): Promise<{ state: "unset" | "enabled" | "disabled"; degradedReason: string | null }> {
  const raw = (await readGuiSettings()) as GuiSettingsJson & { autostartDegraded?: { reason?: string } | null };
  return { state: raw.autostart.state, degradedReason: raw.autostartDegraded?.reason ?? null };
}
