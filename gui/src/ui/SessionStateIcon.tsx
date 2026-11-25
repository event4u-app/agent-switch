import { cn } from "../lib/utils.js";
import { SESSION_STATE_LABEL } from "../vm/rules.js";
import type { SessionState } from "../vm/types.js";

/**
 * One mark per state. The quiet states each get a shape of their own, so they
 * read apart without colour: waiting is a ring around a dot (something is
 * pending), idle a plain ring, recent a dashed ring (written lately, not proven
 * live).
 */
const LOOK: Record<SessionState, { color: string; shape: "dot" | "ring" | "target" | "dashed" | "pause" }> = {
  working: { color: "text-ac-ok", shape: "dot" },
  waiting: { color: "text-ac-soft", shape: "target" },
  "needs-you": { color: "text-ac-warn", shape: "dot" },
  "pause-requested": { color: "text-ac-warn", shape: "ring" },
  parked: { color: "text-ac-soft", shape: "pause" },
  "auth-paused": { color: "text-ac-warn", shape: "pause" },
  idle: { color: "text-ac-faint", shape: "ring" },
  recent: { color: "text-ac-muted", shape: "dashed" },
  done: { color: "text-ac-faint", shape: "dot" },
};

export type StateSource = "hook" | "host" | "program" | "transcript" | "children";

/** Who reported a state, for the dot's tooltip (spec §3.3). */
export const STATE_SOURCE_TEXT: Record<StateSource, string> = {
  hook: "from the last hook",
  host: "from Claude Code",
  program: "from Codex",
  transcript: "from the transcript time",
  children: "from the agents running under it",
};

/**
 * Bundle `Ms` + `q3`. Working pulses (off under reduced motion), except while
 * `quiet`: the host still says busy but nothing changed for a while (D3).
 * The tooltip always names the state; with a `source`, also who reported it.
 */
export function SessionStateIcon({ state, withLabel, source, quiet }: { state: SessionState; withLabel?: boolean; source?: StateSource | null; quiet?: boolean }) {
  const look = LOOK[state];
  return (
    <span data-shape={look.shape} className={cn("inline-flex shrink-0 items-center gap-1.5", look.color)} title={source ? `${SESSION_STATE_LABEL[state]} · ${STATE_SOURCE_TEXT[source]}` : SESSION_STATE_LABEL[state]}>
      {look.shape === "dot" && (
        <span className={cn("size-2 rounded-full bg-current", state === "working" && !quiet && "ac-pulse")} aria-hidden />
      )}
      {look.shape === "ring" && <span className="size-2 rounded-full border-[1.5px] border-current" aria-hidden />}
      {look.shape === "dashed" && <span className="size-2 rounded-full border border-dashed border-current" aria-hidden />}
      {look.shape === "target" && (
        <span className="inline-flex size-2 items-center justify-center rounded-full border border-current" aria-hidden>
          <span className="size-[3px] rounded-full bg-current" />
        </span>
      )}
      {look.shape === "pause" && (
        <span className="inline-flex h-2 w-2 justify-between" aria-hidden>
          <span className="h-2 w-[3px] rounded-[1px] bg-current" />
          <span className="h-2 w-[3px] rounded-[1px] bg-current" />
        </span>
      )}
      {withLabel ? (
        <span className="text-xs font-medium">{SESSION_STATE_LABEL[state]}</span>
      ) : (
        <span className="sr-only">{SESSION_STATE_LABEL[state]}</span>
      )}
    </span>
  );
}
