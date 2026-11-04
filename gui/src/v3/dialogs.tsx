/**
 * The v3 dialogs (spec §8): New session, the near-limit decision sheet, and
 * End session. Every dialog: kicker, title, optional subline, a rail footer with
 * Cancel and ONE primary; Esc closes. Adapted from the reference boards; data
 * and actions come in as props, nothing here starts or moves anything itself.
 */

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Button, IconButton } from "../ui/Button.js";
import { Segmented } from "../ui/Segmented.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { ChevronDown } from "lucide-react";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { AccountMark, Disclosure, Label } from "./kit.js";
import { LimitBar, type LimitAccount } from "./limits.js";

export function Modal({ title, kicker, sub, width = 600, children, footer, onClose }: { title: string; kicker?: string; sub?: ReactNode; width?: number; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6" style={{ background: "var(--ac-scrim)" }}>
      <div role="dialog" aria-label={title} className="flex max-h-full flex-col overflow-hidden rounded-xl border border-ac-line2 bg-ac-panel" style={{ width, boxShadow: "var(--ac-shadow)" }}>
        <div className="flex items-start justify-between gap-3 border-b border-ac-line px-5 pb-3 pt-4">
          <div>
            {kicker && <div className="mb-1 text-xs text-ac-muted">{kicker}</div>}
            <h2 className="text-[16px] font-semibold text-ac-text">{title}</h2>
            {sub && <p className="mt-1 text-xs text-ac-muted">{sub}</p>}
          </div>
          <IconButton label="Close  Esc" className="-mr-2" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className="min-h-0 relative overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-ac-line bg-ac-rail px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

/** Radio card: accent outline and tint, filled radio dot (spec §3.2). */
export function Choice({ on, title, detail, onPick }: { on?: boolean; title: ReactNode; detail?: ReactNode; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={!!on} onClick={onPick} className={cn("flex flex-1 items-start gap-2.5 rounded-[10px] border px-3 py-2 text-left", on ? "border-ac-brand-line bg-ac-brand-tint" : "border-ac-line hover:border-ac-line2")}>
      <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-ac-brand bg-ac-brand" : "border-ac-line2")}>{on && <span className="size-1.5 rounded-full bg-ac-on-color" />}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ac-text">{title}</span>
        {detail && <span className="mt-0.5 block text-[11.5px] leading-snug text-ac-muted">{detail}</span>}
      </span>
    </button>
  );
}

// ---------- New session (spec §8.1) ----------

export interface NewSessionPlan {
  folder: string;
  gitState: string | null;
  worktree: boolean;
  tool: "claude" | "codex" | "antigravity";
  model: string;
  thinking: string;
  where: "terminal" | "hosted";
}

export interface NewSessionFacts {
  /** "Terminal.app" — where "Your terminal" opens. */
  terminalApp: string;
  /** From `host list --json`: persistent with tmux, ephemeral without. */
  hosting: "persistent" | "ephemeral";
  thinkingLevels: Record<NewSessionPlan["tool"], string[]>;
  account: { name: string; color: IdentityColor; reason: string; limits: LimitAccount; why: string[]; paceText: string | null };
  /** The exact command, for the preview. */
  command: string;
  nowMs: number;
}

export function NewSessionDialog({ initial, facts, onChange, onStart, onClose, onChooseAccount }: { initial: NewSessionPlan; facts: NewSessionFacts; onChange?: (p: NewSessionPlan) => void; onStart: (p: NewSessionPlan) => void; onClose: () => void; onChooseAccount: () => void }) {
  const [p, setP] = useState(initial);
  const [why, setWhy] = useState(false);
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<NewSessionPlan>) => {
    const next = { ...p, ...patch };
    setP(next);
    onChange?.(next);
  };
  const toolName = p.tool === "claude" ? "Claude" : p.tool === "codex" ? "Codex" : "Antigravity";
  const primary = p.where === "terminal" ? `▶ Start in ${facts.terminalApp}` : "▶ Start here";
  return (
    <Modal
      title={`${toolName} in ${p.folder}`}
      kicker="New session"
      width={620}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[11px] text-ac-muted">Remembered for this project</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => onStart(p)}>
            {primary} <span className="font-ac-mono text-[10px] opacity-70">⌘↵</span>
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <Label aside={p.gitState ?? undefined}>Folder</Label>
          <div className="flex h-8 items-center rounded-md border border-ac-line2 bg-ac-bg px-2.5 font-ac-mono text-xs text-ac-text">{p.folder}</div>
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-ac-soft">
            <input type="checkbox" checked={p.worktree} onChange={(e) => set({ worktree: e.target.checked })} /> In a new worktree
          </label>
        </div>
        <div>
          <Label>Tool</Label>
          <Segmented label="Tool" size="sm" value={p.tool} onChange={(tool) => set({ tool, thinking: facts.thinkingLevels[tool][0] ?? p.thinking })} options={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }, { value: "antigravity", label: "Antigravity" }]} />
        </div>
        <div>
          <Label>Model</Label>
          <div className="flex h-8 items-center rounded-md border border-ac-line2 bg-ac-bg px-2.5 text-xs text-ac-text">{p.model}</div>
        </div>
        <div>
          <Label aside="higher = slower, uses more limit">Thinking</Label>
          <Segmented label="Thinking" size="sm" value={p.thinking} onChange={(thinking) => set({ thinking })} options={facts.thinkingLevels[p.tool].map((l) => ({ value: l, label: l }))} />
        </div>
      </div>
      <div className="mt-4 rounded-[10px] border border-ac-line p-3">
        <Label aside={<button type="button" onClick={onChooseAccount} className="hover:text-ac-text">Choose another…</button>}>Account</Label>
        <div className="flex items-center gap-2 text-[13px] text-ac-text">
          Automatic → <AccountMark color={facts.account.color} /> {facts.account.name}
          <span className="ml-auto text-[11px] text-ac-muted">{facts.account.reason}</span>
        </div>
        <div className="mt-2 space-y-1.5">
          {facts.account.limits.windows.map((w) => (
            <LimitBar key={w.label} w={w} protect={facts.account.limits.protect} nowMs={facts.nowMs} />
          ))}
        </div>
        {facts.account.paceText && <p className="mt-2 text-[11.5px] text-ac-muted">{facts.account.paceText}</p>}
        <div className="mt-2">
          <Disclosure open={why} label="Why? ›" onToggle={() => setWhy((v) => !v)}>
            <ul className="space-y-0.5 text-[11.5px] text-ac-muted">
              {facts.account.why.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Disclosure>
        </div>
      </div>
      <div className="mt-4">
        <Label>Where it runs</Label>
        <div role="radiogroup" aria-label="Where it runs" className="flex gap-2">
          <Choice on={p.where === "terminal"} onPick={() => set({ where: "terminal" })} title="Your terminal" detail={`As today: ${facts.terminalApp}. Agent Switch shows it; you type there.`} />
          <Choice
            on={p.where === "hosted"}
            onPick={() => set({ where: "hosted" })}
            title="Host in Agent Switch"
            detail={facts.hosting === "persistent" ? "Keeps running when the window closes; type into it here. Chat view possible." : "Runs in this window and ends when the app closes (no tmux here)."}
          />
        </div>
      </div>
      <div className="mt-3">
        <Disclosure open={preview} label="Command preview ›" onToggle={() => setPreview((v) => !v)}>
          <pre className="whitespace-pre-wrap rounded-md bg-ac-bg px-2.5 py-2 font-ac-mono text-[11px] text-ac-soft">{facts.command}</pre>
        </Disclosure>
      </div>
    </Modal>
  );
}

