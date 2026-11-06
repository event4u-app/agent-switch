import { useEffect, useState, type ReactNode } from "react";
import { Bell, History, House, Layers, MessageSquare, Plus, Settings, Stethoscope, TriangleAlert, Wrench, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { AppLogo } from "../ui/AppLogo.js";
import { Button, IconButton } from "../ui/Button.js";
import { updateCount } from "../vm/rules.js";
import { useAS, type Screen } from "../vm/store.js";
import { useServiceOutcomes } from "../vm/service-outcomes.js";
import { CommandSearch } from "./CommandSearch.js";
import { isAppShortcut } from "./shortcuts.js";
import { checksToLook } from "./screens/health.js";
import { t, tp, type TKey } from "../i18n/index.js";

/** Labels are keys: `t()` runs at render time, the language can change. */
const PLACES: { id: Exclude<Screen, "activity" | "health" | "settings">; labelKey: TKey; icon: typeof House }[] = [
  { id: "home", labelKey: "shell.places.home", icon: House },
  { id: "sessions", labelKey: "shell.places.sessions", icon: MessageSquare },
  { id: "accounts", labelKey: "shell.places.accounts", icon: Layers },
  { id: "tools", labelKey: "shell.places.tools", icon: Wrench },
];

const READINESS_LABEL = {
  starting: "shell.readiness.starting",
  ready: "shell.readiness.ready",
  degraded: "shell.readiness.degraded",
  "needs-action": "shell.readiness.needsAction",
} as const satisfies Record<string, TKey>;

/** The wordmark is the brand name, never translated. */
const WORDMARK = "AGENT SWITCH";

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
  const label = t(READINESS_LABEL[s.readiness]);
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
        "relative flex h-[52px] shrink-0 items-center gap-2 border-b border-ac-line bg-ac-panel pr-3 pt-1",
        isMac ? "pl-[84px]" : "pl-3",
      )}
    >
      <button type="button" onClick={() => s.go("home")} className="mr-1 flex items-center gap-2.5 rounded-md" aria-label={t("shell.brand.home")}>
        <AppLogo className="size-8" />
        <span
          className={cn(
            "shrink-0 flex-col items-start whitespace-nowrap text-left leading-none",
            width >= 1440 ? "flex" : "hidden",
          )}
        >
          <span className="font-display text-[16px] tracking-[0.02em] text-ac-text">{WORDMARK}</span>
          <span className="mt-1 text-[9px] font-semibold tracking-[0.3em] text-ac-brand-text">{t("shell.brand.tagline")}</span>
        </span>
      </button>
      <nav aria-label={t("shell.places.label")} className="flex items-center gap-0.5">
        {PLACES.map(({ id, labelKey, icon: Icon }) => {
          const placeLabel = t(labelKey);
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
                  title={tp("shell.places.updates", updates)}
                >
                  {updates}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div data-tauri-drag-region className="min-w-2 flex-1 self-stretch" />
      <CommandSearch collapsed={width < 1240} isMac={isMac} />
      <Button variant="primary" size="md" onClick={() => s.open({ kind: "start" })} aria-label={t("shell.start.label")} title={t("shell.start.title")}>
        <Plus />
        {width >= 760 && <span>{t("shell.start.label")}</span>}
      </Button>
      <button
        type="button"
        onClick={() => s.go("health")}
        title={toCheck ? t("shell.health.titleWithChecks", { label, count: toCheck }) : label}
        aria-label={toCheck ? t("shell.health.ariaWithChecks", { label, count: toCheck }) : t("shell.health.aria", { label })}
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
        {width >= 1180 && <span>{toCheck && s.readiness === "ready" ? t("shell.health.toCheck", { count: toCheck }) : label}</span>}
        {width < 1180 && toCheck > 0 && <span className="font-ac-mono">{toCheck}</span>}
      </button>
      <IconButton label={t("shell.activity")} active={s.screen === "activity"} onClick={() => s.go("activity")} className={width < 640 ? "hidden" : ""}>
        <History />
      </IconButton>
      <IconButton
        label={t("shell.notifications")}
        badge={unread ? (unread > 9 ? "9+" : unread) : undefined}
        active={s.overlay.kind === "notifications"}
        onClick={() => s.open({ kind: "notifications" })}
      >
        <Bell />
      </IconButton>
      <IconButton label={t("shell.settings")} active={s.screen === "settings"} onClick={() => s.go("settings", "general")}>
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
          {t("shell.error.openHealth")}
        </Button>
        <IconButton label={t("common.dismiss")} onClick={() => s.update({ error: null })}>
          <X />
        </IconButton>
      </span>
    </div>
  );
}

/** Without the shell integration a plain `claude` in a terminal ignores every
 *  profile, rule and pool, so this stays up, in red, until it is set up. */
export function ShellIntegrationBanner() {
  const s = useAS();
  const [busy, setBusy] = useState(false);
  const check = s.checks.find((c) => c.id === "shell-integration");
  if (!check || check.state === "ok" || check.state === "info") return null;
  const install = s.act.installShellIntegration;
  return (
    <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ac-alert bg-ac-alert-tint px-4 py-3">
      <span className="flex min-w-0 flex-1 items-start gap-2.5 text-ac-alert-text">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{t("shell.integration.title")}</span>
          <span className="block text-xs">{t("shell.integration.body")}</span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => s.open({ kind: "fix", checkId: check.id })}>
          {t("common.details")}
        </Button>
        {install && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              install()
                .then(() => s.toast({ tone: "ok", text: t("shell.integration.done") }))
                .catch((e: unknown) => s.toast({ tone: "alert", text: t("shell.integration.failed", { error: e instanceof Error ? e.message : String(e) }) }))
                .finally(() => setBusy(false));
            }}
          >
            <Wrench /> {busy ? t("shell.integration.settingUp") : t("shell.integration.setUpNow")}
          </Button>
        )}
      </span>
    </div>
  );
}

/** ⌘N start session, ⌘, settings (⌘K lives in CommandSearch). Bundle `CP`. */
export function useGlobalShortcuts(isMac: boolean) {
  const s = useAS();
  const { open, go } = s;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isAppShortcut(e, isMac)) return;
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
  }, [open, go, isMac]);
}

/** Top bar + scrolling content column (bundle `NP`). */
export function Shell({ isMac, children }: { isMac: boolean; children: ReactNode }) {
  useGlobalShortcuts(isMac);
  const s = useAS();
  useServiceOutcomes(s.switchRequests, s);
  return (
    <div className="flex h-full min-h-0 flex-col bg-ac-bg">
      <TopBar isMac={isMac} />
      {/* relative: absolute descendants (sr-only labels in rows) below the fold
          must overflow this column, not the document — or the window scrolls too. */}
      <main className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-10 pt-6 sm:px-6">
          <ErrorBanner />
          <ShellIntegrationBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
