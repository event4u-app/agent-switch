/**
 * Moving a session to another profile: handoff and takeover (CLI, Codex, Desktop).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, configDir, die, listProfiles, readBinaryPath, readJson, requireProfile } from "../profiles.js";
import { ProviderId, provider } from "../providers.js";
import { resolveProviderValue } from "../args.js";
import { extractBrief, writeBrief, sweepBriefs, seedPrompt } from "../handoff.js";
import { liveSessionPids } from "../api.js";
import {
  assertValidSessionId,
  cleanupForkVehicle,
  locateSession,
  locateCodexSession,
  sharedHistory,
  transferSession,
  transferCodexSession,
} from "../sessions.js";
import { findApp, guiDataDir } from "../apps.js";
import { findRunning } from "../launchers.js";
import { DESKTOP_LIVE_MS, moveDesktopSession, type DesktopLocation } from "../desktop-sessions.js";
import {
  currentManagedSession,
  currentTmuxSessionName,
  readTmuxRegistry,
  recordManagedSession,
  respawnPaneArgs,
  tmuxSessionName,
} from "../tmux.js";
import { cmdRun } from "./profiles.js";
import { cacheForRow, desktopScan, launch, sameOrganization, tildePath } from "./shared.js";
import { moveCacheLine } from "../cache-words.js";
import { eventFile, readEvents } from "../hooks.js";
import { TmuxHost } from "../host/tmux-host.js";

/** M5 fallback: open the resume in a NEW terminal (macOS Terminal.app), else
 *  print it. Used when --in-place is asked for but there is no managed pane. */
function spawnNewTerminal(command: string): void {
  if (process.platform === "darwin") {
    const script = `tell application "Terminal"\nactivate\ndo script "${command}"\nend tell`;
    spawnSync("osascript", ["-e", script], { stdio: "ignore" });
    console.log("Opened the resume in a new Terminal window — close the old window when you're done.");
  } else {
    console.log(`Open a new terminal and run:\n  ${command}\n(then close the old window).`);
  }
}

/**
 * In-place handoff. Inside an agent-switch-MANAGED tmux pane, replace the
 * running CLI with the resume command under the target profile's env (the pane
 * persists) — only ever a pane whose tmux session name is recorded as managed,
 * never a user's own terminal. Otherwise fall back to M5 (spawn a new terminal).
 * Exits the process.
 */
function resumeInPlace(providerId: ProviderId, target: string, resumeArgs: string[], resumeCommand: string): void {
  // A v3 hosted window names its own session key; respawn that window on the target.
  const hostedKey = process.env.AGENT_SWITCH_HOST_PANE;
  if (hostedKey && TmuxHost.available()) {
    const host = new TmuxHost(ROOT);
    if (host.windowOf(hostedKey)) {
      const p = provider(providerId);
      const moved = host.respawn(hostedKey, { provider: providerId, account: target, configDir: configDir(providerId, target), cwd: process.cwd(), bin: readBinaryPath(providerId) ?? p.binary, args: resumeArgs });
      console.log(`Handed the session over to "${target}" in its hosted window (${moved.key}).`);
      process.exit(0);
    }
  }
  const mgmt = currentManagedSession(currentTmuxSessionName(), readTmuxRegistry());
  if (!mgmt) {
    spawnNewTerminal(resumeCommand); // M5 — no managed pane to respawn
    process.exit(0);
  }
  const sess = tmuxSessionName(mgmt.provider, mgmt.profile);
  const p = provider(providerId);
  const argv = respawnPaneArgs(sess, p.envVar, configDir(providerId, target), [p.binary, ...resumeArgs]);
  const res = spawnSync("tmux", argv, { stdio: "inherit" });
  recordManagedSession(sess, { provider: providerId, profile: target }); // pane now runs the target
  console.log(`Handed the session over to "${target}" in the managed tmux pane "${sess}".`);
  process.exit(res.status ?? 0);
}

/**
 * `agent-switch handoff extract <id> --from <profile> --to <targetProvider> [--print-only] [--json]`
 * — compose a metadata-only brief from the SOURCE session (`--provider`/`--from`)
 * for handing off to `--to` (target provider). Writes a 0600 brief file unless
 * `--print-only`. Reads no transcript body.
 *
 * `agent-switch handoff seed --to <profile> [--provider P] --brief <path>` —
 * open the TARGET agent INTERACTIVELY (pty) with a prompt that references the
 * brief BY PATH (content never enters argv). The source session is untouched.
 */