// ---------- near-limit decision sheet (spec §8.2) ----------

export type MoveHow = "after-turn" | "now" | "brief";

export interface SheetSession {
  key: string;
  title: string;
  model: string | null;
  target: string;
  state?: SessionState;
}

export function DecisionSheet({
  account,
  pctUsed,
  window,
  resetsIn,
  sessions,
  room,
  suggestion,
  targets = [],
  tool = "claude",
  onDecide,
  onKeep,
  onClose,
}: {
  account: string;
  pctUsed: number;
  window: string;
  resetsIn: string;
  sessions: SheetSession[];
  room: ReactNode;
  suggestion: string;
  /** The accounts a session can move to (same tool), for the per-session picker. */
  targets?: { name: string; color: IdentityColor; busy?: boolean }[];
  /** Codex has no live login switch: both switch modes move the session and resume it. */
  tool?: string;
  onDecide: (how: MoveHow, moves: { key: string; target: string }[]) => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const [how, setHow] = useState<MoveHow>("after-turn");
  const [checked, setChecked] = useState<Set<string>>(new Set(sessions.map((s) => s.key)));
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(sessions.map((s) => [s.key, s.target])));
  const [picking, setPicking] = useState<string | null>(null);
  const target = chosen[sessions[0]?.key ?? ""] ?? suggestion;
  const colorOf = (name: string) => targets.find((t) => t.name === name)?.color ?? "blue";
  const isBusy = (name: string) => targets.find((t) => t.name === name)?.busy === true;
  // Both switch modes move the target's login into the session; a target with a
  // session of its own would be signed out. A brief starts fresh and may share it.
  const blocked = how !== "brief" ? sessions.filter((s) => checked.has(s.key) && isBusy(chosen[s.key] ?? s.target)).map((s) => chosen[s.key] ?? s.target) : [];
  return (
    <Modal
      kicker="Near limit"
      title={`${account} is at ${pctUsed}% of its ${window} window`}
      sub={`Resets in ${resetsIn}. ${sessions.length} session${sessions.length === 1 ? " runs" : "s run"} on it. Nothing changes until you choose.`}
      width={580}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onKeep}>
            Keep going on {account}
          </Button>
          <Button variant="primary" size="sm" disabled={checked.size === 0 || !target || blocked.length > 0} onClick={() => onDecide(how, sessions.filter((s) => checked.has(s.key)).map((s) => ({ key: s.key, target: chosen[s.key] ?? s.target })))}>
            Continue on {target}
          </Button>
        </>
      }
    >
      <Label>Sessions on {account}</Label>
      <div className="mb-4 rounded-[10px] border border-ac-line bg-ac-bg">
        {sessions.map((s) => {
          const to = chosen[s.key] ?? s.target;
          return (
            <div key={s.key} className="relative flex items-center gap-2.5 px-3 py-2 text-xs">
              <input type="checkbox" aria-label={`Move ${s.title}`} checked={checked.has(s.key)} onChange={() => setChecked((c) => (c.has(s.key) ? new Set([...c].filter((k) => k !== s.key)) : new Set([...c, s.key])))} />
              {s.state && <SessionStateIcon state={s.state} />}
              <span className="min-w-0 flex-1 truncate text-ac-text">{s.title}</span>
              <span className="shrink-0 text-ac-muted">{s.model ? `${s.model} · →` : "→"}</span>
              <button
                type="button"
                aria-label={`Target account for ${s.title}`}
                aria-haspopup="listbox"
                aria-expanded={picking === s.key}
                disabled={targets.length < 2}
                onClick={() => setPicking((p) => (p === s.key ? null : s.key))}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-ac-line2 px-2 py-0.5 text-ac-text disabled:cursor-default"
              >
                <AccountMark color={colorOf(to)} /> {to || "no other account"} {targets.length > 1 && <ChevronDown className="size-3 text-ac-muted" />}
              </button>
              {picking === s.key && (
                <div role="listbox" aria-label="Target account" className="absolute right-3 top-9 z-10 w-[180px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
                  {targets.map((t) => (
                    <button key={t.name} type="button" role="option" aria-selected={t.name === to} onClick={() => (setChosen((c) => ({ ...c, [s.key]: t.name })), setPicking(null))} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ac-soft hover:bg-ac-raise">
                      <AccountMark color={t.color} /> {t.name}
                      {t.busy && <span className="ml-auto text-[11px] text-ac-muted">in use</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Label>How</Label>
      <div role="radiogroup" aria-label="How" className="flex flex-col gap-2">
        {tool === "codex" ? (
          <Choice on={how !== "brief"} onPick={() => setHow("now")} title={`Move and continue on ${target}`} detail={`Moves the conversation to ${target} and resumes it there with “continue”. End codex in your own terminal first; a session Agent Switch hosts moves in its window.`} />
        ) : (
          <>
            <Choice on={how === "after-turn"} onPick={() => setHow("after-turn")} title={`After this turn, continue on ${target}`} detail={`Switches when the turn ends, then carries on by itself where Agent Switch hosts the session.`} />
            <Choice on={how === "now"} onPick={() => setHow("now")} title="Switch now and continue" detail={`Checked for this Claude version. The session adopts ${target} and is told to continue; if the switch fails, it stays on ${account}.`} />
          </>
        )}
        <Choice on={how === "brief"} onPick={() => setHow("brief")} title="New session with a brief" detail={`Starts fresh on ${target} with a summary of this one.`} />
      </div>
      {blocked.length > 0 && (
        <p role="alert" className="mt-2 text-xs text-ac-warn-text">
          {[...new Set(blocked)].join(", ")} {blocked.length === 1 ? "is" : "are"} running a session of {blocked.length === 1 ? "its" : "their"} own — switching would sign it out. Pick another account, or start a new session with a brief.
        </p>
      )}
      <Label className="mt-4" aside={`suggested: ${suggestion}`}>
        Room left
      </Label>
      {room}
    </Modal>
  );
}

// ---------- End session (spec §8.3, D-vault) ----------

export function EndDialog({ title, stops, kept, onEnd, onCloseTab, onClose }: { title: string; stops: string[]; kept: boolean; onEnd: () => void; onCloseTab: () => void; onClose: () => void }) {
  return (
    <Modal
      title={`End “${title}”?`}
      width={500}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" size="sm" onClick={onCloseTab}>
            Just close the tab
          </Button>
          <Button variant="danger" size="sm" onClick={onEnd}>
            End session
          </Button>
        </>
      }
    >
      {stops.length > 0 && (
        <>
          <Label>Stops with it</Label>
          <ul className="mb-3 space-y-0.5 text-[12.5px] text-ac-soft">
            {stops.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {/* D-vault (owner, 2026-11-02): say whether THIS session is kept, rather than "kept either way". */}
      <p className="text-[12.5px] text-ac-muted">{kept ? "Its transcript is kept in the vault." : "Its transcript stays where Claude keeps it; pin the session to keep a copy in the vault."}</p>
    </Modal>
  );
}
