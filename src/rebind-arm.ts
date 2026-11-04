/**
 * "Switch when this turn ends" (D3): an ARMED live switch.
 *
 * The owner rule is that a running session changes account only through an
 * explicit, confirmed user action. Arming IS that action — `rebind --when-idle`
 * or the session sheet's confirm dialog. The daemon only picks the moment: the
 * next `busy → idle` edge the host's own registry file reports for the armed
 * session. It then runs the ordinary `rebind` with every guard it has; a
 * refusal drops the arm and tells the user why. An arm fires at most once,
 * expires after {@link ARM_TTL_MS}, and is never created by anything but a user.
 *
 * Arming needs the host's state word: a session whose liveness is only the cwd
 * guess (`liveSource: "cwd"`, no `sessionId` in the registry file) has no edge
 * to watch, so arming it is refused.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { LiveSession } from "./api.js";
import { withFileLockSync } from "./locks.js";

/** An arm lives this long; after it, it is ignored and cleaned. */
export const ARM_TTL_MS = 30 * 60_000;

/** One armed switch, keyed by the running claude profile it re-points. */
export interface RebindArm {
  profile: string;
  /** The account the profile switches to. */
  target: string;
  createdAt: string;
  expiresAt: string;
  /** The armed session's id, from the host registry. */
  sessionId: string;
  /** The last state word seen for the session — the edge is measured from it. */
  lastStatus: string | null;
}

export type ArmStore = Record<string, RebindArm>;

/** Arming refused before anything was written. */
export class ArmRefused extends Error {}

export function armsFile(root: string): string {
  return path.join(root, "rebind-arms.json");
}

