/**
 * Single-load guard: one profile, one live session.
 *
 * The problem it solves: `agent-switch use` writes a GLOBAL active pointer and
 * the shell wrapper re-resolves it on every invocation, so nothing stops two
 * terminals from starting `claude` on the same profile. Two live sessions on
 * one account share its rate-limit windows and both refresh one rotating OAuth
 * store (the rotation `src/locks.ts` documents) — and, worst of the three, the
 * user believes the second terminal is on a different account because they
 * typed `asw <other>` there.
 *
 * Ground truth is Claude Code's own bookkeeping, never ours: a live session
 * writes `<config>/sessions/<pid>.json`, and `liveSessionPids` filters dead
 * pids on every read. That makes the signal self-healing — a crashed session
 * leaves a stale file that is simply never counted, so this module needs no
 * cleanup job and holds no lease of its own. (An agent-switch-owned lease would
 * need a holder process; the shell wrapper execs `claude` and exits, so every
 * crash would leak one.)
 *
 * Everything here is pure — processes, environment, and clock are injected — so
 * every branch is unit-tested without spawning anything.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { liveSessionPids } from "./api.js";
import { pidCwd } from "./sessions.js";

/** How the guard reacts to a second load. Default `block`. */
export type GuardPolicy = "block" | "warn" | "off";
export const GUARD_POLICIES: readonly GuardPolicy[] = ["block", "warn", "off"];
export const DEFAULT_GUARD_POLICY: GuardPolicy = "block";

export function isGuardPolicy(v: unknown): v is GuardPolicy {
  return typeof v === "string" && (GUARD_POLICIES as readonly string[]).includes(v);
}

/** Env var that waives the guard for exactly one invocation. An env var, not a
 *  flag: the shell wrapper passes every unknown flag THROUGH to the provider
 *  binary, so a `--force` there would reach `claude`, not us. */
export const OVERRIDE_ENV = "AGENT_SWITCH_ALLOW_DUPLICATE";

/** Exit code the wrapper keys on. Distinct from every generic failure (1, 2,
 *  127 …) so the wrapper blocks on a REFUSAL and never on a missing or older
 *  `agent-switch` — fail-open is deliberate: this tool must never be the reason
 *  a user cannot start their assistant. */
export const GUARD_REFUSED_EXIT = 86;

export interface LoadedSession {
  pid: number;
  /** Working directory of the live process, best-effort (null on win32). */
  cwd: string | null;
  /** When the session registered itself — the pid file's mtime. Null if unread. */
  startedMs: number | null;
}

export interface LoadInspection {
  /** Live sessions already running on this config dir. */
  sessions: LoadedSession[];
  /** True when at least one live session holds this profile. */
  loaded: boolean;
  /**
   * True when THIS process was started from inside a session already on this
   * exact config dir — the provider's isolation env var is inherited by every
   * child. A nested start is deliberate (a sub-agent, a `--resume` from within
   * a session, tooling shelling out) and is never refused.
   */
  nested: boolean;
}

export interface InspectDeps {
  livePidsOf?: (configDir: string) => number[];
  cwdOf?: (pid: number) => string | null;
  /** Pid-file mtime lookup; injected so tests need no filesystem. */
  startedMsOf?: (configDir: string, pid: number) => number | null;
  env?: NodeJS.ProcessEnv;
}