export function cmdHandoff(
  providerId: ProviderId,
  sub?: string,
  positional: string[] = [],
  flags: Record<string, string | boolean> = {},
): void {
  if (sub === "extract") {
    const sessionId = positional[0];
    if (!sessionId || typeof flags.to !== "string") {
      die("usage: agent-switch handoff extract <session-id> --from <profile> --to <target-provider> [--provider claude|codex] [--print-only] [--json]");
    }
    try {
      assertValidSessionId(sessionId);
    } catch (e) {
      die((e as Error).message);
    }
    const targetProvider = resolveProviderValue(flags.to);
    const srcProfile = requireProfile(providerId, typeof flags.from === "string" ? flags.from : undefined, "handoff extract --from");
    const cfg = configDir(providerId, srcProfile);
    const brief = extractBrief({ provider: providerId, profile: srcProfile, sessionId, configDir: cfg, targetProvider });
    sweepBriefs(cfg);
    if (flags["print-only"]) {
      if (flags.json) console.log(JSON.stringify({ provider: providerId, profile: srcProfile, sessionId, targetProvider, brief }, null, 2));
      else console.log(brief);
      return;
    }
    const briefPath = writeBrief(cfg, sessionId, brief);
    if (flags.json) console.log(JSON.stringify({ provider: providerId, profile: srcProfile, sessionId, targetProvider, briefPath }, null, 2));
    else console.log(`Wrote handoff brief: ${briefPath}\nSeed the target with: agent-switch handoff seed --to <profile> --provider ${targetProvider} --brief ${briefPath}`);
    return;
  }

  if (sub === "seed") {
    if (typeof flags.to !== "string" || typeof flags.brief !== "string") {
      die("usage: agent-switch handoff seed --to <profile> [--provider claude|codex] --brief <path>");
    }
    const target = requireProfile(providerId, flags.to, "handoff seed --to");
    const briefPath = path.resolve(flags.brief);
    if (!fs.existsSync(briefPath)) die(`brief not found: ${briefPath}`);
    const prompt = seedPrompt(briefPath);
    if (flags["print-only"]) {
      console.log(`agent-switch run ${target} --provider ${providerId} -- ${JSON.stringify(prompt)}`);
      return;
    }
    // Interactive launch (auth is interactive — spike h1). Source untouched.
    cmdRun(providerId, target, [prompt]);
    return;
  }

  die("usage: agent-switch handoff extract|seed ...");
}

/**
 * `agent-switch takeover <session-id> --to <profile>` — move a session between
 * two Claude profiles and resume it there. Move by default; `--keep-source`
 * copies and forces `--fork-session` on the target (fresh id there) so two
 * profiles never both own a file under one session id. See the roadmap's
 * guard order — every refusal here is a data-integrity rule, not polish.
 */
