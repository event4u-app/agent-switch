/**
 * Anonymised answers for every CLI command that would read the real machine
 * (keychain, network, binaries on PATH, shell profiles). Everything else is
 * answered by the real built CLI against the seeded temp home (see seed.mjs).
 * All times are relative to `now` so the screenshots never look stale.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Stand-in home the temp home is rewritten to; never rendered (the GUI shows `~`). */
export const DEMO_HOME = "/Users/you";

export const EMAILS = {
  "claude/work": "work@example.com",
  "claude/side": "side@example.com",
  "claude/personal": "me@example.com",
  "codex/work": "work@example.com",
  "codex/personal": "me@example.com",
};

const iso = (ms) => new Date(ms).toISOString();

/** Per-profile usage snapshot, or null when the profile has no readout. */
export function usageFor(provider, name, now) {
  const w = (key, label, utilization, resetIn) => ({ key, label, utilization, resetsAt: iso(now + resetIn) });
  const table = {
    "claude/work": [w("five_hour", "5h", 61, 2 * HOUR + 10 * MIN), w("seven_day", "All", 38, 4 * DAY + 22 * HOUR)],
    "claude/side": [w("five_hour", "5h", 94, HOUR + 18 * MIN), w("seven_day", "All", 71, 2 * DAY + 5 * HOUR)],
    "claude/personal": [w("five_hour", "5h", 100, 42 * MIN), w("seven_day", "All", 83, 3 * DAY + 2 * HOUR)],
    "codex/work": [w("five_hour", "5h", 45, 3 * HOUR + 5 * MIN), w("seven_day", "7d", 22, 3 * DAY + 23 * HOUR)],
    // Last-known from its newest rollout — the login itself has expired.
    "codex/personal": [w("five_hour", "5h", 12, -2 * HOUR), w("seven_day", "7d", 30, 2 * DAY)],
  };
  const windows = table[`${provider}/${name}`];
  if (!windows) return null;
  const captured = { "claude/work": 2, "claude/side": 1, "claude/personal": 4, "codex/work": 3, "codex/personal": 190 }[`${provider}/${name}`] ?? 1;
  return {
    windows,
    routines: null,
    capturedAt: iso(now - captured * MIN),
    ...(provider === "codex" ? { resetCredits: 1 } : {}),
  };
}

export function statusJson(provider, name, now) {
  return {
    provider,
    name,
    identity: EMAILS[`${provider}/${name}`] ?? null,
    usage: usageFor(provider, name, now),
    context: null,
  };
}

export function authStatus(profiles, now) {
  return profiles.map(({ provider, name }) => {
    if (provider === "codex" && name === "personal") {
      return {
        provider,
        name,
        state: "sign-in-needed",
        expiresAt: iso(now - 2 * HOUR),
        lastRefreshAt: iso(now - 9 * DAY),
        keptFreshBy: "Codex refreshes the login when it runs",
        detail: "The stored login has expired and can no longer be refreshed.",
      };
    }
    return {
      provider,
      name,
      state: "connected",
      expiresAt: iso(now + 26 * DAY),
      lastRefreshAt: iso(now - 3 * HOUR),
      keptFreshBy: provider === "claude" ? "Claude Code refreshes the login when it runs" : "Codex refreshes the login when it runs",
      detail: "Signed in; the login refreshes on its own.",
    };
  });
}

export const TOOLING = [
  { id: "agent-config", present: true, version: "18.2.0", path: "/usr/local/bin/agent-config", healthy: true, hint: "" },
  { id: "rtk", present: true, version: "0.31.0", path: "/usr/local/bin/rtk", healthy: true, identity: "token-killer", hint: "" },
  { id: "claude", present: true, version: "2.1.312", path: "/usr/local/bin/claude", healthy: true, hint: "" },
  { id: "codex", present: true, version: "0.148.0", path: "/usr/local/bin/codex", healthy: true, hint: "" },
  { id: "agy", present: false, version: null, path: null, healthy: true, hint: "" },
];

