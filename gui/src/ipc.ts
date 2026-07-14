/**
 * IPC layer: the GUI drives the `agent-switch` binary through its `--json`
 * contract and never re-implements profile logic. Thin wrappers only — the
 * testable reshaping lives in transforms.ts.
 */

import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import type { ProfileRow, StatusJson, ProviderId, ProfileLabel, UsageSnapshot } from "./transforms.js";

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

/** Profile names allowed in the create form. Restricted so the name can be
 *  interpolated into the AppleScript command string without escaping. */
export const PROFILE_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Create a profile and trigger its first login. The provider login is
 * interactive (OAuth needs a TTY), so we open a real Terminal window running
 * `agent-switch add` rather than trying to drive it headless. The user
 * completes the login there and returns to hit Refresh.
 */
export async function createProfile(provider: ProviderId, name: string): Promise<void> {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new Error("Name may only contain letters, numbers, dot, dash, underscore.");
  }
  const cli = `agent-switch add ${name} --provider ${provider}`;
  // macOS: AppleScript opens Terminal.app and runs the login. `name` is charset-
  // validated above, so it cannot break out of the quoted `do script` string.
  const script = `tell application "Terminal"\nactivate\ndo script "${cli}"\nend tell`;
  try {
    const out = await Command.create("osascript", ["-e", script]).execute();
    if (out.code !== 0) throw new Error(out.stderr);
  } catch {
    throw new Error(`Could not open a terminal automatically. Run this manually:  ${cli}`);
  }
}

export async function openSession(provider: ProviderId, name: string): Promise<void> {
  // Fire-and-forget a new session; the CLI injects the provider env var.
  Command.create("agent-switch", ["run", name, "--provider", provider]).spawn();
}

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

export async function getAutoSwitch(): Promise<AutoSwitch> {
  return JSON.parse(await runCli(["autoswitch", "status", "--json"]));
}

export async function setAutoSwitch(enabled: boolean, threshold?: number): Promise<void> {
  const args = ["autoswitch", enabled ? "on" : "off"];
  if (threshold !== undefined) args.push("--threshold", String(threshold));
  await runCli(args);
}

/** Remove all agent-switch data + the daemon (`uninstall --force`). Destructive
 *  — the UI gates this behind an explicit confirm, then quits. */
export async function uninstall(): Promise<void> {
  await runCli(["uninstall", "--force"]);
}

/** Quit the whole app (the `quit` Tauri command → app.exit). Closing the
 *  window only hides it, so this is the explicit way out. */
export async function quitApp(): Promise<void> {
  await invoke("quit");
}