function pidFileMtime(configDir: string, pid: number): number | null {
  try {
    return fs.statSync(path.join(configDir, "sessions", `${pid}.json`)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Who currently holds `configDir`, and whether we are a child of one of them.
 *
 * `envVar` is the provider's isolation variable (`CLAUDE_CONFIG_DIR`, …). The
 * nested comparison is on the RAW string, deliberately unresolved: that same
 * unresolved string is what Claude Code hashes into its keychain service name
 * (`profiles.ts` § configDir), so resolving it here would compare a different
 * identity than the one the rest of the tool uses.
 */
export function inspectLoad(configDir: string, envVar: string, deps: InspectDeps = {}): LoadInspection {
  const livePidsOf = deps.livePidsOf ?? liveSessionPids;
  const cwdOf = deps.cwdOf ?? pidCwd;
  const startedMsOf = deps.startedMsOf ?? pidFileMtime;
  const env = deps.env ?? process.env;

  const nested = env[envVar] === configDir;
  const pids = livePidsOf(configDir);

  // A nested start is allowed unconditionally, so its message is never
  // rendered — and resolving a cwd costs an `lsof` per pid on darwin. Skip the
  // lookup rather than pay it on a path that cannot use the answer.
  const sessions = pids.map((pid) => ({
    pid,
    cwd: nested ? null : cwdOf(pid),
    startedMs: startedMsOf(configDir, pid),
  }));

  return { sessions, loaded: sessions.length > 0, nested };
}

/** What the caller should do about a load. */
export type GuardVerdict = "allow" | "warn" | "refuse";

export interface VerdictInput {
  policy: GuardPolicy;
  inspection: LoadInspection;
  /** `--force`, or {@link OVERRIDE_ENV} in the environment. */
  overridden?: boolean;
  /**
   * Whether a live-session signal exists for this provider at all. Only Claude
   * writes pid files; codex/antigravity carry no such signal in this tree, so
   * `false` means "no evidence either way" and MUST never produce a refusal —
   * an inert guard that pretends to protect is worse than no guard.
   */
  detectable?: boolean;
}

/**
 * Pure policy resolution. Order matters and each precedence is load-bearing:
 * an undetectable provider can never refuse (no evidence), a nested start is
 * a deliberate child rather than a duplicate, and an explicit override outranks
 * the policy because the user just stated an intent this turn.
 */
export function guardVerdict({ policy, inspection, overridden = false, detectable = true }: VerdictInput): GuardVerdict {
  if (!detectable) return "allow";
  if (policy === "off") return "allow";
  if (!inspection.loaded) return "allow";
  if (inspection.nested) return "allow";
  if (overridden) return "warn"; // proceed, but still say what is happening
  return policy === "warn" ? "warn" : "refuse";
}

/** True when the one-shot override env var is set to a meaningful value. */
export function overrideFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[OVERRIDE_ENV];
  return typeof v === "string" && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/** Relative age like "3m" / "2h" — mirrors the sessions listing's `ageOf`. */
function ageOf(startedMs: number | null, now: number): string | null {
  if (startedMs === null) return null;
  const s = Math.max(0, Math.round((now - startedMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export interface MessageInput {
  profile: string;
  binary: string;
  verdict: Exclude<GuardVerdict, "allow">;
  inspection: LoadInspection;
  /** `run` accepts `--force`; the shell wrapper cannot, so it is offered only
   *  where it actually works. */
  offerForceFlag?: boolean;
  /** Same-provider profiles with NO live session — named so the user can act on
   *  the suggestion instead of first having to go look them up. */
  alternatives?: readonly string[];
  /**
   * `start`: something is about to load the profile right now.
   * `use`: the active pointer just moved onto a busy profile — nothing is
   * loaded yet, so the message describes what will happen next rather than
   * what just did.
   */
  context?: "start" | "use";
  now?: number;
}

/** Render actions as a table whose column width comes from the widest action,
 *  so a long override line can never collide with its own explanation. */
function actionTable(rows: readonly [string, string][]): string[] {
  const width = Math.max(...rows.map(([action]) => action.length));
  return rows.map(([action, explanation]) => `  ${action.padEnd(width + 2)}${explanation}`);
}

/**
 * The one place the guard speaks. Every enforcement point renders through this
 * so the CLI, the wrapper path, and `use` never drift into three dialects.
 *
 * A refusal that only says "no" hands the problem straight back, so the message
 * names WHO holds the profile (pid, age, directory), WHY that matters, and the
 * concrete ways forward — including the names of the profiles that are actually
 * free, and how to switch the guard off.
 */
export function renderGuardMessage(input: MessageInput): string {
  const {
    profile,
    binary,
    verdict,
    inspection,
    offerForceFlag = false,
    alternatives = [],
    context = "start",
    now = Date.now(),
  } = input;

  const n = inspection.sessions.length;
  const held = `profile "${profile}" is already loaded by ${n === 1 ? "a running" : `${n} running`} ${binary} session${n === 1 ? "" : "s"}`;

  const headline =
    context === "use"
      ? verdict === "refuse"
        ? `${held} — the next \`${binary}\` started here will be refused.`
        : `${held} — a second session will be allowed (guard: warn).`
      : verdict === "refuse"
        ? `${held}.`
        : `${held} — continuing anyway.`;

  const lines: string[] = [headline, ""];

  for (const sess of inspection.sessions) {
    const age = ageOf(sess.startedMs, now);
    const parts = [`  pid ${sess.pid}`];
    if (age) parts.push(`started ${age} ago`);
    if (sess.cwd) parts.push(sess.cwd);
    lines.push(parts.join("  "));
  }

  lines.push(
    "",
    "Two sessions on one account share its rate limits, and both refresh the",
    "same rotating OAuth token.",
  );

  if (verdict === "refuse") {
    const rows: [string, string][] = [];

    rows.push([
      `agent-switch use ${alternatives.length > 0 ? alternatives[0] : "<other-profile>"}`,
      alternatives.length > 1
        ? `switch to a free account — also free: ${alternatives.slice(1).join(", ")}`
        : alternatives.length === 1
          ? "switch to the account that is free"
          : "point new sessions at another account",
    ]);

    // Both overrides do the same thing, so only one is offered: `--force` where
    // the caller can accept a flag, the env var everywhere else. A shell wrapper
    // passes unknown flags THROUGH to the provider binary, which is why the env
    // var exists at all — offering both would just be two names for one action.
    rows.push(
      offerForceFlag
        ? ["--force", "start it anyway, this once"]
        : [`${OVERRIDE_ENV}=1 ${binary}`, "start it anyway, this once"],
    );

    rows.push(["agent-switch guard warn", "warn instead of refusing, from now on"]);
    rows.push(["agent-switch guard off", "turn the guard off entirely"]);

    lines.push("", "Ways forward:", ...actionTable(rows));
  }

  return lines.join("\n");
}