function load(file: string): ArmStore {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const arms = raw && typeof raw.arms === "object" && raw.arms ? raw.arms : {};
    const out: ArmStore = {};
    for (const [k, a] of Object.entries(arms as Record<string, Partial<RebindArm>>)) {
      if (a && typeof a.profile === "string" && typeof a.target === "string" && typeof a.sessionId === "string" && typeof a.expiresAt === "string") {
        out[k] = { profile: a.profile, target: a.target, sessionId: a.sessionId, createdAt: String(a.createdAt ?? ""), expiresAt: a.expiresAt, lastStatus: typeof a.lastStatus === "string" ? a.lastStatus : null };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(arms: ArmStore, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ schema: 1, arms }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function expired(arm: RebindArm, now: number): boolean {
  const t = Date.parse(arm.expiresAt);
  return !Number.isFinite(t) || t <= now;
}

/** The arms still in force; expired ones are left out (and removed by the next write). */
export function readArms(file: string, now: number = Date.now()): ArmStore {
  const out: ArmStore = {};
  for (const [k, a] of Object.entries(load(file))) if (!expired(a, now)) out[k] = a;
  return out;
}

/** The arm for one session, if any is in force. */
export function armForSession(arms: ArmStore, profile: string, sessionId: string): RebindArm | null {
  const a = arms[profile];
  return a && a.sessionId === sessionId ? a : null;
}

/**
 * Which live session an arm watches. It must carry the host's state word: the
 * registry names its session id and a status. A pid whose registry file says
 * neither is only the cwd guess, and has no edge to watch.
 */
export function pickArmSession(live: LiveSession[], sessionId?: string): { sessionId: string; status: string } {
  const watchable = live.filter((s) => s.sessionId && s.status);
  if (sessionId) {
    const hit = watchable.find((s) => s.sessionId === sessionId);
    if (hit) return { sessionId, status: hit.status! };
    if (live.some((s) => s.sessionId === sessionId)) {
      throw new ArmRefused(`session ${sessionId} has no state in Claude Code's registry, so the end of its turn cannot be seen — switch it now or take it over instead.`);
    }
    if (live.some((s) => !s.sessionId)) {
      throw new ArmRefused(`session ${sessionId} is live only by its folder (liveSource "cwd"): Claude Code's registry does not report its state, so the end of its turn cannot be seen — switch it now or take it over instead.`);
    }
    throw new ArmRefused(`session ${sessionId} is not running on this profile.`);
  }
  if (watchable.length === 1) return { sessionId: watchable[0].sessionId!, status: watchable[0].status! };
  if (watchable.length > 1) {
    throw new ArmRefused(`several sessions run on this profile (${watchable.map((s) => s.sessionId!.slice(0, 8)).join(", ")}) — pass --session <id> to say whose turn to wait for.`);
  }
  if (live.length > 0) {
    throw new ArmRefused(`the running session is live only by its folder (liveSource "cwd"): Claude Code's registry does not report its state, so the end of its turn cannot be seen — switch it now or take it over instead.`);
  }
  throw new ArmRefused("no running session on this profile — there is no turn to wait for.");
}

/** Arm a switch (replaces an earlier arm on the same profile). */
export function armRebind(
  opts: { profile: string; target: string; live: LiveSession[]; sessionId?: string; now?: number },
  file: string,
): RebindArm {
  if (opts.profile === opts.target) throw new ArmRefused(`"${opts.profile}" already runs on its own account — pick another account to switch to.`);
  const picked = pickArmSession(opts.live, opts.sessionId);
  const now = opts.now ?? Date.now();
  const arm: RebindArm = {
    profile: opts.profile,
    target: opts.target,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ARM_TTL_MS).toISOString(),
    sessionId: picked.sessionId,
    lastStatus: picked.status,
  };
  return withFileLockSync(file, () => {
    const arms = readArms(file, now);
    arms[opts.profile] = arm;
    save(arms, file);
    return arm;
  });
}

/** Cancel one profile's arm, or every arm when `profile` is undefined. Returns what was cancelled. */
export function cancelArms(profile: string | undefined, file: string, now: number = Date.now()): RebindArm[] {
  return withFileLockSync(file, () => {
    const all = load(file);
    const gone: RebindArm[] = [];
    let removed = 0;
    for (const [k, a] of Object.entries(all)) {
      if (profile !== undefined && k !== profile) continue;
      if (!expired(a, now)) gone.push(a);
      delete all[k];
      removed++;
    }
    if (removed) save(all, file);
    return gone;
  });
}

// ---------- the daemon side ----------

export interface ArmWatchDeps {
  file: string;
  /** Live sessions on a claude profile's config dir (the host registry). */
  liveSessions(profile: string): LiveSession[];
  /** The ordinary rebind path, every guard included. Throws on a refusal. */
  rebind(opts: { account: string; profile: string }): Promise<{ uxNote: string }>;
  notify(event: { kind: "success" | "error" | "warning" | "info"; title: string; message: string; key?: string }): void;
  activity(target: string, action: string, reason: string, ok: boolean): void;
  log(line: string): void;
  now?(): number;
  /** Type the continuation into the switched session (`provider/account/id`):
   *  true when it was sent, else why not (not hosted, someone typing there). */
  continueSession?(key: string): true | string;
}

/** `busy → idle`: the host reported a turn running, and now reports it over. */
export function isIdleEdge(prev: string | null, next: string | null): boolean {
  return prev === "busy" && next === "idle";
}

/**
 * One watch tick. For each arm: drop it when expired or when its session is
 * gone; on a `busy → idle` edge remove it FIRST (so it can never run twice) and
 * then run `rebind`; otherwise remember the state for the next tick.
 * Returns the profiles whose switch was attempted this tick.
 */
export async function watchArmsOnce(d: ArmWatchDeps): Promise<string[]> {
  const now = d.now ? d.now() : Date.now();
  const due: RebindArm[] = [];
  withFileLockSync(d.file, () => {
    const all = load(d.file);
    if (Object.keys(all).length === 0) return;
    let changed = false;
    for (const [k, a] of Object.entries(all)) {
      if (expired(a, now)) {
        delete all[k];
        changed = true;
        d.log(`arm: claude/${a.profile} → ${a.target} expired unused`);
        d.activity(`claude/${a.profile}`, `armed switch to ${a.target} expired`, "nothing switched — the turn did not end within 30 minutes", true);
        continue;
      }
      let live: LiveSession[] = [];
      try {
        live = d.liveSessions(a.profile);
      } catch {
        live = [];
      }
      const s = live.find((x) => x.sessionId === a.sessionId);
      if (!s) {
        delete all[k];
        changed = true;
        d.notify({ kind: "info", title: `Switch to ${a.target} dropped`, message: `The session on ${a.profile} ended before its turn did — nothing switched.`, key: `arm:${a.profile}` });
        d.activity(`claude/${a.profile}`, `armed switch to ${a.target} dropped`, "the session ended — nothing switched", true);
        continue;
      }
      if (isIdleEdge(a.lastStatus, s.status)) {
        delete all[k];
        changed = true;
        due.push(a);
        continue;
      }
      if (s.status !== a.lastStatus && s.status !== null) {
        all[k] = { ...a, lastStatus: s.status };
        changed = true;
      }
    }
    if (changed) save(all, d.file);
  });

  for (const a of due) {
    d.log(`arm: claude/${a.profile} turn ended — switching to ${a.target}`);
    try {
      await d.rebind({ account: a.target, profile: a.profile });
      // The session keeps its conversation; one message makes it carry on.
      const sent = d.continueSession?.(`claude/${a.profile}/${a.sessionId}`);
      const next = sent === true ? "It carries on by itself." : "Type one message in its terminal to continue.";
      if (sent !== undefined && sent !== true) d.log(`arm: claude/${a.profile} not continued automatically: ${sent}`);
      d.notify({ kind: "success", title: `${a.profile} now runs on ${a.target}`, message: `Switched when the turn ended, as you armed it. ${next}`, key: `arm:${a.profile}` });
      d.activity(`claude/${a.profile}`, `now serves ${a.target}'s account`, "the armed switch ran when the turn ended", true);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      d.log(`arm: claude/${a.profile} → ${a.target} refused: ${why}`);
      d.notify({ kind: "warning", title: `Switch to ${a.target} did not run`, message: `${a.profile} stays on its account. ${why}`, key: `arm:${a.profile}` });
      d.activity(`claude/${a.profile}`, `armed switch to ${a.target} refused`, why, false);
    }
  }
  return due.map((a) => a.profile);
}
