/**
 * Menus and the Open-in split button (spec §7.4, §7.7), adapted from the
 * reference boards' `menus.tsx`. A menu is a floating layer the window places;
 * it never sits inside a bar that clips its children.
 */

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Code, Folder, GitPullRequest, Laptop, Settings2, SquareTerminal } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Kbd } from "../ui/Typography.js";
import type { OpenTarget } from "./settings.js";

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
  onClick?: () => void;
  onHover?: () => void;
}

export function Menu({ items, width = 260, label, className }: { items: MenuItem[]; width?: number; label?: string; className?: string }) {
  return (
    <div role="menu" aria-label={label} className={cn("rounded-xl border border-ac-line2 bg-ac-panel p-1", className)} style={{ width, boxShadow: "var(--ac-shadow)" }}>
      {items.map((it, i) =>
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
            aria-haspopup={it.sub || undefined}
            aria-expanded={it.sub ? !!it.active : undefined}
            aria-disabled={it.disabled || undefined}
            onClick={it.disabled ? undefined : it.onClick}
            onMouseEnter={it.onHover}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px]",
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
export function OpenInButton({ def, open, onDefault, onMenu }: { def: { label: string; mono: string } | null; open: boolean; onDefault: () => void; onMenu: () => void }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-ac-line2 bg-ac-raise text-xs text-ac-soft">
      <button type="button" onClick={onDefault} disabled={!def} title={def ? `Open in ${def.label} (default) · ⌘O` : "No default target — choose one in Settings › Open in"} className="inline-flex items-center gap-1.5 px-2 hover:text-ac-text disabled:opacity-50">
        {def && <AppMono m={def.mono} />}
        Open
      </button>
      <button type="button" aria-label="Open in…" aria-haspopup="menu" aria-expanded={open} onClick={onMenu} className={cn("inline-flex items-center border-l border-ac-line2 px-1.5 hover:text-ac-text", open && "bg-ac-bg text-ac-text")}>
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
}

/** The pick a menu row makes: a target id, the agent app, the PR, focus, or the settings. */
export type OpenPick = { kind: "target"; target: string } | { kind: "app"; app: string } | { kind: "pr"; url: string } | { kind: "focus" } | { kind: "configure" };

type Sub = "editor" | "app" | "terminal" | "files" | "web";

/** The default target and the last used one, then a submenu per kind (spec §7.7). Missing apps stay hidden here; the Editor submenu names them. */
export function OpenInMenu({ f, onPick }: { f: OpenFacts; onPick: (p: OpenPick) => void }) {
  const [sub, setSub] = useState<Sub | null>(null);
  const installed = f.targets.filter((t) => t.installed);
  const byId = (id: string | null) => installed.find((t) => t.target === id) ?? null;
  const def = byId(f.defaultTarget);
  const last = f.lastUsed && f.lastUsed !== f.defaultTarget ? byId(f.lastUsed) : null;
  const target = (t: OpenTarget, hint?: string, kbd?: string): MenuItem => ({ id: t.target, label: t.label, icon: <AppMono m={monogram(t.target, t.label)} />, hint, kbd, checked: hint === "default" && !kbd, onClick: () => onPick({ kind: "target", target: t.target }) });
  const subItem = (id: Sub, label: string, icon: ReactNode, hint?: string): MenuItem => ({ id, label, icon, hint, sub: true, active: sub === id, onClick: () => setSub((s) => (s === id ? null : id)), onHover: () => setSub(id) });

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
    terminal: [...(f.focusable ? [{ id: "focus", label: "Bring its terminal to the front", icon: <SquareTerminal />, onClick: () => onPick({ kind: "focus" }) }] : []), ...kind("terminal")],
    files: kind("files"),
    web: f.pr ? [{ id: "pr", label: `PR #${f.pr.number} on GitHub`, icon: <GitPullRequest />, onClick: () => onPick({ kind: "pr", url: f.pr!.url }) }, { id: "checks", label: "Checks", icon: <GitPullRequest />, onClick: () => onPick({ kind: "pr", url: `${f.pr!.url}/checks` }) }] : [],
  };
  const open = sub ? subItems[sub] : [];
  return (
    <div className="flex flex-row-reverse items-start gap-1">
      <Menu label="Open in" width={268} items={main} />
      {sub && <Menu label={sub === "app" ? "Agent app" : sub[0].toUpperCase() + sub.slice(1)} width={sub === "app" ? 280 : 260} items={open.length ? open : [{ label: "", note: "Nothing found on this Mac." }]} />}
    </div>
  );
}
