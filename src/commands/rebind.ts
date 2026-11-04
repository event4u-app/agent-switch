/**
 * `rebind` — switch a running profile's account, including the interactive
 * limit dialog and the when-idle arm.
 */

import * as readline from "node:readline";
import {
  configDir,
  die,
  listProfiles,
  requireProfile,
  activeFor,
  labelFor,
  ROOT,
  resetRebindKillSwitch,
} from "../profiles.js";
import { ProviderId } from "../providers.js";
import { rebind, restoreRebind } from "../rebind.js";
import { buildRebindDialog, resolveRebindChoice, selectableRows, type RebindDialogCandidate } from "../rebind-dialog.js";
import { ArmRefused, armRebind, armsFile, cancelArms } from "../rebind-arm.js";
import { liveSessions } from "../api.js";
import { detectRunningClaudeProfile } from "../sessions.js";
import { readPid, PIDFILE, processAlive } from "../daemon.js";
import { cacheForRow, claudeSnapshot, logActivity, sameOrganization } from "./shared.js";
import { locateSession } from "../sessions.js";
import { eventFile, readEvents } from "../hooks.js";
import { moveCacheLine } from "../cache-words.js";

/** What switching `running`'s live session to `target` costs in cache terms,
 *  read from that session's transcript (the first live one with an id); null
 *  when no live session or nothing worth saying. */
function rebindCacheLine(running: string, target: string): string | null {
  const cfg = configDir("claude", running);
  const live = liveSessions(cfg).find((s) => s.sessionId);
  const loc = live?.sessionId ? locateSession(cfg, live.sessionId) : null;
  if (!live?.sessionId || !loc) return null;
  const now = Date.now();
  const cache = cacheForRow("claude", { sessionId: live.sessionId, file: loc.jsonl }, readEvents(eventFile(ROOT, "claude", running)), now);
  return moveCacheLine(cache, target, sameOrganization(running, target), now);
}

/**
 * The interactive limit dialog (Phase 4) — `agent-switch rebind` with no account
 * and no `--restore`. Gathers the OTHER claude profiles + their usage, pre-selects
 * the best-headroom profile as a convenience, and prompts the user to pick. Only
 * an explicit selection switches (via `rebind`); cancel stays put. The user
 * interaction IS the compliance line — there is NO automatic switch anywhere in
 * here. macOS-only for the actual switch; a non-TTY stdin prints the suggested
 * command instead of hanging on a prompt no one can answer.
 */
async function rebindDialog(running: string): Promise<void> {
  const others = listProfiles("claude").filter((n) => n !== running);
  const candidates: RebindDialogCandidate[] = [];
  for (const n of others) {
    // Same usage read path `status` uses (daemon cache when fresh, else the
    // OAuth /usage endpoint); null when unreadable — the row shows no %.
    candidates.push({
      name: n,
      snapshot: await claudeSnapshot(n),
      label: labelFor("claude", n),
      sameOrg: sameOrganization(running, n),
      busy: liveSessions(configDir("claude", n)).length > 0,
    });
  }
  const dialog = buildRebindDialog(candidates, running);
  const rows = selectableRows(dialog);
  if (rows.length === 0) {
    die(`no other claude profile to rebind "${running}" to — add one with \`agent-switch add <name>\`.`);
  }

  // Non-interactive stdin: never hang. Print the pre-selected profile + the exact
  // command that performs the switch, then return (no switch — the user has to run it).
  if (!process.stdin.isTTY) {
    const sug = dialog.suggestedProfile;
    if (sug) {
      console.error(`Suggested profile (most headroom): ${sug}`);
      console.error(`Switch "${running}" to it with:  agent-switch rebind ${sug} --profile ${running}`);
    } else {
      console.error(`No usage data to pre-select a profile. Switch with:  agent-switch rebind <account> --profile ${running}`);
    }
    return;
  }

  // The actual switch is macOS-only (the Linux/Windows credential backend is
  // unproven — spike R0.1). Refuse before prompting rather than after a pick.
  if (process.platform !== "darwin") {
    die("rebind is macOS-only for now (the Linux/Windows credential backend is unproven — spike R0.1).");
  }

  console.log(`Rebind "${running}" to which account? A running Claude session adopts it on its next message.`);
  rows.forEach((r, i) => {
    const marker = r.profile === dialog.suggestedProfile ? "  ← suggested (most headroom)" : "";
    const label = r.label ? ` [${r.label}]` : "";
    const util = r.maxUtil === null ? "usage n/a" : `${r.maxUtil}% used`;
    const org = r.sameOrg === true ? "  · same org" : "";
    const busy = r.busy ? "  · busy (own session running — not available)" : "";
    console.log(`  ${i + 1}) ${(r.profile + label).padEnd(24)} ${util}${org}${busy}${marker}`);
  });
  const enterHint = dialog.suggestedProfile ?? "(no suggestion)";
  console.log(`  [enter] = ${enterHint}   ·   q = cancel (stay on "${running}")`);

  const SIGINT = "\u0003"; // sentinel distinct from empty input (empty = accept the suggestion)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.on("SIGINT", () => resolve(SIGINT)); // Ctrl-C -> cancel, no switch
    rl.question("> ", (a) => resolve(a));
  });
  rl.close();

  if (answer === SIGINT) {
    console.log(`\nStayed on "${running}" — no switch.`);
    return;
  }
  const choice = resolveRebindChoice(answer, dialog);
  if (choice.kind === "cancel") {
    console.log(`Stayed on "${running}" — no switch.`);
    return;
  }
  if (choice.kind === "invalid") {
    console.log(`No valid selection — stayed on "${running}".`);
    return;
  }
  if (choice.kind === "busy") {
    console.log(`"${choice.profile}" has a session of its own running — switching would sign it out. Stayed on "${running}".`);
    return;
  }
  const cacheLine = rebindCacheLine(running, choice.profile);
  if (cacheLine) console.log(cacheLine);
  try {
    const r = await rebind({ account: choice.profile, profile: running });
    logActivity("rebind", `claude/${running}`, `now serves ${choice.profile}'s account`, "user picked it in the rebind dialog");
    console.log(r.uxNote);
  } catch (e) {
    die((e as Error).message);
  }
}

