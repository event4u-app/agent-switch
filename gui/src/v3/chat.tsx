/** v3.1 chat view (spec §10.8), adapted from the reference board `v31.tsx`:
 *  the timeline of one session drawn from AS events. Read-only unless the
 *  caller passes the approval and question handlers (a bridged session). */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, FolderGit2, Hand, ListChecks, MessageCircleQuestion, TriangleAlert } from "lucide-react";

import { cn } from "../lib/utils.js";
import { Button } from "../ui/Button.js";
import { TextInput } from "../ui/TextInput.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { sessionMarkdown } from "./chat-export.js";
import { Act } from "./kit.js";
import { Markdown } from "./markdown/Markdown.js";
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

/** `numbered={false}`: the hunks carry no real line numbers (a diff typed into a
 *  message without `@@` headers), so none are shown. */
export function DiffLines({ hunks, numbered = true }: { hunks: DiffHunk[]; numbered?: boolean }) {
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
              {numbered && <span className="w-8 shrink-0 select-none text-right text-ac-faint">{n}</span>}
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

/** Where a read-only card is answered, when the caller says nothing else. */
export const IN_TERMINAL = "Answer it in the terminal.";

export function ApprovalCard({ row, agent = "Claude", unanswerable = IN_TERMINAL, onAllow, onAlways, onDeny }: { row: Extract<ChatRow, { k: "approval" }>; agent?: string; unanswerable?: string; onAllow?: () => void; onAlways?: () => void; onDeny?: () => void }) {
  const [focused, setFocused] = useState(false);
  if (row.resolved)
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-ac-line bg-ac-panel px-3 py-1.5 text-xs text-ac-muted">
        <Hand className="size-3.5" /> {row.tool} {row.resolved === "allow" ? "allowed" : "denied"}
        <span className="min-w-0 truncate font-ac-mono text-[11px]">{row.summary}</span>
      </div>
    );
  const verb = row.tool === "Bash" ? "run a command" : row.tool === "Write" || row.tool === "Edit" ? "change a file" : `use ${row.tool}`;
  const title = `${agent} wants to ${verb}`;
  return (
    <div
      role="group"
      aria-label={title}
      tabIndex={onAllow ? 0 : undefined}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}
      // ↵ on the card itself allows once; on a button, the button's own Enter does what it says.
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onAllow && (e.preventDefault(), onAllow())}
      className="rounded-[10px] border border-ac-warn bg-ac-warn-tint p-3 outline-none focus-visible:border-ac-brand-line"
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-ac-warn-text">
        <Hand className="size-4" /> {title}
      </div>
      <div className="mt-2 break-all rounded-md border border-ac-line bg-ac-bg px-2.5 py-1.5 font-ac-mono text-xs text-ac-text">{row.summary || row.tool}</div>
      {onAllow ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {/* The key is printed only while it works: when the card has focus. */}
          <Act kind="accent" kbd={focused ? "↵" : undefined} onClick={onAllow}>
            <Check /> Allow once
          </Act>
          {onAlways && row.rule && (
            <Button size="sm" onClick={onAlways} title={`Adds this rule, as the terminal prompt would: ${row.rule}`}>
              Always: {row.rule}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={onDeny}>
            Deny
          </Button>
          <span className="ml-auto text-[11px] text-ac-muted">Same rule as the terminal prompt · never bypassed</span>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ac-muted">{unanswerable}</p>
      )}
    </div>
  );
}

/** One answer per question: the typed Other wins over the picks; several picks join with ", ". Pure. */
export function answerOf(picked: readonly string[] | undefined, other: string | undefined): string {
  return other?.trim() || (picked ?? []).join(", ");
}

export function QuestionCard({ row, unanswerable = IN_TERMINAL, onAnswer, onSkip }: { row: Extract<ChatRow, { k: "question" }>; unanswerable?: string; onAnswer?: (answers: Record<string, string>) => void; onSkip?: () => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  if (row.resolved)
    return (
      <div data-answered="" className="rounded-[10px] border border-ac-line bg-ac-panel px-3 py-1.5 text-xs text-ac-muted">
        {row.questions.map((q) => (
          <div key={q.question} className="flex items-center gap-2">
            <MessageCircleQuestion className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{q.question}</span>
            {row.resolved?.answers ? <span className="shrink-0 font-medium text-ac-text">{row.resolved.answers[q.question] ?? "—"}</span> : <span className="shrink-0">Not answered</span>}
          </div>
        ))}
      </div>
    );
  const all = (p: Record<string, string[]>, o: Record<string, string>) => Object.fromEntries(row.questions.map((q) => [q.question, answerOf(p[q.question], o[q.question])]));
  const complete = (a: Record<string, string>) => row.questions.every((q) => a[q.question]);
  const send = (p = picked, o = other) => {
    const a = all(p, o);
    if (onAnswer && complete(a)) onAnswer(a);
  };
  const choose = (q: string, o: string, multi: boolean) => {
    const cur = picked[q] ?? [];
    const next = { ...picked, [q]: multi ? (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]) : [o] };
    const nextOther = { ...other, [q]: "" };
    setPicked(next);
    setOther(nextOther);
    // Single picks on every question go at once; several picks wait for Answer.
    if (!row.questions.some((x) => x.multiSelect)) send(next, nextOther);
  };
  return (
    <div className="rounded-[10px] border border-ac-info bg-ac-info-tint p-3 text-[13px]">
      {row.questions.map((q) => (
        <div key={q.question} className="mb-2.5 last:mb-0">
          <div className="flex items-center gap-2 font-medium text-ac-info-text">
            <MessageCircleQuestion className="size-4" /> {q.question}
            {q.multiSelect && <span className="text-[11px] font-normal text-ac-muted">pick any</span>}
          </div>
          <div role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question} className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o) && !other[q.question]?.trim();
              return (
                <Button key={o} size="sm" role={q.multiSelect ? "checkbox" : "radio"} aria-checked={on} variant={on ? "primary" : undefined} disabled={!onAnswer} onClick={() => choose(q.question, o, !!q.multiSelect)}>
                  {on && <Check />}
                  {o}
                </Button>
              );
            })}
            {onAnswer && (
              <TextInput
                aria-label={`Other answer to ${q.question}`}
                placeholder="Other…"
                className="w-[180px]"
                value={other[q.question] ?? ""}
                onChange={(e) => setOther({ ...other, [q.question]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), send())}
              />
            )}
          </div>
        </div>
      ))}
      {onAnswer ? (
        <div className="mt-2.5 flex items-center gap-2">
          <Button size="sm" variant="primary" disabled={!complete(all(picked, other))} onClick={() => send()}>
            Answer
          </Button>
          {onSkip && (
            <Button size="sm" variant="ghost" onClick={onSkip} title="Go on without an answer; the agent is told it was skipped">
              Skip
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ac-muted">{unanswerable}</p>
      )}
    </div>
  );
}

