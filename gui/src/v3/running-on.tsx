/**
 * "Running on <account>" in the limits popover: the account's live sessions
 * (agents), each unfolding to its subagents. A session opens in its tab; a
 * subagent shows in the Children window; model and thinking change from the
 * next turn, as in the session bar. Same rows and child lines as the Sessions
 * window. Locked for a session in the user's own terminal.
 */
import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Lock, PanelRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { AccountMark } from "./kit.js";
import { ChildLine, childNoun, statusGroup, type RowSession } from "./sessions.js";
import { ThinkingArrow } from "./workbench.js";

export interface RunningSession {
  row: RowSession;
  model: string | null;
  thinking: string | null;
  hosted: boolean;
}

/** The active sessions of one account (`<tool>:<name>` ↔ `<tool>/<name>/<id>`): running or needing you — the
 *  status groups' Running and Needs you; idle and ended ones stay out (owner, 2026-11-24). Pure. */
export function runningOn(account: { tool: string; name: string }, sessions: readonly RowSession[]): RowSession[] {
  const prefix = `${account.tool}/${account.name}/`;
  return sessions.filter((s) => s.state !== "done" && statusGroup(s) !== "Idle" && s.key.startsWith(prefix));
}

/** Two sessions show whole; a third scrolls inside the box. */
const BOX_ROWS = 2;

export function RunningOn({
  name,
  sessions,
  onOpen,
  onShowChild,
  onModel,
  onMove,
  moveWhy,
}: {
  name: string;
  /** The account chip, as in the session bar (owner, 2026-11-24): opens the move sheet for that session. */
  onMove?: (key: string) => void;
  /** Why that session cannot move now; null: it can. */
  moveWhy?: (key: string) => string | null;
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
      {/* A dark box like the tray's (owner, 2026-11-24): two sessions show whole, more scroll inside it. */}
      <div data-running-box="" className={cn("rounded-md border border-ac-line bg-ac-bg p-1", sessions.length > BOX_ROWS && "max-h-[122px] overflow-y-auto")}>
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
              {/* Account, then model and thinking: the same chips, in the same order, as the session bar. */}
              <div className="flex h-6 items-center gap-0.5 pl-[30px]">
                {onMove && (
                  <button
                    type="button"
                    aria-disabled={moveWhy?.(s.key) ? true : undefined}
                    onClick={() => !moveWhy?.(s.key) && onMove(s.key)}
                    title={moveWhy?.(s.key) ?? `${name} — moving opens the decision sheet, it never switches by itself`}
                    className={cn("-ml-1.5 inline-flex h-6 items-center gap-1 rounded-md border border-transparent px-1.5 text-[11px] text-ac-muted", moveWhy?.(s.key) ? "opacity-60" : "hover:border-ac-line2 hover:text-ac-text")}
                  >
                    {s.account.color && <AccountMark color={s.account.color} />}
                    {s.account.name}
                    <ChevronDown className="size-3" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={!hosted}
                  onClick={() => onModel(s.key, "model")}
                  title={hosted ? "Model and thinking for the next turn — same popover as the session bar" : "Locked: change it in your terminal (/model)"}
                  className={cn("inline-flex h-6 items-center gap-1 rounded-md border border-transparent px-1.5 text-[11px] text-ac-muted", !onMove && "-ml-1.5", hosted ? "hover:border-ac-line2 hover:text-ac-text" : "opacity-60")}
                >
                  {model ?? "Model"}
                  {thinking && <ThinkingArrow level={thinking} />}
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
    </div>
  );
}
