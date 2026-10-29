import { AppWindow, Plus, Power } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { AppLogo } from "../../ui/AppLogo.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { SessionStateIcon } from "../../ui/SessionStateIcon.js";
import { nextInPools, rankAccounts, TOOL_LABEL, updateCount } from "../../vm/rules.js";
import { useAS, type Overlay } from "../../vm/store.js";
import type { Account, Attention } from "../../vm/types.js";
import type { ForwardedScreen } from "./bridge.js";
import { accountTools, appFor } from "../screens/logic.js";
import { CompactAccountRow } from "../screens/rows.js";

export type AttentionTarget = { overlay: Overlay } | { screen: ForwardedScreen };

/** Where an attention item leads: its decision sheet, the account to sign in
 *  again, or the screen that resolves it. null → just the window. */
export function attentionTarget(a: Attention): AttentionTarget | null {
  switch (a.kind) {
    case "near-limit":
      return { overlay: { kind: "limit", attentionId: a.id } };
    case "signed-out":
    case "reauth":
      return a.accountId ? { overlay: { kind: "account", id: a.accountId } } : null;
    case "update":
      return { screen: "tools" };
    case "health":
      return { screen: "health" };
    default:
      return null;
  }
}

/** Tray popover, 340 px card (bundle `CR`, artboard 16). Rendered in its own
 *  borderless window next to the menu-bar icon. An attention item opens what
 *  resolves it (overlays reach the main window through TrayBridge; screens via
 *  `onGo`). */
export function Tray({
  onOpenApp,
  onQuit,
  onGo,
  onOpenAccountApp,
}: {
  onOpenApp?: () => void;
  onQuit?: () => void;
  onGo?: (screen: ForwardedScreen) => void;
  /** Launch an account's desktop app (Claude Desktop, …) without the window. */
  onOpenAccountApp?: (appId: string, accountId: string) => void;
}) {
  const s = useAS();
  const follow = (a: Attention) => {
    const t = attentionTarget(a);
    if (t && "overlay" in t) s.open(t.overlay);
    else if (t && onGo) onGo(t.screen);
    else onOpenApp?.();
  };
  const tools = accountTools(s.accounts);
  const open = s.sessions.filter((x) => x.state !== "done");
  const ready = s.readiness === "ready";
  const updates = updateCount(s.tools);
  const parked = open.filter((x) => x.state === "parked").length;
  const ctx = open.filter((x) => x.contextPct != null);
  return (
    <div className="flex w-[340px] flex-col overflow-hidden rounded-xl border border-ac-line2 bg-ac-panel shadow-[var(--ac-shadow)]">
      <header className="flex items-center gap-2.5 border-b border-ac-line px-3 py-2.5">
        <AppLogo className="size-7" />
        <span className="font-display text-[14px] tracking-[0.02em] text-ac-text">AGENT SWITCH</span>
        <span className="flex-1" />
        <span className={cn("inline-flex items-center gap-1.5 text-[11px]", ready ? "text-ac-ok-text" : "text-ac-warn-text")}>
          <span className={cn("size-1.5 rounded-full", ready ? "bg-ac-ok" : "bg-ac-warn")} />
          {ready ? "Ready" : "Check health"}
        </span>
      </header>
      {s.attention.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-ac-line p-2">
          {s.attention.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => follow(a)}
              className="flex items-center gap-2.5 rounded-md bg-ac-warn-tint px-2.5 py-2 text-left"
            >
              <span className="size-2 shrink-0 rounded-full bg-ac-warn" />
              <span className="min-w-0 flex-1 truncate text-xs text-ac-text">{a.title}</span>
              <span className="text-[11px] font-medium text-ac-warn-text">{a.primary}</span>
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[360px] overflow-y-auto p-1">
        {tools.map((tool) => {
          const nextIn = nextInPools(s.accounts, tool, s.pools, s.now);
          const appId = onOpenAccountApp ? appFor(s, tool) : null;
          const appName = s.surfaces.find((x) => x.id === appId)?.name ?? "app";
          const usable = (a: Account) => !a.disabled && a.state !== "signed-out" && a.state !== "wrong-account";
          return (
            <div key={tool} className="flex flex-col">
              <span className="ac-caps px-3 pb-0.5 pt-2.5">{TOOL_LABEL[tool]}</span>
              {rankAccounts(s.accounts, tool, s.now).map((r) => (
                <CompactAccountRow
                  key={r.account.id}
                  account={r.account}
                  ranked={r}
                  nextIn={nextIn.get(r.account.id)}
                  app={appId && onOpenAccountApp && usable(r.account) ? { name: appName, onOpen: () => onOpenAccountApp(appId, r.account.id) } : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap border-t border-ac-line px-3 py-2 text-[11px] text-ac-muted">
        <span className="inline-flex items-center gap-1.5">
          <SessionStateIcon state="working" /> {open.filter((x) => x.state === "working").length} working
        </span>
        {ctx.length > 0 && (
          <>
            <span>·</span>
            <span title="Fullest context window of a running session">ctx {Math.max(...ctx.map((x) => x.contextPct ?? 0))}%</span>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {parked > 0 && <Badge>{parked} paused</Badge>}
          {updates > 0 && (
            <Badge tone="info">
              {updates} update{updates === 1 ? "" : "s"}
            </Badge>
          )}
        </span>
      </div>
      <footer className="flex items-center gap-2 border-t border-ac-line p-2">
        <Button size="sm" variant="primary" className="flex-1" onClick={() => s.open({ kind: "start" })}>
          <Plus /> Start session
        </Button>
        <Button size="sm" onClick={onOpenApp}>
          <AppWindow /> Open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onQuit ?? (() => void s.act.quit?.())}
          aria-label="Quit Agent Switch"
          title="Quit Agent Switch"
        >
          <Power />
        </Button>
      </footer>
    </div>
  );
}
