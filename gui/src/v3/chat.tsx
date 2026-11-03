/** v3.1 chat view (spec §10.8), adapted from the reference board `v31.tsx`:
 *  the timeline of one session drawn from AS events. Read-only unless the
 *  caller passes the approval and question handlers (a bridged session). */

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, FolderGit2, Hand, ListChecks, MessageCircleQuestion, TriangleAlert } from "lucide-react";

import { cn } from "../lib/utils.js";
import { Button } from "../ui/Button.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { Act } from "./kit.js";
import { fold, type AsEvent, type ChatRow, type DiffHunk } from "./timeline.js";
import { VirtualList } from "./virtual.js";

export function Bubble({ children, images = 0 }: { children: ReactNode; images?: number }) {
  return (
    <div className="ml-auto w-fit max-w-[78%] whitespace-pre-wrap rounded-[10px] bg-ac-raise px-3.5 py-2 text-[13px] text-ac-text">
      {children}
      {images > 0 && <span className="mt-1 block text-[11px] text-ac-muted">{images === 1 ? "1 image" : `${images} images`}</span>}
    </div>
  );
}

export function DiffLines({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <div className="font-ac-mono text-[11.5px] leading-[1.55]">
      {hunks.map((h, hi) => {
        let oldN = h.oldStart;
        let newN = h.newStart;
        return h.lines.map((l, i) => {
          const k = l[0] === "+" ? "+" : l[0] === "-" ? "-" : " ";
          const n = k === "-" ? oldN++ : (k === " " && oldN++, newN++);
          return (
            <div key={`${hi}-${i}`} className="flex whitespace-pre px-3" style={{ background: k === "+" ? "var(--as-diff-add-line)" : k === "-" ? "var(--as-diff-del-line)" : undefined }}>
              <span className="w-8 shrink-0 select-none text-right text-ac-faint">{n}</span>
              <span className={cn("w-4 shrink-0 select-none text-center", k === "+" ? "text-ac-ok-text" : k === "-" ? "text-ac-alert-text" : "text-ac-faint")}>{k}</span>
              <span className="text-ac-soft">{l.slice(1)}</span>
            </div>
          );
        });
      })}
    </div>
  );
}

const TONE = { running: "bg-ac-info", ok: "bg-ac-ok", failed: "bg-ac-alert" } as const;
/** The verb a tool card shows for an edit: the design calls it "Update". */
const shown = (name: string) => (name === "Edit" || name === "MultiEdit" || name === "Write" ? "Update" : name);

