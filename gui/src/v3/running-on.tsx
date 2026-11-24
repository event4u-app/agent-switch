/**
 * "Running on <account>" in the limits popover: the account's live sessions
 * (agents), each unfolding to its subagents. A session opens in its tab; a
 * subagent shows in the Children window; model and thinking change from the
 * next turn, as in the session bar. Same rows and child lines as the Sessions
 * window. Locked for a session in the user's own terminal.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, PanelRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { AccountMark } from "./kit.js";
import { ChildGroups, ChildLine, childNoun, statusGroup, type RowSession } from "./sessions.js";
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
  /** Unused since the readout is display only (owner, 2026-11-24); kept so callers need not change. */
  onModel?: (key: string, chip: "model" | "thinking") => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (!sessions.length) return null;
  // One session unfolded at a time (owner, 2026-11-24): opening one folds the other.
  const toggle = (k: string) => setOpen((o) => (o.has(k) ? new Set() : new Set([k])));
  return (
    <div className="mt-3 border-t border-ac-line pt-2.5">
      <div className="mb-1.5 flex h-5 items-center gap-2">
        <span className="ac-caps">Running on {name}</span>
        <span className="ml-auto text-[11px] text-ac-muted">
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </div>
      {/* A dark box like the tray's (owner, 2026-11-24), always the same height: sessions and unfolded subagents scroll inside it. */}
      <div data-running-box="" className="h-[160px] overflow-y-auto rounded-md border border-ac-line bg-ac-bg p-1">
      {sessions.map(({ row: s, model, thinking }) => {
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
                  <ExternalLink aria-hidden className="size-3.5 shrink-0 text-ac-faint group-hover:text-ac-text" />
                </button>
              </div>
              {/* Account, then model and thinking: the same chips, in the same order, as the session bar. */}
              <div className="flex h-6 items-center gap-0.5 pl-[39px]">
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
                {/* Model and thinking are shown here, not changed (owner, 2026-11-24): that happens in the session's own bar. */}
                <span data-model-readout="" title={[model ?? "Model unknown", thinking && `thinking ${thinking}`].filter(Boolean).join(" · ")} className={cn("inline-flex h-6 items-center gap-1 px-1.5 text-[11px] text-ac-muted", !onMove && "-ml-1.5")}>
                  {model ?? "Model"}
                  {thinking && <ThinkingArrow level={thinking} />}
                </span>
              </div>
            </div>
            {unfolded && (
              <div className="ml-[13px] border-l border-ac-line pl-3.5">
                <ChildGroups
                  kids={s.children}
                  render={(c) => (
                    <button type="button" onClick={() => onShowChild(s.key)} title="Show in the Children window" className="group/child flex w-full items-center gap-1 rounded-md pr-1 text-left hover:bg-ac-raise">
                      <span className="min-w-0 flex-1">
                        <ChildLine c={c} />
                      </span>
                      <PanelRight className="size-3.5 shrink-0 text-ac-faint group-hover/child:text-ac-text" />
                    </button>
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
