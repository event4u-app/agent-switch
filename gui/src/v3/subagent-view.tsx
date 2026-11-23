/**
 * One subagent, opened from its row (7.7; arena r1 04-subagents F1): its own
 * transcript, read-only, in place of the parent session's body, with the tool
 * it runs now and how long it ran. "Back" returns to the parent. Nothing here
 * types into the subagent — it runs inside its session.
 */

import type { ReactNode } from "react";
import { ArrowLeft, Bot } from "lucide-react";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { subagentElapsed, type ChildModel } from "./sessions.js";

export function SubagentView({ c, parentTitle, nowMs, onBack, children }: { c: ChildModel; parentTitle: string; nowMs: number; onBack: () => void; children: ReactNode }) {
  const elapsed = subagentElapsed(c, nowMs);
  const running = c.state === "working";
  return (
    <section aria-label="Subagent" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b border-ac-line bg-ac-panel px-2">
        <button type="button" onClick={onBack} className="inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-[12px] text-ac-muted hover:bg-ac-raise hover:text-ac-text">
          <ArrowLeft className="size-3.5 shrink-0" />
          <span className="truncate">Back to {parentTitle}</span>
        </button>
        <span className="h-4 w-px shrink-0 bg-ac-line" />
        <SessionStateIcon state={c.state} />
        <Bot className="size-3.5 shrink-0 text-ac-muted" aria-hidden />
        <span className="min-w-0 truncate text-[12.5px] font-medium text-ac-text" title={c.label}>
          {c.label}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-ac-muted">
          {running && c.doing && (
            <span className="max-w-[280px] truncate font-ac-mono text-ac-soft" title={`Running now: ${c.doing}`}>
              {c.doing}
            </span>
          )}
          {elapsed && <span title={running ? "Running for" : "Ran for"}>{running ? `running ${elapsed}` : `ran ${elapsed}`}</span>}
          <span className="rounded-md border border-ac-line px-1.5 py-px">read-only</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ac-bg px-6 py-4">{children}</div>
    </section>
  );
}
