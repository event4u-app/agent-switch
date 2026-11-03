/**
 * One hook event, taken in. Shared by the two paths a hook can reach Agent
 * Switch on: the engine's `hook` op (fed by the `as-hook` relay) and the
 * `__hook-event` CLI fallback when no engine answers. Both write the same ring
 * line and the same notice, so a reader cannot tell which path an event took.
 *
 * Acknowledgement point (road-to-agent-switch-v3-central M2, decision E1): an
 * event is acknowledged only once it is durably stored — its ring line written
 * and, on the engine path, its store row committed. "Received by the socket" is
 * not an acknowledgement, because a relay that exits on it can lose the event
 * when the engine dies before writing. "Durable" means handed to the OS (the
 * write returned), the same promise the 2.x ring append made; there is no fsync
 * per event. Once the ring line is written the answer is "stored", even if the
 * store row fails — the ring import retries it, and a relay that heard an error
 * would fall back and write the line twice.
 */

import * as path from "node:path";

import {
  appendEvent,
  clearedFrom,
  eventFile,
  hookNotice,
  lineageFromEnv,
  pidFrom,
  profileFromConfigDir,
  readEvents,
  recordFromPayload,
  type HookEventRecord,
} from "./hooks.js";
import { appendNotification } from "./notifications.js";

/** The hook environment the relay forwards. Nothing else from the env leaves the hook. */
export const HOOK_ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_PID",
  "AGENT_SWITCH_PARENT_SESSION",
  "AGENT_SWITCH_PARENT_KIND",
  "AGENT_SWITCH_PARENT_LABEL",
  "AGENT_SWITCH_PARENT_AGENT",
  "AGENT_SWITCH_HOST_PANE",
] as const;

export interface TakenIn {
  provider: string;
  account: string;
  record: HookEventRecord;
  /** The exact ring line, which the store keys its import on. */
  line: string;
}

/** Write one hook payload to its account's ring and raise its notice. Null when it belongs to no account here. */
export function takeInHook(payload: unknown, env: Record<string, string | undefined>, root: string, now = new Date()): TakenIn | null {
  const cfg = env.CLAUDE_CONFIG_DIR;
  if (!cfg) return null;
  const who = profileFromConfigDir(cfg, root);
  if (!who) return null;
  const rec = recordFromPayload(payload, now.toISOString());
  const file = eventFile(root, who.provider, who.profile);
  if (rec.event === "SessionStart") {
    const hostPid = pidFrom(env.CLAUDE_PID);
    if (hostPid) rec.hostPid = hostPid;
    const cleared = clearedFrom(rec, rec.source === "clear" ? readEvents(file) : []);
    const lineage = cleared
      ? ({ parent: `${who.provider}/${who.profile}/${cleared}`, kind: "cleared", source: "hook" } as const)
      : lineageFromEnv(env, rec.sessionId, rec.sessionId ? `${who.provider}/${who.profile}/${rec.sessionId}` : undefined);
    if (lineage) rec.lineage = lineage;
  }
  appendEvent(file, rec);
  // Session awareness: each turn is a distinct moment, so never deduplicated.
  try {
    const notice = hookNotice(rec, who);
    if (notice) appendNotification(notice, now.getTime(), path.join(root, "notifications.json"), false);
  } catch {
    // the event is stored; a lost notice must not make a caller write it twice
  }
  return { provider: who.provider, account: who.profile, record: rec, line: JSON.stringify(rec) };
}
