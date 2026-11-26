/**
 * Names for arena runs and the decision they reach (owner, 2026-11-26).
 *
 * A run keeps its id: the folder name, the key every engine step, workflow match and IPC call uses. Beside
 * it, `name.json` in the run folder carries a **name** a person recognises and a one-line **decision** that
 * says what was chosen, not only who won. agent-config's engine never reads or rewrites it, so it survives
 * every step and a resume.
 *
 * Two writers share the file, the agent (`agent-switch arena name|decide`) and the user (the GUI). Each field
 * records who set it; an agent never replaces what the user set unless forced.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const NAME_MAX = 120;
export const DECISION_MAX = 160;
export const META_FILE = "name.json";
export const META_BYTES = 4 * 1024;

export type MetaBy = "user" | "agent";
export type RunField = "name" | "decision";

export interface MetaEntry {
  text: string;
  by: MetaBy;
  at: string;
  /** A decision is about one champion: a resume or an appeal that crowns another makes it stale. */
  champion?: string;
}

export interface RunMeta {
  v: 1;
  name?: MetaEntry;
  decision?: MetaEntry;
}

/** Control, zero-width, line-separator and bidi-override characters: never shown, never stored. */
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]", "g");

/** One line of plain text: control characters dropped, whitespace collapsed, trimmed. Pure. */
export function cleanText(s: string): string {
  return s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

const entryOf = (v: unknown): MetaEntry | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const text = typeof o.text === "string" ? cleanText(o.text).slice(0, DECISION_MAX) : "";
  if (!text) return undefined;
  return {
    text,
    by: o.by === "user" ? "user" : "agent",
    at: typeof o.at === "string" ? o.at : "",
    ...(typeof o.champion === "string" && o.champion ? { champion: o.champion } : {}),
  };
};

/** `name.json` as read; anything unreadable is an empty record, never an error. Pure. */
export function parseRunMeta(text: string | null | undefined): RunMeta {
  if (!text) return { v: 1 };
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const name = entryOf(o.name);
    const decision = entryOf(o.decision);
    return { v: 1, ...(name ? { name } : {}), ...(decision ? { decision } : {}) };
  } catch {
    return { v: 1 };
  }
}

/**
 * Set or clear one field. Empty text clears it. Refused: an agent replacing the user's text (without `force`),
 * and text over the field's limit. Pure.
 */
export function setRunField(meta: RunMeta, field: RunField, text: string, by: MetaBy, at: string, opts: { force?: boolean; champion?: string | null } = {}): { meta: RunMeta; error?: string } {
  const max = field === "name" ? NAME_MAX : DECISION_MAX;
  const clean = cleanText(text);
  if (clean.length > max) return { meta, error: `the ${field} is ${clean.length} characters; at most ${max}` };
  if (by === "agent" && meta[field]?.by === "user" && !opts.force) return { meta, error: `the user set this ${field}; an agent keeps it (use --force to replace it)` };
  const next: RunMeta = { ...meta };
  if (!clean) delete next[field];
  else next[field] = { text: clean, by, at, ...(field === "decision" && opts.champion ? { champion: opts.champion } : {}) };
  return { meta: next };
}

/** The first `# ` heading of a markdown text, as one plain line; undefined when there is none. Pure. */
export function headingOf(md: string | null | undefined): string | undefined {
  const h = md ? /^#\s+(.+)$/m.exec(md)?.[1] : undefined;
  const t = h ? cleanText(h) : "";
  return t ? t.slice(0, DECISION_MAX) : undefined;
}

/**
 * What the board shows: the name in order user → agent → the task's title → the run id, and, once a champion
 * stands, the decision in order a recorded one for that champion → the champion's own heading → "L004 wins".
 * Pure.
 */
export function resolveNames(
  meta: RunMeta,
  o: { run: string; taskTitle?: string; champion: string | null; championHeading?: string },
): { name: string; nameBy: MetaBy | "task" | "id"; decision?: string; decisionBy?: MetaBy | "line" | "id" } {
  const name = meta.name?.text ?? o.taskTitle ?? o.run;
  const nameBy = meta.name?.by ?? (o.taskTitle ? "task" : "id");
  if (!o.champion) return { name, nameBy };
  const recorded = meta.decision && (!meta.decision.champion || meta.decision.champion === o.champion) ? meta.decision : undefined;
  if (recorded) return { name, nameBy, decision: recorded.text, decisionBy: recorded.by };
  if (o.championHeading) return { name, nameBy, decision: o.championHeading, decisionBy: "line" };
  return { name, nameBy, decision: `${o.champion} wins`, decisionBy: "id" };
}

/** Write `name.json` atomically (temp file, then rename), readable by its owner only. */
export function writeRunMeta(dir: string, meta: RunMeta): void {
  const file = path.join(dir, META_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