/**
 * `agent-switch rebind <account> [--profile <p>]` — point a RUNNING profile's
 * credential store at another account, so a live Claude session adopts it on its
 * next message (macOS; the user-interaction switch, ADR-003). `--restore` reverses
 * it. With NO account and NO `--restore`, opens the interactive limit dialog
 * ({@link rebindDialog}). Claude only; the target + running profiles must be logged in.
 */
export async function cmdRebind(
  providerId: ProviderId,
  providerExplicit: boolean,
  account: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (providerExplicit && providerId !== "claude") die(`rebind supports claude only (not ${providerId})`);
  if (flags.cancel) {
    const which = typeof flags.profile === "string" ? flags.profile : undefined;
    const gone = cancelArms(which, armsFile(ROOT));
    for (const a of gone) logActivity("rebind", `claude/${a.profile}`, `armed switch to ${a.target} cancelled`, "user ran `agent-switch rebind --cancel`");
    console.log(gone.length ? gone.map((a) => `Cancelled: "${a.profile}" will not switch to "${a.target}".`).join("\n") : "No armed switch to cancel.");
    return;
  }
  // Resolve which running profile rebind targets: explicit --profile wins; else
  // prefer the profile that actually has a LIVE session (rebind's whole point is
  // the running session, which may not be the "active" default-for-new-processes
  // profile). Only auto-target when exactly one profile is running — a credential
  // write must never guess across ambiguity — otherwise keep the active fallback.
  const explicitProfile = typeof flags.profile === "string" ? flags.profile : undefined;
  let profile = explicitProfile ?? activeFor("claude") ?? undefined;
  if (!explicitProfile) {
    const running = detectRunningClaudeProfile(listProfiles("claude"), (p) => configDir("claude", p));
    if (running.kind === "single") {
      if (running.profile !== profile) {
        console.log(`Auto-detected the running claude profile "${running.profile}" (its session is live) — targeting it. Pass --profile to override.`);
      }
      profile = running.profile;
    } else if (running.kind === "ambiguous") {
      console.log(
        `Multiple running claude profiles (${running.profiles.join(", ")}) — ` +
          `${profile ? `using the active profile "${profile}"` : "no active default"}; pass --profile <name> to target a specific one.`,
      );
    }
  }

  if (flags.reset) {
    // Kill-switch reset (ADR-003): clear `disabled` + the failure counter so a
    // circuit-breaker trip (or a manual disable) no longer refuses rebind.
    resetRebindKillSwitch();
    console.log("rebind re-enabled — circuit-breaker cleared (disabled=false, consecutiveFailures=0).");
    return;
  }

  if (flags.restore) {
    if (!profile) die("usage: agent-switch rebind --restore [--profile <p>] — no active claude profile to restore");
    requireProfile("claude", profile, "rebind --restore --profile");
    try {
      const r = await restoreRebind({ profile });
      logActivity("rebind", `claude/${profile}`, `restored own account (was on ${r.wasBoundTo})`, "user ran `agent-switch rebind --restore`");
      console.log(`Restored "${r.restoredProfile}" to its own account (was rebound to "${r.wasBoundTo}").`);
    } catch (e) {
      die((e as Error).message);
    }
    return;
  }

  if (!account) {
    // No account + no --restore → the interactive limit dialog (Phase 4). The
    // switch is user-interaction-gated: the picker pre-selects the best-headroom
    // profile as a convenience, but only an explicit pick switches.
    if (!profile) die("no running claude profile — pass --profile <name> or set one active with `asw <name>`.");
    requireProfile("claude", profile, "rebind --profile");
    return rebindDialog(profile);
  }
  if (!profile) die("no running claude profile — pass --profile <name> or set one active with `asw <name>`.");
  requireProfile("claude", account, "rebind");
  requireProfile("claude", profile, "rebind --profile");
  const cacheLine = rebindCacheLine(profile, account);
  if (cacheLine) console.log(cacheLine);
  if (flags["when-idle"]) {
    // D3: arm, do not run. The daemon runs the ordinary rebind at the turn's end.
    try {
      const a = armRebind({ profile, target: account, live: liveSessions(configDir("claude", profile)), sessionId: typeof flags.session === "string" ? flags.session : undefined }, armsFile(ROOT));
      logActivity("rebind", `claude/${profile}`, `armed: switches to ${account} when the turn ends`, "user ran `agent-switch rebind --when-idle`");
      console.log(`Armed: "${profile}" switches to "${account}" when session ${a.sessionId.slice(0, 8)}'s turn ends (expires ${a.expiresAt}). Cancel with \`agent-switch rebind --cancel --profile ${profile}\`.`);
      const pid = readPid(PIDFILE);
      if (pid === null || !processAlive(pid)) console.log("The background service is not running — start it (`agent-switch service start` or the app), or the arm expires unused.");
    } catch (e) {
      die(e instanceof ArmRefused ? `cannot arm: ${e.message}` : (e as Error).message);
    }
    return;
  }
  try {
    const r = await rebind({ account, profile });
    logActivity("rebind", `claude/${profile}`, `now serves ${account}'s account`, "user ran `agent-switch rebind`");
    console.log(r.uxNote);
  } catch (e) {
    die((e as Error).message);
  }
}
