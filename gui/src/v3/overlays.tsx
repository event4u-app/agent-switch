/**
 * The overlays of the Sessions window (spec §7.1–§7.4): the ⌘K palette, the
 * ⌃Tab switcher, the hover peek card and the inbox popover. Adapted from the
 * reference boards; the data comes in as props. The cursor row of a list has
 * the raise fill (hover language); the current pick of the switcher has the
 * Marker (where you are).
 */

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Check, Hash, Search } from "lucide-react";
import { cn } from "../lib/utils.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { Kbd } from "../ui/Typography.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { AccountMark, Chip, Label, Marker, duration } from "./kit.js";
import { NeedRow, type NeedItem } from "./needs.js";

function Overlay({ children, top = 72, onClose }: { children: ReactNode; top?: number; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex justify-center" style={{ background: "var(--ac-scrim)", paddingTop: top }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="h-fit">
        {children}
      </div>
    </div>
  );
}

// ---------- ⌘K palette ----------

export interface PaletteEntry {
  id: string;
  group: "sessions" | "branches" | "commands";
  title: string;
  meta?: string;
  /** Shown on the cursor row, e.g. "↵ Resume…" or "⌘⇧M". */
  hint?: string;
  state?: SessionState;
  /** Older than a week: shown under "All" only. */
  old?: boolean;
}

const GROUP_LABEL = { sessions: "Sessions", branches: "Branches & PRs", commands: "Commands" } as const;

/** Entries matching every word of the query; `>` limits to commands. Pure. */
export function filterPalette(entries: readonly PaletteEntry[], query: string, scope: "all" | "week"): PaletteEntry[] {
  const commandsOnly = query.trimStart().startsWith(">");
  const words = query.replace(/^\s*>/, "").toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (e) => (!commandsOnly || e.group === "commands") && (scope === "all" || !e.old) && words.every((w) => `${e.title} ${e.meta ?? ""}`.toLowerCase().includes(w)),
  );
}