export function ToolCard({ row }: { row: Extract<ChatRow, { k: "tool" }> }) {
  const hasDiff = row.diffs.some((d) => d.hunks.length);
  const [open, setOpen] = useState(false);
  const counts = row.diffs.length ? ` +${row.diffs.reduce((n, d) => n + d.added, 0)} −${row.diffs.reduce((n, d) => n + d.removed, 0)}` : "";
  const arg = `${row.summary}${counts}${!hasDiff && row.result ? `  ${row.result}` : ""}`;
  return (
    <div className="overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
      <button type="button" aria-expanded={hasDiff ? open : undefined} disabled={!hasDiff} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs">
        {open ? <ChevronDown className="size-3.5 text-ac-faint" /> : <ChevronRight className={cn("size-3.5", hasDiff ? "text-ac-faint" : "text-transparent")} />}
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE[row.state])} aria-label={row.state} />
        <span className="shrink-0 font-semibold text-ac-text">{shown(row.name)}</span>
        <span className="min-w-0 truncate font-ac-mono text-[11.5px] text-ac-muted">{arg}</span>
      </button>
      {open && hasDiff && (
        <div className="border-t border-ac-line">
          {row.diffs.map((d) => (
            <DiffLines key={d.path} hunks={d.hunks} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SubagentRow({ row, worktree }: { row: Extract<ChatRow, { k: "subagent" }>; worktree?: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-ac-line bg-ac-panel px-3 py-1.5 text-xs">
      <SessionStateIcon state={row.state === "running" ? "working" : "done"} />
      <span className="font-semibold text-ac-text">Task</span>
      <span className="min-w-0 truncate text-ac-muted">
        {row.type} · {row.description}
      </span>
      {row.state === "failed" && <span className="shrink-0 text-[11px] text-ac-alert-text">failed</span>}
      {worktree && (
        <span className="inline-flex shrink-0 items-center gap-1 font-ac-mono text-[11px] text-ac-violet-text" title="The subagent's own worktree, from its hook">
          <FolderGit2 className="size-3" />
          {worktree}
        </span>
      )}
      <span className="ml-auto shrink-0 text-[10.5px] text-ac-faint">subagent · via hook</span>
    </div>
  );
}

export function ApprovalCard({ row, onAllow, onAlways, onDeny }: { row: Extract<ChatRow, { k: "approval" }>; onAllow?: () => void; onAlways?: () => void; onDeny?: () => void }) {
  if (row.resolved)
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-ac-line bg-ac-panel px-3 py-1.5 text-xs text-ac-muted">
        <Hand className="size-3.5" /> {row.tool} {row.resolved === "allow" ? "allowed" : "denied"}
        <span className="min-w-0 truncate font-ac-mono text-[11px]">{row.summary}</span>
      </div>
    );
  const verb = row.tool === "Bash" ? "run a command" : row.tool === "Write" || row.tool === "Edit" ? "change a file" : `use ${row.tool}`;
  return (
    <div className="rounded-[10px] border border-ac-warn bg-ac-warn-tint p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ac-warn-text">
        <Hand className="size-4" /> Claude wants to {verb}
      </div>
      <div className="mt-2 break-all rounded-md border border-ac-line bg-ac-bg px-2.5 py-1.5 font-ac-mono text-xs text-ac-text">{row.summary || row.tool}</div>
      {onAllow && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Act kind="accent" kbd="↵" onClick={onAllow}>
            <Check /> Allow once
          </Act>
          {onAlways && (
            <Button size="sm" onClick={onAlways}>
              Always allow “{row.summary.split(" ")[0] || row.tool}”
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={onDeny}>
            Deny
          </Button>
          <span className="ml-auto text-[11px] text-ac-muted">Same rule as the terminal prompt · never bypassed</span>
        </div>
      )}
    </div>
  );
}

export function QuestionCard({ row, onAnswer }: { row: Extract<ChatRow, { k: "question" }>; onAnswer?: (answers: Record<string, string>) => void }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const choose = (q: string, o: string) => {
    const next = { ...picked, [q]: o };
    setPicked(next);
    // One pick per question; the answers go together once each question has one.
    if (onAnswer && row.questions.every((x) => next[x.question])) onAnswer(next);
  };
  return (
    <div className="rounded-[10px] border border-ac-info bg-ac-info-tint p-3 text-[13px]">
      {row.questions.map((q) => (
        <div key={q.question} className="mb-2 last:mb-0">
          <div className="flex items-center gap-2 font-medium text-ac-info-text">
            <MessageCircleQuestion className="size-4" /> {q.question}
          </div>
          <div role="radiogroup" aria-label={q.question} className="mt-1.5 flex flex-wrap gap-1.5">
            {q.options.map((o) => (
              <Button key={o} size="sm" role="radio" aria-checked={picked[q.question] === o} variant={picked[q.question] === o ? "primary" : undefined} disabled={!onAnswer} onClick={() => choose(q.question, o)}>
                {picked[q.question] === o && <Check />}
                {o}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatRowView({ row, on }: { row: ChatRow; on: ChatHandlers }) {
  switch (row.k) {
    case "user":
      return <Bubble images={row.images}>{row.text}</Bubble>;
    case "assistant":
      return <p className={cn("max-w-[86%] whitespace-pre-wrap text-[13px] leading-relaxed text-ac-soft", row.live && "after:ml-0.5 after:animate-pulse after:content-['▍']")}>{row.text}</p>;
    case "tool":
      return <ToolCard row={row} />;
    case "subagent":
      return <SubagentRow row={row} worktree={row.agentId ? on.worktreeOf?.(row.agentId) : null} />;
    case "approval":
      return <ApprovalCard row={row} onAllow={on.approve && (() => on.approve!(row.id, false))} onAlways={on.approve && (() => on.approve!(row.id, true))} onDeny={on.deny && (() => on.deny!(row.id))} />;
    case "question":
      return <QuestionCard row={row} onAnswer={on.answer && ((a) => on.answer!(row.id, a))} />;
    case "plan":
      return (
        <div className="rounded-[10px] border border-ac-line bg-ac-panel px-3 py-2 text-[13px] text-ac-soft">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-ac-text">
            <ListChecks className="size-3.5" /> Plan
          </div>
          <div className="whitespace-pre-wrap">{row.text}</div>
        </div>
      );
    case "error":
      return (
        <div role="alert" className="flex items-center gap-2 rounded-[10px] border border-ac-alert bg-ac-alert-tint px-3 py-1.5 text-xs text-ac-alert-text">
          <TriangleAlert className="size-3.5" /> {row.message}
        </div>
      );
  }
}

export interface ChatHandlers {
  approve?: (id: string, always: boolean) => void;
  deny?: (id: string) => void;
  answer?: (id: string, answers: Record<string, string>) => void;
  /** A subagent's worktree name from its hook record, when it has one. */
  worktreeOf?: (agentId: string) => string | null;
}

/** The timeline of one session. `notice` sits above it (version or read-only banner). */
export function ChatTimeline({ events, on = {}, notice }: { events: readonly AsEvent[]; on?: ChatHandlers; notice?: ReactNode }) {
  const f = useMemo(() => fold(events), [events]);
  const hiddenCount = Object.values(f.hidden).reduce((a, b) => a + b, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {notice}
      {f.rows.length === 0 ? (
        <p className="m-auto text-[13px] text-ac-muted">Nothing in this session yet.</p>
      ) : (
        <VirtualList label="Conversation" className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4" items={f.rows} keyOf={(r) => `${r.k}:${r.id}`} render={(r) => <ChatRowView row={r} on={on} />} />
      )}
      {hiddenCount > 0 && (
        <p className="shrink-0 px-6 pb-1 text-right text-[10.5px] text-ac-faint" title={Object.entries(f.hidden).map(([k, n]) => `${k}: ${n}`).join("\n")}>
          {hiddenCount} internal {hiddenCount === 1 ? "line" : "lines"} not shown
        </p>
      )}
    </div>
  );
}
