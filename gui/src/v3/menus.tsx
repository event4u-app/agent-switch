/**
 * Menus and the Open-in split button (spec §7.4, §7.7), adapted from the
 * reference boards' `menus.tsx`. A menu is a floating layer the window places;
 * it never sits inside a bar that clips its children.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Code, Folder, GitPullRequest, Laptop, Settings2, SquareTerminal } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Kbd } from "../ui/Typography.js";
import type { OpenTarget } from "./settings.js";
import { useLayerFocus } from "./focus.js";

export interface MenuItem {
  id?: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  kbd?: string;
  sub?: boolean;
  active?: boolean;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  /** A wrapped explanatory line instead of an item. */
  note?: string;
  /** A section heading: the items after it, up to the next section, form a labelled group. */
  section?: string;
  /** Opens this item's submenu from the keyboard (→, Enter) and moves focus into it. */
  onKeyOpen?: () => void;
  /** Why a disabled item is off: its tooltip and accessible description. */
  why?: string;
  onClick?: () => void;
  onHover?: () => void;
}

/** Marks the button that opens a floating layer, so pressing it again toggles instead of closing and reopening. */
export const POPOVER_TRIGGER = { "data-popover-trigger": "" } as const;

/**
 * A floating layer anchored in the window. It closes on a press anywhere outside
 * itself or on Esc (spec §7.4), takes focus on open and gives it back on close,
 * and shifts itself back inside the window when its place would cut it off.
 */
export function Anchored({ className, style, onClose, children }: { className?: string; style?: CSSProperties; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [shift, setShift] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  useLayerFocus(ref);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest?.("[data-popover-trigger]")) return;
      close.current();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  // Shift into the window: measured once laid out, against the element it is placed in.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.offsetParent?.getBoundingClientRect();
    if (!el || !box || !box.width) return;
    const r = el.getBoundingClientRect();
    const x = r.right > box.right - 4 ? box.right - 4 - r.right : r.left < box.left + 4 ? box.left + 4 - r.left : 0;
    const y = r.bottom > box.bottom - 4 ? Math.max(box.top + 4 - r.top, box.bottom - 4 - r.bottom) : 0;
    setShift((o) => (o.x === x && o.y === y ? o : { x, y }));
  }, [style?.top, style?.left, style?.right]);
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    close.current();
  };
  return (
    <div ref={ref} className={className} style={shift.x || shift.y ? { ...style, transform: `translate(${shift.x}px, ${shift.y}px)` } : style} onKeyDown={key}>
      {children}
    </div>
  );
}

/** One heading style for every section of a flyout: a labelled group under the caps heading. */
export function MenuSection({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <div className={cn("ac-caps px-2 pb-1.5 pt-2", className)}>{title}</div>
      {children}
    </div>
  );
}

/** The rows of this menu (not of a submenu) that can be picked. */
const enabledItems = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((b) => b.closest('[role="menu"]') === menu && b.getAttribute("aria-disabled") !== "true");

/**
 * A menu (spec §7.4) that works from the keyboard: ↑↓ Home End move, Enter or
 * Space picks, → opens a submenu, ← and Esc leave one (`onBack`), and a key
 * printed on a row picks that row.
 */