export function Palette({ entries, onOpen, onClose }: { entries: PaletteEntry[]; onOpen: (e: PaletteEntry, newTab: boolean) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "week">("all");
  const [cursor, setCursor] = useState(0);
  const hits = useMemo(() => filterPalette(entries, query, scope), [entries, query, scope]);
  const ordered = (["sessions", "branches", "commands"] as const).flatMap((g) => hits.filter((h) => h.group === g));
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, ordered.length - 1));
    else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
    else if (e.key === "Enter" && ordered[cursor]) onOpen(ordered[cursor], e.metaKey);
    else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
  };
  let row = -1;
  return (
    <Overlay onClose={onClose}>
      <div role="dialog" aria-label="Go to or do" className="w-[640px] overflow-hidden rounded-xl border border-ac-line2 bg-ac-panel" style={{ boxShadow: "var(--ac-shadow)" }}>
        <div className="flex h-12 items-center gap-2.5 border-b border-ac-line px-4">
          <Search className="size-4 text-ac-muted" />
          <input
            autoFocus
            aria-label="Search"
            value={query}
            onChange={(e) => (setQuery(e.target.value), setCursor(0))}
            onKeyDown={key}
            placeholder="Go to session, account, branch, PR, or run a command…"
            className="flex-1 bg-transparent text-[14px] text-ac-text outline-none placeholder:text-ac-muted"
          />
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={() => setScope("all")}>
              <Chip kind={scope === "all" ? "meta" : "tag"}>All</Chip>
            </button>
            <button type="button" onClick={() => setScope("week")}>
              <Chip kind={scope === "week" ? "meta" : "tag"}>Last week</Chip>
            </button>
          </span>
        </div>
        <div className="max-h-[520px] relative overflow-y-auto p-2">
          {(["sessions", "branches", "commands"] as const).map((g) => {
            const list = ordered.filter((h) => h.group === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <Label className="mt-1 px-2">{GROUP_LABEL[g]}</Label>
                {list.map((h) => {
                  row++;
                  const on = row === cursor;
                  return (
                    <div key={h.id} role="option" aria-selected={on} onClick={() => onOpen(h, false)} className={cn("flex h-9 items-center gap-2.5 rounded-md px-2.5", on && "bg-ac-raise")}>
                      <span className="inline-flex size-4 shrink-0 items-center justify-center text-ac-muted [&_svg]:size-4">
                        {h.state ? <SessionStateIcon state={h.state} /> : g === "branches" ? <Hash /> : <ArrowRight />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ac-text">{h.title}</span>
                      {h.meta && <span className="shrink-0 truncate text-[11px] text-ac-muted">{h.meta}</span>}
                      {on && h.hint && <Kbd>{h.hint}</Kbd>}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!ordered.length && <div className="px-2.5 py-3 text-[13px] text-ac-muted">Nothing matches.</div>}
        </div>
        <div className="flex items-center gap-3 border-t border-ac-line px-4 py-2 text-[11px] text-ac-muted">
          <span>
            <Kbd>↑↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>⌘↵</Kbd> in new tab
          </span>
          <span className="ml-auto">
            <Kbd>&gt;</Kbd> commands only
          </span>
        </div>
      </div>
    </Overlay>
  );
}

// ---------- ⌃Tab switcher ----------

export interface RecentSession {
  key: string;
  title: string;
  state: SessionState;
  account: string;
  color: IdentityColor;
  branch: string | null;
  needsYou: boolean;
}

export function Switcher({ recent, pick, onClose }: { recent: RecentSession[]; pick: number; onClose: () => void }) {
  return (
    <Overlay top={160} onClose={onClose}>
      <div role="dialog" aria-label="Recent sessions" className="w-[520px] overflow-hidden rounded-xl border border-ac-line2 bg-ac-panel p-2" style={{ boxShadow: "var(--ac-shadow)" }}>
        <Label className="px-2 pt-1" aside="hold ⌃, press Tab">
          Recent sessions
        </Label>
        {recent.map((s, i) => (
          <div key={s.key} aria-current={i === pick ? "true" : undefined} className={cn("relative flex h-11 items-center gap-2.5 rounded-md px-2.5", i === pick && "bg-ac-raise")}>
            {i === pick && <Marker />}
            <SessionStateIcon state={s.state} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ac-text">{s.title}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-ac-muted">
                <AccountMark color={s.color} className="h-2.5" /> {s.account} · <span className="truncate font-ac-mono text-[10.5px]">{s.branch ?? "no repo"}</span>
              </span>
            </span>
            {s.needsYou && (
              <Chip kind="status" tone="warn">
                needs you
              </Chip>
            )}
            {i < 9 && <span className="font-ac-mono text-[10.5px] text-ac-muted">⌘{i + 1}</span>}
          </div>
        ))}
      </div>
    </Overlay>
  );
}

// ---------- hover peek ----------

export interface PeekFacts {
  title: string;
  lastActiveMs: number;
  tool: string;
  account: string;
  color: IdentityColor;
  model: string | null;
  thinking: string | null;
  branch: string | null;
  pr: { number: number; state: string } | null;
  children: number;
  lastLine: string | null;
}

export function PeekCard({ f, nowMs }: { f: PeekFacts; nowMs: number }) {
  return (
    <div role="tooltip" className="w-[300px] rounded-xl border border-ac-line2 bg-ac-panel p-3 text-[12px]" style={{ boxShadow: "var(--ac-shadow)" }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-ac-text">{f.title}</span>
        <span className="shrink-0 text-[11px] text-ac-muted">{duration(nowMs - f.lastActiveMs)} ago</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-ac-soft">
        <AccountMark color={f.color} /> {f.tool} · {f.account}
        {f.model && <> · {f.model}</>}
        {f.thinking && <> · {f.thinking}</>}
      </div>
      <div className="mt-1 truncate text-ac-muted">
        <span className="font-ac-mono">{f.branch ?? "no repo"}</span>
        {f.pr && (
          <>
            {" "}
            · #{f.pr.number} {f.pr.state}
          </>
        )}
        {f.children > 0 && <> · {f.children} children</>}
      </div>
      {f.lastLine && <div className="mt-1.5 truncate font-ac-mono text-[11px] text-ac-muted">{f.lastLine}</div>}
    </div>
  );
}

// ---------- inbox popover ----------

export interface DoneItem {
  id: string;
  who: string;
  what: string;
  doneAt: string;
}

export function InboxPopover({ items, history, focusedId, nowMs, onVerb, onAllLater }: { items: NeedItem[]; history: DoneItem[]; focusedId: string | null; nowMs: number; onVerb: (n: NeedItem) => void; onAllLater: () => void }) {
  const focus = focusedId ?? items[0]?.id ?? null;
  return (
    <div role="dialog" aria-label="Needs you" className="w-[420px] rounded-xl border border-ac-line2 bg-ac-panel p-2" style={{ boxShadow: "var(--ac-shadow)" }}>
      <div className="flex h-8 items-center gap-2 px-2">
        <span className="text-[13px] font-medium text-ac-text">Needs you</span>
        <span className="text-[11px] text-ac-muted">⌘J next · ↵ do it · L later</span>
        <button type="button" onClick={onAllLater} className="ml-auto text-[11px] text-ac-muted hover:text-ac-text">
          All later
        </button>
      </div>
      {items.map((n) => (
        <NeedRow key={n.id} n={n} focused={n.id === focus} onVerb={onVerb} />
      ))}
      {history.length > 0 && (
        <>
          <Label className="mt-2 px-2">Earlier today</Label>
          {history.map((h) => (
            <div key={`${h.id}-${h.doneAt}`} className="flex h-6 items-center gap-2 px-2 text-[12px]">
              <Check className="size-3.5 text-ac-ok" />
              <span className="min-w-0 flex-1 truncate text-ac-soft">
                {h.who} {h.what}
              </span>
              <span className="shrink-0 text-[11px] text-ac-faint">{duration(nowMs - Date.parse(h.doneAt))} ago</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
