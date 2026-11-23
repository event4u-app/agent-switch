/**
 * The v3 dialogs (spec §8): New session, the near-limit decision sheet, and
 * End session. Every dialog: kicker, title, optional subline, a rail footer with
 * Cancel and ONE primary; Esc closes. Adapted from the reference boards; data
 * and actions come in as props, nothing here starts or moves anything itself.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Play, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Button, IconButton } from "../ui/Button.js";
import { Segmented } from "../ui/Segmented.js";
import { Select } from "../ui/Select.js";
import { TextInput } from "../ui/TextInput.js";
import { typedFolder } from "../lib/paths.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { Kbd } from "../ui/Typography.js";
import { AccountMark, CheckBox, Chip, Disclosure, Label } from "./kit.js";
import { LimitBar, type LimitAccount } from "./limits.js";
import { Anchored } from "./menus.js";

export function Modal({ title, kicker, badge, sub, width = 600, children, footer, onClose }: { title: string; kicker?: string; badge?: ReactNode; sub?: ReactNode; width?: number; children: ReactNode; footer: ReactNode; onClose: () => void }) {
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
            {(kicker || badge) && (
              <div className="mb-1 flex items-center gap-2 text-xs text-ac-muted">
                {kicker}
                {badge}
              </div>
            )}
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
export function Choice({ on, title, detail, onPick, disabled }: { on?: boolean; title: ReactNode; detail?: ReactNode; onPick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={!!on}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onPick}
      className={cn("flex flex-1 items-start gap-2.5 rounded-[10px] border px-3 py-2 text-left", on ? "border-ac-brand-line bg-ac-brand-tint" : "border-ac-line", disabled ? "cursor-default opacity-60" : !on && "hover:border-ac-line2")}
    >
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
  /** An account the person chose here; absent, the start routes as usual. */
  account?: string;
  /** The prefill is this project's last start, not a first-start default. */
  remembered?: boolean;
}

export interface NewSessionFacts {
  /** "Terminal.app" — where "Your terminal" opens. */
  terminalApp: string;
  /** From `host list --json`: persistent with tmux, ephemeral without. */
  hosting: "persistent" | "ephemeral";
  thinkingLevels: Record<NewSessionPlan["tool"], string[]>;
  /** The models each tool offers here; empty: the tool's own default only. */
  models: Record<NewSessionPlan["tool"], { id: string; label: string }[]>;
  /** Folders sessions ran in, newest first. */
  folders: string[];
  /** The user's home folder, for a typed `~/…`; null until read. */
  home: string | null;
  /** The accounts of each tool, for "Choose another…". */
  accounts: Record<NewSessionPlan["tool"], { name: string; color: IdentityColor }[]>;
  /** The account the start runs on, for the plan as it is now. `chosen`: picked here. */
  account: { name: string; color: IdentityColor; chosen?: true; reason: string; limits: LimitAccount; why: string[]; paceText: string | null };
  /** Strategy `ask`: the accounts to choose from; Start waits for a choice. */
  ask?: { name: string; color: IdentityColor }[];
  /** The exact command the start runs, for the preview. */
  command: string;
  nowMs: number;
}

const TOOL_NAME: Record<NewSessionPlan["tool"], string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };
const TYPED = "\u0000typed";

/** The thinking level a plan keeps when its tool changes: the same level when the
 *  new tool has it, else high, else the tool's highest. Pure. */
export function thinkingFor(levels: string[], current: string): string {
  return levels.includes(current) ? current : levels.includes("high") ? "high" : (levels[levels.length - 1] ?? "");
}

