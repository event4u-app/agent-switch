import { useEffect, useState, type ReactNode } from "react";
import { Bell, History, House, Layers, MessageSquare, Plus, Settings, Stethoscope, TriangleAlert, Wrench, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { AppLogo } from "../ui/AppLogo.js";
import { Button, IconButton } from "../ui/Button.js";
import { updateCount } from "../vm/rules.js";
import { useAS, type Screen } from "../vm/store.js";
import { CommandSearch } from "./CommandSearch.js";
import { checksToLook } from "./screens/health.js";

const PLACES: { id: Exclude<Screen, "activity" | "health" | "settings">; label: string; icon: typeof House }[] = [
  { id: "home", label: "Overview", icon: House },
  { id: "sessions", label: "Sessions", icon: MessageSquare },
  { id: "accounts", label: "Accounts", icon: Layers },
  { id: "tools", label: "Tools", icon: Wrench },
];

const READINESS_LABEL = { starting: "Starting", ready: "Ready", degraded: "Degraded", "needs-action": "Needs action" } as const;

function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1040 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

/** 52 px top bar; the whole bar is the Tauri drag region (bundle `SP`, app L486). */
export function TopBar({ isMac }: { isMac: boolean }) {
  const s = useAS();
  const width = useWindowWidth();
  const toCheck = checksToLook(s.checks).length;
  const label = READINESS_LABEL[s.readiness];
  const tone =
    s.readiness === "ready" ? (toCheck ? "warn" : "ok") : s.readiness === "starting" ? "neutral" : s.readiness === "degraded" ? "warn" : "alert";
  const unread = s.notices.filter((n) => n.unread).length;
  const updates = updateCount(s.tools);
  const counts: Partial<Record<Screen, number>> = {
    sessions: s.sessions.filter((x) => x.state !== "done").length,
    accounts: s.accounts.length,
  };
  const wide = width >= 1000;

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative flex h-[52px] shrink-0 items-center gap-2 border-b border-ac-line bg-ac-panel pr-3",
        isMac ? "pl-[84px]" : "pl-3",
      )}
    >
      <button type="button" onClick={() => s.go("home")} className="mr-1 flex items-center gap-2.5 rounded-md" aria-label={"Agent Switch — Home"}>
        <AppLogo className="size-8" />
        <span
          className={cn(
            "shrink-0 flex-col items-start whitespace-nowrap text-left leading-none",
            width >= 1440 ? "flex" : "hidden",
          )}
        >
          <span className="font-display text-[16px] tracking-[0.02em] text-ac-text">AGENT SWITCH</span>
          <span className="mt-1 text-[9px] font-semibold tracking-[0.3em] text-ac-brand-text">SESSION CONTROL</span>
        </span>
      </button>
      <nav aria-label="Places" className="flex items-center gap-0.5">
        {PLACES.map(({ id, label: placeLabel, icon: Icon }) => {
          const current = s.screen === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={current ? "page" : undefined}
              title={placeLabel}
              onClick={() => s.go(id)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                current
                  ? "bg-ac-brand-tint text-ac-text shadow-[inset_0_0_0_1px_var(--ac-brand-line)]"
                  : "text-ac-muted hover:bg-ac-raise hover:text-ac-text",
              )}
            >
              <Icon className={cn("size-4", current ? "text-ac-brand-text" : "")} />
              {wide && <span>{placeLabel}</span>}
              {wide && id !== "tools" && counts[id] != null && (
                <span className="font-ac-mono text-[11px] text-ac-faint">{counts[id]}</span>
              )}
              {id === "tools" && updates > 0 && (
                <span
                  className={cn(
                    "rounded-full bg-ac-info-tint font-ac-mono text-[10px] leading-4 text-ac-info-text",
                    wide ? "px-1.5" : "-ml-1 px-1",
                  )}
                  title={`${updates} updates`}
                >
                  {updates}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div data-tauri-drag-region className="min-w-2 flex-1 self-stretch" />
      <CommandSearch collapsed={width < 1240} />
      <Button variant="primary" size="md" onClick={() => s.open({ kind: "start" })} aria-label="Start session" title={"Start session (⌘N)"}>
        <Plus />
        {width >= 760 && <span>Start session</span>}
      </Button>
      <button
        type="button"
        onClick={() => s.go("health")}
        title={`${label}${toCheck ? ` · ${toCheck} to check` : ""}`}
        aria-label={`Health: ${label}${toCheck ? `, ${toCheck} to check` : ""}`}
        aria-current={s.screen === "health" ? "page" : undefined}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium",
          tone === "ok" && "text-ac-ok-text hover:bg-ac-raise",
          tone === "warn" && "bg-ac-warn-tint text-ac-warn-text",
          tone === "alert" && "bg-ac-alert-tint text-ac-alert-text",
          tone === "neutral" && "text-ac-muted hover:bg-ac-raise",
          s.screen === "health" && "shadow-[inset_0_0_0_1px_var(--ac-brand-line)]",
        )}
      >
        <Stethoscope className="size-4" />
        {width >= 1180 && <span>{toCheck && s.readiness === "ready" ? `${toCheck} to check` : label}</span>}
        {width < 1180 && toCheck > 0 && <span className="font-ac-mono">{toCheck}</span>}
      </button>
      <IconButton label="Activity" active={s.screen === "activity"} onClick={() => s.go("activity")} className={width < 640 ? "hidden" : ""}>
        <History />
      </IconButton>
      <IconButton
        label="Notifications"
        badge={unread ? (unread > 9 ? "9+" : unread) : undefined}
        active={s.overlay.kind === "notifications"}
        onClick={() => s.open({ kind: "notifications" })}
      >
        <Bell />
      </IconButton>
      <IconButton label="Settings" active={s.screen === "settings"} onClick={() => s.go("settings", "general")}>
        <Settings />
      </IconButton>
    </header>
  );
}

/** role=alert strip above the content (bundle `jP`). */
export function ErrorBanner() {
  const s = useAS();
  if (!s.error) return null;
  return (
    <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ac-alert bg-ac-alert-tint px-4 py-3">
      <span className="flex min-w-0 items-center gap-2.5 text-xs text-ac-alert-text">
        <TriangleAlert className="size-4 shrink-0" />
        {s.error}
      </span>
      <span className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => s.go("health")}>
          Open Health
        </Button>
        <IconButton label="Dismiss" onClick={() => s.update({ error: null })}>
          <X />
        </IconButton>
      </span>
    </div>
  );
}

/** ⌘N start session, ⌘, settings (⌘K lives in CommandSearch). Bundle `CP`. */
export function useGlobalShortcuts() {
  const s = useAS();
  const { open, go } = s;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === "n") {
        e.preventDefault();
        open({ kind: "start" });
      } else if (e.key === ",") {
        e.preventDefault();
        go("settings", "general");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);
}

/** Top bar + scrolling content column (bundle `NP`). */
export function Shell({ isMac, children }: { isMac: boolean; children: ReactNode }) {
  useGlobalShortcuts();
  return (
    <div className="flex h-full min-h-0 flex-col bg-ac-bg">
      <TopBar isMac={isMac} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-10 pt-6 sm:px-6">
          <ErrorBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