export function Menu({ items, width = 260, label, className, autoFocus, onBack }: { items: MenuItem[]; width?: number; label?: string; className?: string; autoFocus?: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus && ref.current) enabledItems(ref.current)[0]?.focus();
  }, [autoFocus]);
  const itemOf = (el: Element) => items.find((it, i) => (it.id ?? String(i)) === el.getAttribute("data-item"));
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const menu = ref.current;
    if (!menu || e.metaKey || e.ctrlKey || e.altKey) return;
    const list = enabledItems(menu);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const item = at >= 0 ? itemOf(list[at]) : undefined;
    const move = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at < 0 ? -1 : at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(-1);
    else if ((e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") && item?.sub && item.onKeyOpen) item.onKeyOpen();
    else if ((e.key === "Enter" || e.key === " ") && at >= 0) list[at].click();
    else if ((e.key === "ArrowLeft" || e.key === "Escape") && onBack) onBack();
    else {
      const hit = e.key.length === 1 && e.key !== " " ? list.find((b) => itemOf(b)?.kbd === e.key) : undefined;
      if (!hit) return;
      hit.click();
    }
    e.preventDefault();
    e.stopPropagation();
  };
  const row = (it: MenuItem, i: number) =>
    it.note ? (
      <p key={i} className="px-2 py-1.5 text-[11.5px] leading-snug text-ac-muted">
        {it.note}
      </p>
    ) : it.divider ? (
      <div key={i} role="separator" className="my-1 h-px bg-ac-line" />
    ) : (
      <button
        key={it.id ?? i}
        type="button"
        role="menuitem"
        data-item={it.id ?? String(i)}
        aria-haspopup={it.sub || undefined}
        aria-expanded={it.sub ? !!it.active : undefined}
        aria-disabled={it.disabled || undefined}
        title={it.why}
        aria-description={it.why}
        onClick={it.disabled ? undefined : it.onClick}
        onMouseEnter={it.onHover}
        className={cn(
          "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none focus-visible:bg-ac-raise focus-visible:text-ac-text",
          it.active ? "bg-ac-raise text-ac-text" : "text-ac-soft",
          it.disabled ? "cursor-default text-ac-faint" : "hover:bg-ac-raise",
          it.danger && "text-ac-alert-text",
        )}
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-ac-muted [&_svg]:size-4">{it.checked ? <Check className="text-ac-brand-text" /> : it.icon}</span>
        <span className="min-w-0 flex-1 truncate">{it.label}</span>
        {it.hint && <span className="shrink-0 truncate text-[11px] text-ac-muted">{it.hint}</span>}
        {it.kbd && <Kbd>{it.kbd}</Kbd>}
        {it.sub && <ChevronRight className="size-3.5 shrink-0 text-ac-faint" />}
      </button>
    );
  // Rows before the first section stand alone; each section groups the rows up to the next one.
  const parts: { title?: string; rows: [MenuItem, number][] }[] = [{ rows: [] }];
  items.forEach((it, i) => (it.section ? parts.push({ title: it.section, rows: [] }) : parts[parts.length - 1].rows.push([it, i])));
  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={key} className={cn("rounded-xl border border-ac-line2 bg-ac-panel p-1", className)} style={{ width, boxShadow: "var(--ac-shadow)" }}>
      {parts.map((p, n) =>
        p.title ? (
          <MenuSection key={`s${n}`} title={p.title}>
            {p.rows.map(([it, i]) => row(it, i))}
          </MenuSection>
        ) : (
          p.rows.map(([it, i]) => row(it, i))
        ),
      )}
    </div>
  );
}

/** Monogram for an app without a usable glyph — one style for all. */
export function AppMono({ m }: { m: string }) {
  return <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-ac-raise font-ac-mono text-[9px] font-semibold text-ac-soft">{m}</span>;
}

const MONO: Record<string, string> = { phpstorm: "PS", idea: "IJ", vscode: "VS", cursor: "Cu", zed: "Z", "claude-desktop": "C", "codex-desktop": "Cx", terminal: "T", finder: "F" };
/** "PS" for PhpStorm; the first two letters of the label for anything else. Pure. */
export const monogram = (target: string, label: string): string => MONO[target] ?? label.replace(/[^A-Za-z]/g, "").slice(0, 2);

/** Split button: the main part opens the default target (⌘O), the caret opens the menu. */
export function OpenInButton({ def, open, onDefault, onMenu }: { def: { label: string; mono: string } | null; open: boolean; onDefault: () => void; onMenu: (trigger: HTMLElement) => void }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-ac-line2 bg-ac-raise text-xs text-ac-soft">
      <button type="button" onClick={onDefault} disabled={!def} title={def ? `Open in ${def.label} (default) · ⌘O` : "No default target — choose one in Settings › Open in"} className="inline-flex items-center gap-1.5 px-2 hover:text-ac-text disabled:opacity-50">
        {def && <AppMono m={def.mono} />}
        Open
      </button>
      <button type="button" data-popover-trigger="" aria-label="Open in…" aria-haspopup="menu" aria-expanded={open} onClick={(e) => onMenu(e.currentTarget)} className={cn("inline-flex items-center border-l border-ac-line2 px-1.5 hover:text-ac-text", open && "bg-ac-bg text-ac-text")}>
        <ChevronDown className="size-3.5" />
      </button>
    </span>
  );
}

/** What Open-in can reach for one session. */
export interface OpenFacts {
  targets: OpenTarget[];
  defaultTarget: string | null;
  lastUsed: string | null;
  /** The desktop app of the session's own tool; never another tool's. */
  agentApp: { id: string; label: string } | null;
  pr: { number: number; url: string } | null;
  /** The session runs in the user's own terminal and can be brought to the front. */
  focusable: boolean;
  /** A hosted session the user's terminal can join (`host attach`). */
  attachable?: boolean;
}

/** The pick a menu row makes: a target id, the agent app, the PR, focus, or the settings. */
export type OpenPick = { kind: "target"; target: string } | { kind: "app"; app: string } | { kind: "pr"; url: string } | { kind: "focus" } | { kind: "attach" } | { kind: "configure" };

type Sub = "editor" | "app" | "terminal" | "files" | "web";