export function cmdTakeover(
  providerId: ProviderId,
  providerExplicit: boolean,
  sessionId?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`takeover supports claude and codex for now (${providerId} parity is gated on its Phase-0 spike — see scripts/spikes/)`);
  }
  if (!sessionId || typeof flags.to !== "string") {
    die(
      "usage: agent-switch takeover <session-id> --to <profile> [--provider claude|codex] [--from <profile>] " +
        "[--keep-source] [--print-only] [--force] [--json]\n" +
        "       (list candidates with: agent-switch sessions)",
    );
  }
  const target = requireProfile(providerId, flags.to, "takeover --to");
  const keepSource = !!flags["keep-source"];
  const printOnly = !!flags["print-only"];
  const json = !!flags.json;
  const inPlace = !!flags["in-place"];
  if (inPlace && (printOnly || json)) die("--in-place cannot be combined with --print-only or --json.");
  if (inPlace && keepSource) {
    die("--in-place cannot be combined with --keep-source (the fork-cleanup needs a separate interactive step).");
  }

  if (providerId === "codex") {
    return takeoverCodex(sessionId, target, { keepSource, printOnly, json, inPlace, from: flags.from, force: !!flags.force });
  }

  // Source resolution: --from, or a scan across every Claude profile. More than
  // one hit means same-id divergence already exists — surface, never guess.
  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "takeover --from")]
    : listProfiles("claude");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateSession(configDir("claude", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) {
    const desktop = desktopScan().locations.filter((l) => l.sessionId === sessionId && candidates.includes(l.profile));
    if (desktop.length > 0) return takeoverDesktop(sessionId, target, desktop, { keepSource, inPlace, json, force: !!flags.force });
    die(`session ${sessionId} not found in any claude profile (see: agent-switch sessions)`);
  }
  if (hits.length > 1) {
    die(
      `session ${sessionId} exists in MULTIPLE profiles (${hits.map((h) => h.profile).join(", ")}) — ` +
        "the copies have diverged. Pick one explicitly with --from after inspecting them.",
    );
  }
  const { profile: source, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateSession>> };
  if (source === target) die(`session ${sessionId} is already in profile "${target}"`);

  // keep-source needs the interactive fork+cleanup step: without it the target
  // would keep a resumable copy under the ORIGINAL id — exactly the divergence
  // this command exists to prevent. (The GUI orchestrates this via --json later.)
  if (keepSource && (printOnly || json || !process.stdin.isTTY)) {
    die("--keep-source needs an interactive terminal (the fork's transfer copy is cleaned up after the session ends) — run it without --print-only/--json in a TTY");
  }

  const srcCfg = configDir("claude", source);
  const tgtCfg = configDir("claude", target);

  // Live guard: moving (or forking) under a running session risks interleaving
  // and appends into a file we just moved. Conservative by design: ANY live
  // session on the source profile blocks, `--force` overrides.
  const livePids = liveSessionPids(srcCfg);
  if (livePids.length > 0 && !flags.force) {
    die(
      `profile "${source}" has live Claude sessions (PIDs ${livePids.join(", ")}). ` +
        "Close them first (or --force if you are sure this session is not one of them).",
    );
  }

  const resumeArgs = ["--resume", sessionId, ...(keepSource ? ["--fork-session"] : [])];
  const resumeCommand = `agent-switch run ${target} -- ${resumeArgs.join(" ")}`;

  // Read before the move: what the target's first turn costs in cache terms.
  const now = Date.now();
  const cache = cacheForRow("claude", { sessionId, file: loc.jsonl }, readEvents(eventFile(ROOT, "claude", source)), now);
  const cacheLine = moveCacheLine(cache, target, sameOrganization(source, target), now);
  if (cacheLine && !json) console.log(cacheLine);

  // Shared-history mode (`share on --history`): both profiles already see one
  // projects/ tree — file ops would be self-moves. Degrade to the resume step.
  if (sharedHistory(srcCfg, tgtCfg)) {
    if (json) {
      console.log(JSON.stringify({ sessionId, from: source, to: target, transferred: [], shared: true, resumeCommand, cache, cacheLine }, null, 2));
      return;
    }
    console.log(`Profiles "${source}" and "${target}" share one history tree — nothing to move.`);
    console.log(`Resume on the target with:\n  ${resumeCommand}`);
    if (!printOnly && process.stdin.isTTY) process.exit(launch(provider("claude"), target, resumeArgs));
    return;
  }

  let result;
  try {
    result = transferSession(loc, tgtCfg, keepSource);
  } catch (err: any) {
    die(String(err?.message ?? err));
  }

  if (json) {
    console.log(JSON.stringify({ sessionId, from: source, to: target, transferred: result.actions, shared: false, resumeCommand, cache, cacheLine }, null, 2));
    return;
  }
  console.log(`Session ${sessionId}: ${source} -> ${target}`);
  for (const a of result.actions) console.log(`  ${a}`);
  if (keepSource) {
    console.log("Resuming with --fork-session (fresh id on the target; note: session-scoped");
    console.log("permission approvals do not carry into a fork — Claude asks once more).");
    const rc = launch(provider("claude"), target, resumeArgs);
    // The fork got its own id; drop the vehicle copy that still carries the
    // original id, or both profiles would own that id (the g02 trap).
    cleanupForkVehicle(tgtCfg, loc.projectDir, sessionId);
    console.log(`Cleaned up the transfer copy (${sessionId}) on the target — the fork has its own id.`);
    process.exit(rc);
  }
  console.log(`Resume it with:\n  ${resumeCommand}`);
  if (inPlace) resumeInPlace("claude", target, resumeArgs, resumeCommand); // exits: respawn managed pane, else M5
  if (!printOnly && process.stdin.isTTY) process.exit(launch(provider("claude"), target, resumeArgs));
}

/**
 * Takeover of a Claude Desktop (Code tab) session: its metadata is re-filed
 * under the target account in the target profile's own Desktop window. The
 * transcript sits in the shared ~/.claude and stays, so nothing resumes in a
 * terminal — the session continues in that window. The source window must be
 * closed: an open one keeps the session in memory and may write it back.
 */