export function NewSessionDialog({ initial, facts, onChange, onStart, onClose }: { initial: NewSessionPlan; facts: NewSessionFacts; onChange?: (p: NewSessionPlan) => void; onStart: (p: NewSessionPlan) => void; onClose: () => void }) {
  // Without tmux nothing here keeps a hosted session running, so it is not offered.
  const hostable = facts.hosting === "persistent";
  const [p, setP] = useState<NewSessionPlan>(() => (hostable || initial.where !== "hosted" ? initial : { ...initial, where: "terminal" }));
  const [why, setWhy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const set = (patch: Partial<NewSessionPlan>) => {
    const next = { ...p, ...patch };
    if (patch.tool && patch.tool !== p.tool) {
      // A chosen account and a model belong to the tool they were chosen for:
      // another tool starts on its routed account and its own default model.
      delete next.account;
      next.model = patch.tool === initial.tool ? initial.model : "";
      next.thinking = thinkingFor(facts.thinkingLevels[patch.tool], p.thinking);
    }
    if (patch.account === undefined && "account" in patch) delete next.account;
    setP(next);
    onChange?.(next);
  };
  const toolName = TOOL_NAME[p.tool];
  const asks = !!facts.ask;
  const ready = !asks || !!p.account;
  // ⌘↵ starts right away (the subtitle promises it).
  const start = useRef(() => onStart(p));
  start.current = () => ready && onStart(p);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), start.current());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const folders = Array.from(new Set([p.folder, ...facts.folders]));
  const models = facts.models[p.tool];
  const modelOptions = [{ value: "", label: `${toolName}'s default` }, ...models.map((m) => ({ value: m.id, label: m.label })), ...(p.model && !models.some((m) => m.id === p.model) ? [{ value: p.model, label: p.model }] : [])].map((o) => ({
    ...o,
    hint: initial.remembered && o.value && o.value === initial.model && p.tool === initial.tool ? "last used here" : undefined,
  }));
  const typeFolder = () => {
    const tf = typedFolder(typed, facts.home);
    if (!tf.ok) return setTypedError(tf.reason);
    setTyping(false);
    setTyped("");
    set({ folder: tf.path });
  };
  return (
    <Modal
      title={`${toolName} in ${p.folder}`}
      kicker="New session"
      sub={initial.remembered ? "Everything below is prefilled from your last start here — ⌘↵ starts right away." : "Your choices here are remembered for the next start — ⌘↵ starts right away."}
      width={620}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[11px] text-ac-muted">{initial.remembered ? "Remembered for this project" : ""}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => start.current()}>
            <Play /> {p.where === "terminal" ? `Start in ${facts.terminalApp}` : "Start here"} <Kbd>⌘↵</Kbd>
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <div>
          <Label aside={p.gitState ?? undefined}>Folder</Label>
          <Select
            ariaLabel="Folder"
            mono
            value={typing ? TYPED : p.folder}
            onChange={(v) => {
              if (v === TYPED) return setTyping(true);
              setTyping(false);
              set({ folder: v });
            }}
            options={[...folders.map((f) => ({ value: f, label: f })), { value: TYPED, label: "Another folder…" }]}
          />
          {typing && (
            <>
              <TextInput
                mono
                autoFocus
                aria-label="Folder path"
                placeholder="/path/to/project or ~/project — Enter to use it"
                className="mt-2 w-full"
                value={typed}
                aria-invalid={typedError ? true : undefined}
                onChange={(e) => (setTyped(e.target.value), setTypedError(null))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") typeFolder();
                  // Esc leaves the field, not the dialog.
                  if (e.key === "Escape") (e.stopPropagation(), setTyping(false), setTyped(""), setTypedError(null));
                }}
              />
              {typedError && (
                <p role="alert" className="mt-1 text-[11px] text-ac-alert-text">
                  {typedError}
                </p>
              )}
            </>
          )}
          <div className="mt-2">
            <CheckBox checked={p.worktree} onChange={() => set({ worktree: !p.worktree })}>
              In a new worktree
            </CheckBox>
          </div>
        </div>
        <div>
          <Label>Tool</Label>
          <Segmented label="Tool" size="sm" fill value={p.tool} onChange={(tool) => set({ tool })} options={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }, { value: "antigravity", label: "Antigravity" }]} />
        </div>
        <div>
          <Label>Model</Label>
          <Select ariaLabel="Model" value={p.model} disabled={p.tool === "antigravity"} onChange={(model) => set({ model })} options={p.tool === "antigravity" ? [{ value: "", label: "Antigravity's own model" }] : modelOptions} />
        </div>
        <div>
          <Label aside="higher = slower, uses more limit">Thinking</Label>
          <Segmented label="Thinking" size="sm" fill value={p.thinking} onChange={(thinking) => set({ thinking })} options={facts.thinkingLevels[p.tool].map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))} />
        </div>
      </div>
      <div className="mt-4">
        <Label
          aside={
            <button type="button" aria-expanded={picking} onClick={() => setPicking((v) => !v)} className="text-ac-info-text hover:underline">
              Choose another…
            </button>
          }
        >
          Account
        </Label>
        {picking && (
          <div role="radiogroup" aria-label="Account to start on" className="mb-2 flex flex-wrap gap-2">
            {!asks && (
              <AccountPick on={!p.account} onPick={() => set({ account: undefined })}>
                Automatic
              </AccountPick>
            )}
            {facts.accounts[p.tool].map((a) => (
              <AccountPick key={a.name} on={p.account === a.name} onPick={() => set({ account: a.name })}>
                <AccountMark color={a.color} /> {a.name}
              </AccountPick>
            ))}
            {facts.accounts[p.tool].length === 0 && <span className="text-[11.5px] text-ac-muted">No {toolName} account yet.</span>}
          </div>
        )}
        {asks && !p.account ? (
          <div className="rounded-[10px] border border-ac-line bg-ac-bg px-3 py-2.5">
            <div className="text-[13px] text-ac-muted">Ask me — choose an account</div>
            <div role="radiogroup" aria-label="Account" className="mt-2 flex flex-wrap gap-2">
              {facts.ask!.map((a) => (
                <AccountPick key={a.name} on={false} onPick={() => set({ account: a.name })}>
                  <AccountMark color={a.color} /> {a.name}
                </AccountPick>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-ac-muted">New {toolName} sessions ask first: pick the account this one runs on.</div>
          </div>
        ) : (
          <div className="rounded-[10px] border border-ac-line bg-ac-bg px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] text-ac-text">
              <span className="text-ac-muted">{facts.account.chosen ? "Chosen →" : "Automatic →"}</span>
              <AccountMark color={facts.account.color} /> {facts.account.name}
              <span className="ml-auto text-[11px] text-ac-muted">{facts.account.reason}</span>
            </div>
            <div className="mt-2 space-y-1 rounded-md px-2 py-1.5">
              {facts.account.limits.windows.map((w) => (
                <LimitBar key={w.label} w={w} protect={facts.account.limits.protect} nowMs={facts.nowMs} />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ac-muted">
              <span>{facts.account.paceText ?? ""}</span>
              {facts.account.why.length > 0 && (
                <button type="button" aria-expanded={why} onClick={() => setWhy((v) => !v)} className="inline-flex shrink-0 items-center gap-1 hover:text-ac-text">
                  <ChevronRight className={cn("size-3 transition-transform", why && "rotate-90")} /> Why?
                </button>
              )}
            </div>
            {why && (
              <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-ac-muted">
                {facts.account.why.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="mt-4">
        <Label>Where it runs</Label>
        <div role="radiogroup" aria-label="Where it runs" className="flex gap-2">
          <Choice on={p.where === "terminal"} onPick={() => set({ where: "terminal" })} title="Your terminal" detail={`A new ${facts.terminalApp} window. Agent Switch shows it; you type there.`} />
          <Choice
            on={p.where === "hosted"}
            disabled={!hostable}
            onPick={() => set({ where: "hosted" })}
            title="Host in Agent Switch"
            detail={hostable ? "Keeps running when the window closes; type into it here. Chat view possible." : "Hosting needs tmux, which this computer does not have (macOS: brew install tmux)."}
          />
        </div>
      </div>
      <button type="button" aria-expanded={preview} onClick={() => setPreview((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-[11.5px] text-ac-muted hover:text-ac-text">
        <ChevronRight className={cn("size-3 transition-transform", preview && "rotate-90")} /> Command preview
      </button>
      {preview && <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-ac-bg px-2.5 py-2 font-ac-mono text-[11px] text-ac-soft">{facts.command}</pre>}
    </Modal>
  );
}

function AccountPick({ on, onPick, children }: { on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] text-ac-text", on ? "border-ac-info-text bg-ac-panel" : "border-ac-line hover:bg-ac-panel")}
    >
      {children}
    </button>
  );
}

/** A new chat under strategy ask: the chat view has no New session plan, so
 *  this asks only for the account. */
export function ChatAccountDialog({ folder, ask, onStart, onClose }: { folder: string; ask: { name: string; color: IdentityColor }[]; onStart: (account: string) => void; onClose: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  return (
    <Modal
      title={`Claude in ${folder}`}
      kicker="New session in chat view"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!pick} onClick={() => pick && onStart(pick)}>
            <Play /> Start here
          </Button>
        </>
      }
    >
      <Label>Account</Label>
      <div className="text-[13px] text-ac-muted">Ask me — choose an account</div>
      <div role="radiogroup" aria-label="Account" className="mt-2 flex flex-wrap gap-2">
        {ask.map((a) => (
          <Choice
            key={a.name}
            on={pick === a.name}
            onPick={() => setPick(a.name)}
            title={
              <>
                <AccountMark color={a.color} /> {a.name}
              </>
            }
          />
        ))}
      </div>
    </Modal>
  );
}

// ---------- near-limit decision sheet (spec §8.2) ----------

export type MoveHow = "after-turn" | "now" | "brief";

/** One session to move. `via: "takeover"` when the target runs a session of its
 *  own: borrowing its login would sign that session out, so the conversation
 *  moves to the target and resumes there instead. */
export interface SheetMove {
  key: string;
  target: string;
  via?: "takeover";
}

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
  suggestionWhy,
  targets = [],
  tool = "claude",
  askedByAgentConfig = false,
  pace,
  alsoOn = [],
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
  /** Why that account is suggested, in words ("most room left"). */
  suggestionWhy?: string;
  /** The accounts a session can move to (same tool), for the per-session picker. */
  targets?: { name: string; color: IdentityColor; busy?: boolean }[];
  /** Codex has no live login switch: both switch modes move the session and resume it. */
  tool?: string;
  /** agent-config asked this in the session; one answer counts for both. */
  askedByAgentConfig?: boolean;
  /** A pace suggestion, not a limit: its own header words. */
  pace?: { title: string; sub: string };
  /** Every live session on the account. A live switch changes the account's
   *  login, so each one that is not itself moving switches along. */
  alsoOn?: { key: string; title: string }[];
  onDecide: (how: MoveHow, moves: SheetMove[]) => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const [how, setHow] = useState<MoveHow>("after-turn");
  const [checked, setChecked] = useState<Set<string>>(new Set(sessions.map((s) => s.key)));
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(sessions.map((s) => [s.key, s.target])));
  const [picking, setPicking] = useState<string | null>(null);
  // Where the checked sessions go: one account the labels can name, or several.
  const dests = [...new Set(sessions.filter((s) => checked.has(s.key)).map((s) => chosen[s.key] ?? s.target))];
  const target = dests.length === 1 ? dests[0] : dests.length === 0 ? (chosen[sessions[0]?.key ?? ""] ?? suggestion) : "";
  const spread = dests.length > 1;
  const where = spread ? "the accounts above" : target;
  // A brief starts one new session; it does not fan out.
  const briefBlocked = how === "brief" && checked.size > 1;
  const ready = checked.size > 0 && dests.every(Boolean) && !briefBlocked;
  const colorOf = (name: string) => targets.find((t) => t.name === name)?.color ?? "blue";
  const isBusy = (name: string) => targets.find((t) => t.name === name)?.busy === true;
  // Claude's live switch moves the target's login into the session, which would
  // sign out a session running on the target — so those sessions move instead.
  const moving = tool !== "codex" && how !== "brief" ? [...new Set(sessions.filter((s) => checked.has(s.key) && isBusy(chosen[s.key] ?? s.target)).map((s) => chosen[s.key] ?? s.target))] : [];
  const moves = (): SheetMove[] =>
    sessions
      .filter((s) => checked.has(s.key))
      .map((s) => {
        const to = chosen[s.key] ?? s.target;
        return moving.includes(to) ? { key: s.key, target: to, via: "takeover" as const } : { key: s.key, target: to };
      });
  const switching = tool !== "codex" && how !== "brief" ? moves().filter((m) => !m.via) : [];
  const followers = switching.length ? alsoOn.filter((x) => !switching.some((m) => m.key === x.key)) : [];
  return (
    <Modal
      kicker={pace ? "Accounts at different paces" : "Near limit"}
      badge={
        askedByAgentConfig ? (
          <Chip kind="status" tone="info" title="agent-config asked the same in your session. Answer here or there; the first answer counts for both.">
            agent-config asked
          </Chip>
        ) : undefined
      }
      title={pace ? pace.title : `${account} is at ${pctUsed}% of its ${window} window`}
      sub={pace ? pace.sub : `Resets in ${resetsIn}. ${sessions.length} session${sessions.length === 1 ? " runs" : "s run"} on it. Nothing changes until you choose.`}
      width={580}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onKeep}>
            Keep going on {account}
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => onDecide(how, moves())}>
            {spread ? `${tool === "codex" ? "Move" : "Switch"} ${checked.size} sessions` : `Continue on ${target}`}
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
              <CheckBox size={14} label={`Move ${s.title}`} checked={checked.has(s.key)} onChange={() => setChecked((c) => (c.has(s.key) ? new Set([...c].filter((k) => k !== s.key)) : new Set([...c, s.key])))} />
              {s.state && <SessionStateIcon state={s.state} />}
              <span className="min-w-0 flex-1 truncate text-ac-text">{s.title}</span>
              <span className="shrink-0 text-ac-muted">{s.model ? `${s.model} · →` : "→"}</span>
              <button
                type="button"
                aria-label={`Target account for ${s.title}`}
                aria-haspopup="listbox"
                aria-expanded={picking === s.key}
                data-popover-trigger=""
                disabled={targets.length < 2}
                onClick={() => setPicking((p) => (p === s.key ? null : s.key))}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-ac-line2 px-2 py-0.5 text-ac-text disabled:cursor-default"
              >
                <AccountMark color={colorOf(to)} /> {to || "no other account"} {targets.length > 1 && <ChevronDown className="size-3 text-ac-muted" />}
              </button>
              {picking === s.key && (
                <Anchored onClose={() => setPicking(null)} className="absolute right-3 top-9 z-10">
                <div role="listbox" aria-label="Target account" className="w-[180px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
                  {targets.map((t) => (
                    <button key={t.name} type="button" role="option" aria-selected={t.name === to} onClick={() => (setChosen((c) => ({ ...c, [s.key]: t.name })), setPicking(null))} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ac-soft hover:bg-ac-raise">
                      <AccountMark color={t.color} /> {t.name}
                      {t.busy && <span className="ml-auto text-[11px] text-ac-muted">in use</span>}
                    </button>
                  ))}
                </div>
                </Anchored>
              )}
            </div>
          );
        })}
      </div>
      <Label>How</Label>
      <div role="radiogroup" aria-label="How" className="flex flex-col gap-2">
        {tool === "codex" ? (
          <Choice on={how !== "brief"} onPick={() => setHow("now")} title={`Move and continue on ${where}`} detail={`Moves ${spread ? "each conversation to its account" : `the conversation to ${target}`} and resumes it there with “continue”. End codex in your own terminal first; a session Agent Switch hosts moves in its window.`} />
        ) : (
          <>
            <Choice on={how === "after-turn"} onPick={() => setHow("after-turn")} title={`After this turn, continue on ${where}`} detail={`Switches when the turn ends, then carries on by itself where Agent Switch hosts the session.`} />
            <Choice on={how === "now"} onPick={() => setHow("now")} title="Switch now and continue" detail={spread ? `Checked for this Claude version. Each session adopts its account and is told to continue; a session whose switch fails stays on ${account}.` : `Checked for this Claude version. The session adopts ${target} and is told to continue; if the switch fails, it stays on ${account}.`} />
          </>
        )}
        <Choice on={how === "brief"} onPick={() => setHow("brief")} title="New session with a brief" detail={checked.size > 1 ? "Starts one session fresh with a summary — check only the session to brief." : `Starts fresh on ${target} with a summary of this one.`} />
      </div>
      {moving.length > 0 && (
        <p role="status" className="mt-2 text-xs text-ac-muted">
          {moving.join(", ")} {moving.length === 1 ? "runs a session of its" : "run sessions of their"} own, so this conversation moves to {moving.join(", ")} and resumes there — its own session keeps running. A session in your own terminal is ended there between turns; one Agent Switch hosts moves in its window.
        </p>
      )}
      {followers.length > 0 && (
        <p role="status" className="mt-2 text-xs text-ac-warn">
          A live switch changes {account}'s sign-in, so these sessions switch too: {followers.map((f) => f.title).join(", ")}.
        </p>
      )}
      <Label className="mt-4" aside={suggestion ? `suggested: ${suggestion}${suggestionWhy ? ` — ${suggestionWhy}` : ""}` : undefined}>
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onCloseTab}>
            Just close the tab
          </Button>
          <Button variant="danger" onClick={onEnd}>
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