/** The default target and the last used one, then a submenu per kind (spec §7.7). Missing apps stay hidden here; the Editor submenu names them. */
export function OpenInMenu({ f, onPick }: { f: OpenFacts; onPick: (p: OpenPick) => void }) {
  const [sub, setSub] = useState<Sub | null>(null);
  // A submenu opened from the keyboard takes focus; one opened by hover leaves it where it is.
  const [keyed, setKeyed] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const back = () => {
    const row = wrap.current?.querySelector<HTMLElement>(`[data-item="${sub}"]`);
    setSub(null);
    row?.focus();
  };
  const installed = f.targets.filter((t) => t.installed);
  const byId = (id: string | null) => installed.find((t) => t.target === id) ?? null;
  const def = byId(f.defaultTarget);
  const last = f.lastUsed && f.lastUsed !== f.defaultTarget ? byId(f.lastUsed) : null;
  const target = (t: OpenTarget, hint?: string, kbd?: string): MenuItem => ({ id: t.target, label: t.label, icon: <AppMono m={monogram(t.target, t.label)} />, hint, kbd, checked: hint === "default" && !kbd, onClick: () => onPick({ kind: "target", target: t.target }) });
  const subItem = (id: Sub, label: string, icon: ReactNode, hint?: string): MenuItem => ({ id, label, icon, hint, sub: true, active: sub === id, onClick: () => (setKeyed(false), setSub(id)), onHover: () => (setKeyed(false), setSub(id)), onKeyOpen: () => (setKeyed(true), setSub(id)) });

  const main: MenuItem[] = [
    ...(def ? [target(def, "default", "1")] : []),
    ...(last ? [target(last, "last used", def ? "2" : "1")] : []),
    ...(def || last ? [{ divider: true, label: "" }] : []),
    subItem("editor", "Editor", <Code />),
    ...(f.agentApp ? [subItem("app", "Agent app", <Laptop />)] : []),
    subItem("terminal", "Terminal", <SquareTerminal />),
    subItem("files", "Files", <Folder />),
    ...(f.pr ? [subItem("web", "Web", <GitPullRequest />, `PR #${f.pr.number}`)] : []),
    { divider: true, label: "" },
    { id: "configure", label: "Configure targets…", icon: <Settings2 />, onClick: () => onPick({ kind: "configure" }) },
  ];

  const kind = (k: OpenTarget["kind"]) => installed.filter((t) => t.kind === k).map((t) => target(t, t.target === f.defaultTarget ? "default" : undefined));
  const subItems: Record<Sub, MenuItem[]> = {
    editor: [
      ...f.targets.filter((t) => t.kind === "editor").map((t) => (t.installed ? target(t, t.target === f.defaultTarget ? "default" : undefined) : { id: t.target, label: t.label, icon: <AppMono m={monogram(t.target, t.label)} />, hint: "not installed", disabled: true })),
      ...(f.pr ? [{ divider: true, label: "" }, { id: "pr", label: "Open PR on GitHub", icon: <GitPullRequest />, onClick: () => onPick({ kind: "pr", url: f.pr!.url }) }] : []),
    ],
    app: f.agentApp
      ? [
          { id: f.agentApp.id, label: f.agentApp.label, icon: <AppMono m={monogram(f.agentApp.id, f.agentApp.label)} />, hint: "opens this project", onClick: () => onPick({ kind: "app", app: f.agentApp!.id }) },
          { label: "", note: "Only the app for this session's tool is offered. Continuing the same conversation there appears only where that app supports it." },
        ]
      : [],
    terminal: [
      ...(f.attachable
        ? [
            { id: "attach", label: "Attach in Terminal", icon: <SquareTerminal />, hint: "tmux", onClick: () => onPick({ kind: "attach" }) },
            { label: "", note: "One shared session: typing on either side goes to the same agent." },
            { divider: true, label: "" },
          ]
        : []),
      ...(f.focusable ? [{ id: "focus", label: "Bring its terminal to the front", icon: <SquareTerminal />, onClick: () => onPick({ kind: "focus" }) }] : []),
      ...kind("terminal"),
    ],
    files: kind("files"),
    web: f.pr ? [{ id: "pr", label: `PR #${f.pr.number} on GitHub`, icon: <GitPullRequest />, onClick: () => onPick({ kind: "pr", url: f.pr!.url }) }, { id: "checks", label: "Checks", icon: <GitPullRequest />, onClick: () => onPick({ kind: "pr", url: `${f.pr!.url}/checks` }) }] : [],
  };
  const open = sub ? subItems[sub] : [];
  return (
    <div ref={wrap} className="flex flex-row-reverse items-start gap-1">
      <Menu label="Open in" width={268} items={main} />
      {sub && <Menu key={sub} autoFocus={keyed} onBack={back} label={sub === "app" ? "Agent app" : sub[0].toUpperCase() + sub.slice(1)} width={sub === "app" ? 280 : 260} items={open.length ? open : [{ label: "", note: "Nothing found on this Mac." }]} />}
    </div>
  );
}