function takeoverDesktop(
  sessionId: string,
  target: string,
  hits: DesktopLocation[],
  opts: { keepSource: boolean; inPlace: boolean; json: boolean; force: boolean },
): void {
  if (hits.length > 1) {
    die(
      `session ${sessionId} is filed in more than one Claude Desktop window (${hits.map((h) => `${h.profile} in ${tildePath(h.instance.dir)}`).join(", ")}) — ` +
        "delete the stale one in Claude Desktop, or pick one with --from.",
    );
  }
  const [loc] = hits;
  if (opts.keepSource) die("--keep-source is not supported for a Claude Desktop session: Desktop has no fork, so it can only move.");
  if (opts.inPlace) die("--in-place does not apply to a Claude Desktop session — it continues in a Desktop window, not a terminal.");
  if (loc.profile === target) die(`session ${sessionId} already runs on "${target}"`);
  const app = findApp("claude-desktop");
  if (!app) die("Claude Desktop is not a registered app here");
  const account = readJson(path.join(configDir("claude", target), ".claude.json"))?.oauthAccount;
  if (typeof account?.accountUuid !== "string" || typeof account?.organizationUuid !== "string") {
    die(`profile "${target}" has no signed-in account to file the session under — sign it in first.`);
  }
  const pid = findRunning(loc.instance.profile === null ? null : loc.instance.dir);
  if (pid !== null && !opts.force) {
    die(`the Claude Desktop window holding this session is open (pid ${pid}) — quit it first so it can't write the session back (or --force).`);
  }
  if (loc.live && !opts.force) {
    die(`session ${sessionId} was active in the last ${DESKTOP_LIVE_MS / 60_000} minutes — let it finish first (or --force).`);
  }
  let moved: ReturnType<typeof moveDesktopSession>;
  try {
    moved = moveDesktopSession(loc, { dir: guiDataDir(app, target), accountUuid: account.accountUuid, orgUuid: account.organizationUuid });
  } catch (err) {
    die(String((err as Error)?.message ?? err));
  }
  const resumeCommand = `agent-switch open claude-desktop ${target}`;
  if (opts.json) {
    console.log(JSON.stringify({ sessionId, from: loc.profile, to: target, surface: "desktop-app", transferred: moved.actions, shared: false, resumeCommand }, null, 2));
    return;
  }
  console.log(`Session ${sessionId}: ${loc.profile} -> ${target} (Claude Desktop)`);
  for (const a of moved.actions) console.log(`  ${a}`);
  console.log(`Continue it in ${target}'s Claude Desktop window (reopen the window if it is open and the session is missing):\n  ${resumeCommand}`);
}

/**
 * Codex takeover — move-only (g03 outcome (a): a rollout moved into another
 * authenticated CODEX_HOME resumes immediately by id). Codex has no verified
 * fork spike, so `--keep-source` is refused rather than risk same-id
 * divergence, and no reliable pid-file live detection exists, so the absence of
 * a live-guard is surfaced instead of implied.
 */
function takeoverCodex(
  sessionId: string,
  target: string,
  opts: { keepSource: boolean; printOnly: boolean; json: boolean; inPlace: boolean; from: string | boolean | undefined; force: boolean },
): void {
  const { keepSource, printOnly, json, inPlace, from } = opts;
  if (keepSource) {
    die("--keep-source is not supported for codex: fork parity is unverified (no g0.2-equivalent spike), so a kept source would risk two homes owning one session id. Codex takeover is move-only.");
  }

  const candidates = typeof from === "string"
    ? [requireProfile("codex", from, "takeover --from")]
    : listProfiles("codex");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateCodexSession(configDir("codex", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) {
    die(`session ${sessionId} not found in any codex profile (see: agent-switch sessions --provider codex)`);
  }
  if (hits.length > 1) {
    die(
      `session ${sessionId} exists in MULTIPLE codex profiles (${hits.map((h) => h.profile).join(", ")}) — ` +
        "the copies have diverged. Pick one explicitly with --from after inspecting them.",
    );
  }
  const { profile: source, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateCodexSession>> };
  if (source === target) die(`session ${sessionId} is already in profile "${target}"`);

  const resumeArgs = ["resume", sessionId];
  const resumeCommand = `agent-switch run ${target} --provider codex -- ${resumeArgs.join(" ")}`;

  let result;
  try {
    result = transferCodexSession(loc, configDir("codex", target));
  } catch (err: any) {
    die(String(err?.message ?? err));
  }

  if (json) {
    console.log(JSON.stringify({ provider: "codex", sessionId, from: source, to: target, transferred: result.actions, shared: false, resumeCommand }, null, 2));
    return;
  }
  console.log(`Session ${sessionId}: codex ${source} -> ${target}`);
  for (const a of result.actions) console.log(`  ${a}`);
  console.log("Note: codex has no pid-file live detection — make sure no active codex session was running on the source profile.");
  console.log(`Resume it with:\n  ${resumeCommand}`);
  console.log("The prompt cache is not shared across organizations: unless both accounts belong to one, the first turn here reads the whole conversation again, uncached.");
  if (inPlace) resumeInPlace("codex", target, resumeArgs, resumeCommand); // exits
  if (!printOnly && process.stdin.isTTY) process.exit(launch(provider("codex"), target, resumeArgs));
}
