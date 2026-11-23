/**
 * What a live session is doing, and who said so
 * (road-to-a-tree-that-reads-at-a-glance Phase 1, D1–D3).
 *
 * Source order: a wait the hooks or the transcript reported, then the host
 * registry's own word, then the program's own OSC 7501 report (a hosted Codex
 * window; `done` and `error` end the turn, `blocked` waits for the user), then
 * the transcript's write time. A lower source speaks
 * only where the higher one is silent, and `source` names the one that spoke so
 * the window can say it. Evidence for the registry words:
 * agents/evidence/registry-status-across-a-turn-2026-11.md.
 */

export type RuntimeStateName = "needs-you" | "working" | "idle";
export type RuntimeSource = "hook" | "host" | "program" | "transcript";

export interface RuntimeState {
  state: RuntimeStateName;
  source: RuntimeSource;
  /** Epoch ms of the evidence the state rests on. */
  observedAt: number;
  /** D3: the host still says busy, but neither it nor the transcript changed for {@link UNCONFIRMED_AFTER_MS}. */
  unconfirmed?: true;
}

/** A live session written to within this window counts as working (the old rule, now the last fallback). */
export const TRANSCRIPT_FRESH_MS = 60_000;
/** D3: ten silent minutes under a `busy` are worth a look; a long build is still real work. */
export const UNCONFIRMED_AFTER_MS = 10 * 60_000;

export interface RuntimeInput {
  live: boolean;
  waiting?: boolean;
  hostStatus?: string;
  hostStatusAt?: number;
  /** The program's own OSC 7501 report (a hosted Codex window): idle, working, done, blocked, error. */
  programState?: string;
  programAt?: number;
  mtimeMs: number;
}

/**
 * The runtime state of a live session; null for one that is not live (it has
 * no runtime, and the caller shows it as ended). Pure.
 *
 * Registry words (Claude Code 2.1.316): `busy` while a turn runs, held through
 * tool calls and compaction; `waiting` at a permission prompt, also one a
 * subagent raised; `idle` once the turn ends or is interrupted; `shell` once it
 * ends with a background shell still running — the model waits for nothing, so
 * it reads idle. `statusUpdatedAt` moves only when the word changes, never during
 * a long turn. An unknown word is treated as silence.
 */
export function runtimeState(row: RuntimeInput, now: number): RuntimeState | null {
  if (!row.live) return null;
  if (row.waiting) return { state: "needs-you", source: "hook", observedAt: row.mtimeMs };
  const at = row.hostStatusAt ?? row.mtimeMs;
  if (row.hostStatus === "waiting") return { state: "needs-you", source: "host", observedAt: at };
  if (row.hostStatus === "busy") {
    const last = Math.max(at, row.mtimeMs);
    return now - last > UNCONFIRMED_AFTER_MS ? { state: "working", source: "host", observedAt: last, unconfirmed: true } : { state: "working", source: "host", observedAt: at };
  }
  if (row.hostStatus === "idle" || row.hostStatus === "shell") return { state: "idle", source: "host", observedAt: at };
  const pAt = row.programAt ?? row.mtimeMs;
  if (row.programState === "blocked") return { state: "needs-you", source: "program", observedAt: pAt };
  if (row.programState === "working") {
    const last = Math.max(pAt, row.mtimeMs);
    return now - last > UNCONFIRMED_AFTER_MS ? { state: "working", source: "program", observedAt: last, unconfirmed: true } : { state: "working", source: "program", observedAt: pAt };
  }
  if (row.programState === "idle" || row.programState === "done" || row.programState === "error") return { state: "idle", source: "program", observedAt: pAt };
  const fresh = now - row.mtimeMs;
  return { state: fresh >= 0 && fresh <= TRANSCRIPT_FRESH_MS ? "working" : "idle", source: "transcript", observedAt: row.mtimeMs };
}
