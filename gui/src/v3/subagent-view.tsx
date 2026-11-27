/**
 * One subagent, opened from its row (7.7; arena r1 04-subagents F1): its own
 * transcript, read-only, in place of the parent session's body, with the tool
 * it runs now and how long it ran. "Back" returns to the parent. Nothing here
 * types into the subagent — it runs inside its session.
 */

import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { SubviewBar } from "./workbench.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { subagentElapsed, type ChildModel } from "./sessions.js";

/** At the top of a subagent's transcript when only its end is shown: what it was asked is the first thing to drop out. */
export function EarlierNotShown() {
  return (
    <p role="status" className="shrink-0 border-b border-ac-line bg-ac-raise px-4 py-1.5 text-xs text-ac-muted">
      Earlier steps not shown — this is the end of a long run, so its task and first steps are left out.
    </p>
  );
}

export function SubagentView({ c, parentTitle, nowMs, onBack, children }: { c: ChildModel; parentTitle: string; nowMs: number; onBack: () => void; children: ReactNode }) {
  const elapsed = subagentElapsed(c, nowMs);
  const running = c.state === "working";
  return (
    <section aria-label="Subagent" className="flex min-h-0 flex-1 flex-col">
      {/* The same bar as the review's: a sub-view of the session, with the way back (owner, 2026-11-27). */}
      <SubviewBar parentTitle={parentTitle} onBack={onBack} icon={<><SessionStateIcon state={c.state} /><Bot className="size-3.5 shrink-0 text-ac-muted" aria-hidden /></>} label={c.label}>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-ac-muted">
          {running && c.doing && (
            <span className="max-w-[280px] truncate font-ac-mono text-ac-soft" title={`Running now: ${c.doing}`}>
              {c.doing}
            </span>
          )}
          {elapsed && <span title={running ? "Running for" : "Ran for"}>{running ? `running ${elapsed}` : `ran ${elapsed}`}</span>}
          <span className="rounded-md border border-ac-line px-1.5 py-px">read-only</span>
        </span>
      </SubviewBar>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ac-bg px-6 py-4">{children}</div>
    </section>
  );
}