function ChatRowView({ row, on, agent }: { row: ChatRow; on: ChatHandlers; agent?: string }) {
  switch (row.k) {
    case "user":
      return <Bubble images={row.images}>{row.text}</Bubble>;
    case "assistant":
      return <Markdown source={row.text} live={row.live} className={cn("max-w-[86%]", row.live && "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:content-['▍']")} />;
    case "tool":
      return <ToolCard row={row} />;
    case "subagent":
      return <SubagentRow row={row} worktree={row.agentId ? on.worktreeOf?.(row.agentId) : null} />;
    case "approval":
      return <ApprovalCard row={row} agent={agent} unanswerable={on.unanswerable} onAllow={on.approve && (() => on.approve!(row.id, false))} onAlways={on.approve && (() => on.approve!(row.id, true))} onDeny={on.deny && (() => on.deny!(row.id))} />;
    case "question":
      return <QuestionCard row={row} unanswerable={on.unanswerable} onAnswer={on.answer && ((a) => on.answer!(row.id, a))} onSkip={on.skip && (() => on.skip!(row.id))} />;
    case "plan":
      return (
        <div className="rounded-[10px] border border-ac-line bg-ac-panel px-3 py-2 text-[13px] text-ac-soft">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-ac-text">
            <ListChecks className="size-3.5" /> Plan
          </div>
          <Markdown source={row.text} />
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
  /** Decline an open question: the agent goes on without an answer. */
  skip?: (id: string) => void;
  /** What an open card says when it cannot be answered here (read-only, not connected). */
  unanswerable?: string;
  /** A subagent's worktree name from its hook record, when it has one. */
  worktreeOf?: (agentId: string) => string | null;
}

/** "3 internal lines not shown" with the kinds, for a tooltip; null when nothing was dropped. Pure. */
export function hiddenText(hidden: Record<string, number>): string | null {
  const n = Object.values(hidden).reduce((a, b) => a + b, 0);
  if (!n) return null;
  return [`${n} internal ${n === 1 ? "line" : "lines"} not shown`, ...Object.entries(hidden).map(([k, c]) => `${k}: ${c}`)].join("\n");
}

/** Copies the whole conversation as Markdown, from the source text of every row. */
export function CopyConversation({ rows }: { rows: readonly ChatRow[] }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);
  const label = done ? "Copied" : "Copy conversation";
  return (
    <button
      type="button"
      aria-label={label}
      title={done ? "Copied as Markdown" : "Copy the whole conversation as Markdown"}
      disabled={!rows.length}
      onClick={() => void navigator.clipboard?.writeText(sessionMarkdown(rows)).then(() => setDone(true), () => {})}
      className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] text-ac-muted hover:bg-ac-raise hover:text-ac-text disabled:opacity-50 [&_svg]:size-3.5"
    >
      {done ? <Check /> : <ClipboardCopy />}
      {label}
    </button>
  );
}

/** The timeline of one session. `notice` sits above it (version or read-only banner).
 *  `copyBar={false}`: the caller puts "Copy conversation" into its own header. */
export function ChatTimeline({ events, on = {}, notice, copyBar = true, agent }: { events: readonly AsEvent[]; on?: ChatHandlers; notice?: ReactNode; copyBar?: boolean; /** Who asks, on approval cards: Claude unless said. */ agent?: string }) {
  const f = useMemo(() => fold(events), [events]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {notice}
      {copyBar && f.rows.length > 0 && (
        <div className="flex h-7 shrink-0 items-center justify-end border-b border-ac-line px-3">
          <CopyConversation rows={f.rows} />
        </div>
      )}
      {f.rows.length === 0 ? (
        <p className="m-auto text-[13px] text-ac-muted">Nothing in this session yet.</p>
      ) : (
        <VirtualList label="Conversation" className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4" items={f.rows} keyOf={(r) => `${r.k}:${r.id}`} render={(r) => <ChatRowView row={r} on={on} agent={agent} />} />
      )}
    </div>
  );
}
