import { cn } from "../lib/utils.js";
import { SESSION_STATE_LABEL } from "../vm/rules.js";
import type { SessionState } from "../vm/types.js";

const LOOK: Record<SessionState, { color: string; shape: "dot" | "ring" | "pause" }> = {
  working: { color: "text-ac-ok", shape: "dot" },
  waiting: { color: "text-ac-muted", shape: "ring" },
  "needs-you": { color: "text-ac-warn", shape: "dot" },
  "pause-requested": { color: "text-ac-warn", shape: "ring" },
  parked: { color: "text-ac-soft", shape: "pause" },
  "auth-paused": { color: "text-ac-warn", shape: "pause" },
  idle: { color: "text-ac-faint", shape: "ring" },
  done: { color: "text-ac-faint", shape: "dot" },
};

/** Bundle `Ms` + `q3`. Working pulses (off under reduced motion). */
export function SessionStateIcon({ state, withLabel }: { state: SessionState; withLabel?: boolean }) {
  const look = LOOK[state];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", look.color)}>
      {look.shape === "dot" && (
        <span className={cn("size-2 rounded-full bg-current", state === "working" && "ac-pulse")} aria-hidden />
      )}
      {look.shape === "ring" && <span className="size-2 rounded-full border-[1.5px] border-current" aria-hidden />}
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
