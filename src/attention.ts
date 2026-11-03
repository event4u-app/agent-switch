/**
 * The attention queue (spec §5.1, §7.4; road-to-agent-switch-v3-central Phase 1):
 * one ordered list of everything that waits for the user, derived from live
 * state every time it is read. Because it is derived, an answer given anywhere —
 * the terminal, the app, the tray — clears the item everywhere on the next read.
 *
 * Kept on disk (`<root>/attention.json`, 0600) is only what the user decided and
 * what already happened: "Later" (snoozed until the item changes), the items
 * that left the queue (the 2.11 activity history), and when the queue was last
 * looked at (for the "while you were away" digest).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const KINDS = ["approval", "question", "limit", "ci", "signin", "update"] as const;
export type Kind = (typeof KINDS)[number];

const VERB: Record<Kind, string> = { approval: "Allow", question: "Reply", limit: "Decide", ci: "Fix", signin: "Sign in", update: "Update" };

export interface Candidate {
  kind: Kind;
  /** What it is about: a session key, an account, a tool. */
  subject: string;
  /** Who, for the row: a session title or an account name. */
  who: string;
  /** What, a short verb phrase: "wants to run a command", "94% of 5h". */
  what: string;
  /** One line of detail, e.g. the command waiting for approval. */
  detail?: string;
  /** Since when it waits (ISO). */
  since: string;
  /** Changes when the item changes, so a snoozed item comes back. */
  version: string;
  /** Overrides the kind's verb, e.g. "Focus terminal" where AS cannot answer (D-approve). */
  verb?: string;
}

export interface Item extends Candidate {
  id: string;
  verb: string;
}

export interface HistoryEntry {
  id: string;
  kind: Kind;
  who: string;
  what: string;
  doneAt: string;
}

export interface AttentionState {
  /** id → the version that was snoozed. */
  snoozed: Record<string, string>;
  /** The queue as last read, so a vanished item becomes history. */
  last: Record<string, { kind: Kind; who: string; what: string }>;
  history: HistoryEntry[];
  lastSeenAt: string | null;
}

export const HISTORY_CAP = 200;
/** Away at least this long → one "while you were away" row. */
export const AWAY_MS = 2 * 3600_000;

export const itemId = (kind: Kind, subject: string) => crypto.createHash("sha256").update(`${kind}\0${subject}`).digest("hex").slice(0, 12);

/** Order and shape the candidates, leaving out what is snoozed at its current version. Pure. */
export function buildQueue(candidates: readonly Candidate[], state: AttentionState): Item[] {
  return candidates
    .map((c) => ({ ...c, id: itemId(c.kind, c.subject), verb: c.verb ?? VERB[c.kind] }))
    .filter((i) => state.snoozed[i.id] !== i.version)
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}

/**
 * Fold one read of the queue into the stored state: items that left the queue
 * become history, snoozes of items that are gone or changed are dropped, and
 * the read is remembered. Pure.
 */
export function afterRead(state: AttentionState, items: readonly Item[], allIds: ReadonlySet<string>, now: string): AttentionState {
  const history = [...state.history];
  for (const [id, prev] of Object.entries(state.last)) {
    if (!allIds.has(id)) history.push({ id, kind: prev.kind, who: prev.who, what: prev.what, doneAt: now });
  }
  const snoozed: Record<string, string> = {};
  for (const [id, v] of Object.entries(state.snoozed)) if (allIds.has(id)) snoozed[id] = v;
  return {
    snoozed,
    last: Object.fromEntries(items.map((i) => [i.id, { kind: i.kind, who: i.who, what: i.what }])),
    history: history.slice(-HISTORY_CAP),
    lastSeenAt: now,
  };
}

/** "Later": hide an item until it changes. */
export function snooze(state: AttentionState, item: Pick<Item, "id" | "version">): AttentionState {
  return { ...state, snoozed: { ...state.snoozed, [item.id]: item.version } };
}

export interface Digest {
  since: string;
  finishedTurns: number;
  stoppedOnError: number;
  resolved: number;
  mergedPrs: number;
  ciBreaks: number;
}

/** One digest row after a long absence, never several. Pure. */
export function digest(state: AttentionState, now: string, events: readonly { event: string; at: string }[], prs: readonly { lifecycle: string; ci: string; updatedAt: string }[] = []): Digest | null {
  if (!state.lastSeenAt || Date.parse(now) - Date.parse(state.lastSeenAt) < AWAY_MS) return null;
  const since = state.lastSeenAt;
  const after = (at: string) => at > since;
  const d: Digest = {
    since,
    finishedTurns: events.filter((e) => e.event === "Stop" && after(e.at)).length,
    stoppedOnError: events.filter((e) => e.event === "StopFailure" && after(e.at)).length,
    resolved: state.history.filter((h) => after(h.doneAt)).length,
    mergedPrs: prs.filter((p) => p.lifecycle === "MERGED" && after(p.updatedAt)).length,
    ciBreaks: prs.filter((p) => p.lifecycle === "OPEN" && p.ci === "FAILURE" && after(p.updatedAt)).length,
  };
  return d.finishedTurns + d.stoppedOnError + d.resolved + d.mergedPrs + d.ciBreaks > 0 ? d : null;
}

export const emptyState = (): AttentionState => ({ snoozed: {}, last: {}, history: [], lastSeenAt: null });

export function attentionFile(root: string): string {
  return path.join(root, "attention.json");
}

export function readAttention(file: string): AttentionState {
  try {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...emptyState(), ...o };
  } catch {
    return emptyState();
  }
}

export function writeAttention(file: string, state: AttentionState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
