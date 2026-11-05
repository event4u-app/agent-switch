/**
 * "Running on <account>" in the limits popover: the account's live sessions
 * (agents), each unfolding to its subagents. A session opens in its tab; a
 * subagent shows in the Children window; model and thinking change from the
 * next turn, as in the session bar. Same rows and child lines as the Sessions
 * window. Locked for a session in the user's own terminal.
 */
import { useState } from "react";
import { ArrowUpRight, Brain, ChevronDown, ChevronRight, Lock, PanelRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { ChildLine, childNoun, type RowSession } from "./sessions.js";

export interface RunningSession {
  row: RowSession;
  model: string | null;
  thinking: string | null;
  hosted: boolean;
}

/** The live sessions of one account (`<tool>:<name>` ↔ `<tool>/<name>/<id>`). Pure. */
export function runningOn(account: { tool: string; name: string }, sessions: readonly RowSession[]): RowSession[] {
  const prefix = `${account.tool}/${account.name}/`;
  return sessions.filter((s) => s.state !== "done" && s.key.startsWith(prefix));
}

export function RunningOn({
  name,
  sessions,
  onOpen,
  onShowChild,
  onModel,
}: {
  name: string;
  sessions: RunningSession[];
  onOpen: (key: string) => void;
  onShowChild: (key: string) => void;
  onModel: (key: string, chip: "model" | "thinking") => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (!sessions.length) return null;
  const toggle = (k: string) => setOpen((o) => (o.has(k) ? new Set([...o].filter((x) => x !== k)) : new Set([...o, k])));
  return (
    <div className="mt-3 border-t border-ac-line pt-2.5">
      <div className="mb-1.5 flex h-5 items-center gap-2">
        <span className="ac-caps">Running on {name}</span>
        <span className="ml-auto text-[11px] text-ac-muted">
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </div>
      {sessions.map(({ row: s, model, thinking, hosted }) => {
        const unfolded = open.has(s.key);
        return (
          <div key={s.key}>
            <div className="group rounded-md pb-0.5 pl-0.5 pr-1 hover:bg-ac-raise">
              <div className="flex h-7 items-center gap-1.5">
                {s.children.length ? (
                  <button type="button" aria-expanded={unfolded} aria-label={`${unfolded ? "Hide" : "Show"} ${childNoun(s)}`} onClick={() => toggle(s.key)} className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ac-muted hover:text-ac-text">
                    {unfolded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </button>
                ) : (
                  <span className="size-5 shrink-0" />
                )}
                <button type="button" onClick={() => onOpen(s.key)} title={`Open “${s.title}” in its tab`} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  <SessionStateIcon state={s.state} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ac-soft group-hover:text-ac-text">{s.title}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-ac-faint group-hover:text-ac-text" />
                </button>
              </div>
              <div className="flex h-6 items-center pl-[30px]">
                <button
                  type="button"
                  disabled={!hosted}
                  onClick={() => onModel(s.key, "model")}
                  title={hosted ? "Model and thinking for the next turn — same popover as the session bar" : "Locked: change it in your terminal (/model)"}
                  className={cn("-ml-1.5 inline-flex h-6 items-center gap-1 rounded-md border border-transparent px-1.5 text-[11px] text-ac-muted", hosted ? "hover:border-ac-line2 hover:text-ac-text" : "opacity-60")}
                >
                  {model ?? "Model"}
                  <Brain className="ml-1 size-3" />
                  {thinking ?? "Thinking"}
                  {hosted ? <ChevronDown className="size-3" /> : <Lock className="size-3" />}
                </button>
              </div>
            </div>
            {unfolded && (
              <div className="ml-[13px] border-l border-ac-line pl-3.5">
                {s.children.map((c) => (
                  <button key={c.id} type="button" onClick={() => onShowChild(s.key)} title="Show in the Children window" className="group/child flex w-full items-center gap-1 rounded-md pr-1 text-left hover:bg-ac-raise">
                    <span className="min-w-0 flex-1">
                      <ChildLine c={c} />
                    </span>
                    <PanelRight className="size-3.5 shrink-0 text-ac-faint group-hover/child:text-ac-text" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
