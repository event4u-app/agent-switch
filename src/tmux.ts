/**
 * Opt-in tmux integration for in-place session handoff (POSIX only).
 *
 * `run --tmux` wraps a provider session in an agent-switch-MANAGED tmux session
 * (a recorded name). `takeover --in-place` then hands the account over *inside
 * that same pane*: send a clean exit to the running CLI, wait for it to exit,
 * and respawn the pane with the target profile's env — no new terminal.
 *
 * Only agent-switch-managed panes are ever touched (the recorded-name check);
 * a session running in a user's own tmux/terminal is never send-keys'd.
 *
 * The argv builders here are pure (unit-tested); the thin exec + the recorded
 * managed-session file are the only side effects.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./profiles.js";
import { ProviderId } from "./providers.js";

/** `<ROOT>/tmux-sessions.json`: tmux session name → the profile it manages. */
export const TMUX_STATE = path.join(ROOT, "tmux-sessions.json");

export interface ManagedSession {
  provider: ProviderId;
  profile: string;
}
export type TmuxRegistry = Record<string, ManagedSession>;

/** Deterministic, collision-resistant managed session name for a profile. */
export function tmuxSessionName(provider: ProviderId, profile: string): string {
  return `asw-${provider}-${profile}`;
}

export function readTmuxRegistry(file: string = TMUX_STATE): TmuxRegistry {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? (raw as TmuxRegistry) : {};
  } catch {
    return {};
  }
}

export function recordManagedSession(name: string, session: ManagedSession, file: string = TMUX_STATE): void {
  const reg = readTmuxRegistry(file);
  reg[name] = session;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(reg, null, 2) + "\n", { mode: 0o600 });
}

export function forgetManagedSession(name: string, file: string = TMUX_STATE): void {
  const reg = readTmuxRegistry(file);
  if (name in reg) {
    delete reg[name];
    fs.writeFileSync(file, JSON.stringify(reg, null, 2) + "\n", { mode: 0o600 });
  }
}

// ---------- pure argv builders ----------------------------------------------

/** `tmux new-session -A -s <name> -e VAR=dir -- <cmd...>` — attach-or-create a
 *  named session with the profile env exported into it. */
export function newSessionArgs(name: string, envVar: string, dir: string, cmd: string[]): string[] {
  return ["new-session", "-A", "-s", name, "-e", `${envVar}=${dir}`, "--", ...cmd];
}

/** `tmux respawn-pane -k -t <target> -e VAR=dir -- <cmd...>` — replace the
 *  pane's process with the target profile's env + the resume command. `-k`
 *  reliably kills-and-replaces (the pane persists), which is why the in-place
 *  handoff uses this rather than a send-keys/close dance that would tear the
 *  pane down when the CLI is the pane's own command. */
export function respawnPaneArgs(target: string, envVar: string, dir: string, cmd: string[]): string[] {
  return ["respawn-pane", "-k", "-t", target, "-e", `${envVar}=${dir}`, "--", ...cmd];
}

// ---------- environment detection --------------------------------------------

export function tmuxAvailable(): boolean {
  if (process.platform === "win32") return false;
  return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
}

/** Inside a tmux pane? (`$TMUX` is set by tmux for every pane.) */
export function insideTmux(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.TMUX === "string" && env.TMUX.length > 0;
}

/**
 * The managed session for the current pane, or null. Pure given the current
 * session name + the registry — so `insideTmux` + a `tmux display-message`
 * lookup feed it, and it is unit-testable without tmux.
 */
export function currentManagedSession(currentName: string | null, registry: TmuxRegistry): ManagedSession | null {
  if (!currentName) return null;
  return registry[currentName] ?? null;
}

/** The current pane's tmux session name (via `tmux display-message -p '#S'`),
 *  or null when not inside tmux / tmux missing. */
export function currentTmuxSessionName(): string | null {
  if (!insideTmux()) return null;
  const r = spawnSync("tmux", ["display-message", "-p", "#S"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const s = r.stdout.trim();
  return s.length ? s : null;
}