/** Latest versions the GUI's own update sweep fetches (npm registry / GitHub). */
export const LATEST = {
  "@anthropic-ai/claude-code": "2.1.312",
  "@openai/codex": "0.150.0",
  rtkTag: "v0.31.0",
  appTag: "v2.1.0",
};

export const DOCTOR = {
  readiness: "ready",
  platform: "darwin",
  checks: [
    { id: "cli-on-path", status: "ok", title: "agent-switch is on PATH", detail: "/usr/local/bin/agent-switch" },
    { id: "shell-integration", status: "ok", title: "Shell integration is set up", detail: "Found in ~/.zshrc — `claude` and `codex` follow the active profile and folder rules." },
    { id: "autostart", status: "ok", title: "Starts at login", detail: "Turned on by the desktop app at its first launch." },
    { id: "api-key-overrides", status: "ok", title: "No API-key overrides", detail: "No provider key or token is set in the environment, so each profile uses its own login." },
    { id: "binary-claude", status: "ok", title: "`claude` is on PATH", detail: "" },
    { id: "profiles-claude", status: "ok", title: "3 claude profiles", detail: "work, side, personal" },
    { id: "binary-codex", status: "ok", title: "`codex` is on PATH", detail: "" },
    {
      id: "profiles-codex",
      status: "info",
      title: "codex/personal needs a new sign-in",
      detail: "The stored login has expired and can no longer be refreshed.",
      fix: "agent-switch run personal --provider codex, then sign in again",
    },
    { id: "sign-in-isolation", status: "ok", title: "Each profile has its own account", detail: "No two profiles of one provider are signed into the same account." },
    { id: "guard", status: "ok", title: "Single-load guard: warn", detail: "" },
    { id: "tooling-agent-config", status: "ok", title: "`agent-config` 18.2.0 is installed.", detail: "" },
    { id: "tooling-rtk", status: "ok", title: "`rtk` 0.31.0 (Token Killer) is installed.", detail: "" },
  ],
};

export const PROVIDERS_STATUS = {
  claude: { cli: true, ui: true, installed: true, binaryPath: null },
  codex: { cli: true, ui: true, installed: true, binaryPath: null },
  antigravity: { cli: false, ui: false, installed: false, binaryPath: null },
};

export const APPS = [
  { id: "claude-desktop", displayName: "Claude Desktop", provider: "claude", strategy: "user-data-dir", installed: true },
  { id: "codex-ide", displayName: "VS Code", provider: "codex", strategy: "env", installed: true },
  { id: "codex-desktop", displayName: "Codex", provider: "codex", strategy: "env+user-data-dir", installed: false },
];

/** Static answers for app-level Tauri commands (not the CLI). */
export function invokeStatic(now) {
  const ac = { status: "live", port: 43117, pid: 4242, version: "18.2.0" };
  return {
    ac_discover: ac,
    ac_ensure: ac,
    ac_force_restart: ac,
    ac_open_in_browser: ac,
    ac_open_settings_window: ac,
    ac_release: null,
    ac_api: { status: 200, body: "{}" },
    "plugin:autostart|is_enabled": true,
    "plugin:autostart|enable": null,
    "plugin:autostart|disable": null,
    "plugin:notification|is_permission_granted": true,
    "plugin:notification|request_permission": "granted",
    "plugin:app|version": "2.1.0",
    "plugin:app|name": "Agent Switch",
    "plugin:app|tauri_version": "2.11.1",
    "plugin:app|identifier": "dev.agent-switch.app",
    "plugin:shell|spawn": 4243,
    "plugin:shell|open": null,
    // The app's home dir: the CLI's absolute paths are rewritten onto it, so the
    // GUI shows them as `~/…` and a start in that folder is valid.
    "plugin:path|resolve_directory": DEMO_HOME,
    pet_show: false,
    set_tray_popover: null,
    set_tray_tooltip: null,
    tray_hide: null,
    tray_resize: null,
    show_window: null,
    set_minimize_to_dock: null,
    "plugin:notification|register_listener": 1,
    "plugin:notification|remove_listener": null,
    "plugin:notification|register_action_types": null,
    "plugin:notification|notify": null,
    "plugin:notification|remove_active": null,
    pet_hide: null,
    _now: now,
  };
}
