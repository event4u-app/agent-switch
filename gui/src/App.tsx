import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Terminal, LogIn, X, AlertCircle, Info, Power, Trash2, Settings, AlertTriangle, AppWindow, History, ArrowRightLeft, RotateCcw, Pencil, Check } from "lucide-react";
import {
  deactivateProfile,
  getAutoSwitch,
  getAutostart,
  getProviders,
  listApps,
  listProfiles,
  listSessions,
  listNotifications,
  recordNotification,
  clearNotifications,
  loginArgs,
  openApp,
  profileUsage,
  redeemReset,
  takeoverArgs,
  quitApp,
  removeProfile,
  renameProfile,
  sessionArgs,
  setAutoSwitch,
  setAutostart,
  getSwitchStrategy,
  setSwitchStrategy,
  type SwitchStrategy,
  setProfileLabel,
  setProvider,
  switchProfile,
  uninstall,
  type AppInfo,
  type AutoSwitchMap,
} from "./ipc.js";
import { EmbeddedTerminal } from "./EmbeddedTerminal.js";
import { NotificationBell } from "./NotificationBell.js";
import { sendDesktopNotification, type AppNotification } from "./notifications.js";
import { applyTheme, getTheme, THEMES, type Theme } from "./theme.js";
import {
  getAutoSwitchGlobal,
  setAutoSwitchGlobalFlag,
  getAutoRefreshLimits,
  setAutoRefreshLimitsFlag,
  getRefreshMinutes,
  setRefreshMinutes,
  REFRESH_INTERVAL_CHOICES,
  getNotifLastRead,
  setNotifLastRead,
} from "./settings-store.js";
import { loadUsageCache, saveUsageSnapshot, type UsageEntry } from "./usage-cache.js";
import {
  groupByProvider,
  formatReset,
  hasUsageReadout,
  relativeAge,
  PROFILE_LABELS,
  type ProfileRow,
  type ProfileLabel,
  type UsageSnapshot,
  type ProviderId,
  type ProvidersStatus,
  type ProviderSurface,
  type SessionRow,
} from "./transforms.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROVIDERS: ProviderId[] = ["claude", "codex", "gemini"];
const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };

// On macOS the window uses the Overlay title-bar style (native traffic lights,
// content drawn into the title bar) — the header must leave room on the left so
// its content doesn't sit under the traffic lights.
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

function describeError(e: unknown): string {
  const msg = String((e as { message?: unknown })?.message ?? e);
  if (/not found|No such file|ENOENT|failed to (spawn|execute)|program/i.test(msg)) {
    return "agent-switch CLI not found on PATH — run `npm link` in the repo root (see README).";
  }
  return msg;
}

/** Utilization bar colour: green under 70%, amber under 90%, red at/above. */
function utilColor(pct: number): string {
  if (pct >= 90) return "hsl(var(--destructive))";
  if (pct >= 70) return "#d9a343";
  return "hsl(var(--success))";
}

// Fallback windows when we have NO snapshot at all — still show grey hatched
// "N.A." bars (rather than nothing) so a provider with a usage readout always
// has a stable bar area.
const PLACEHOLDER_WINDOWS: UsageSnapshot["windows"] = [
  { key: "five_hour", label: "5h", utilization: null, resetsAt: null },
  { key: "seven_day", label: "7d", utilization: null, resetsAt: null },
];

const HATCH = "repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.5) 0 3px, transparent 3px 6px)";

/**
 * Usage bars for one profile. Three states per window:
 *   - fresh value  → coloured fill + coloured % + reset countdown.
 *   - stale value (from cache, no live data yet) → GREY solid fill + grey % (last-known).
 *   - no value     → grey HATCHED track + "N.A.".
 * With no snapshot at all, PLACEHOLDER_WINDOWS render as hatched N.A.
 */
function UsageBars({ usage, stale }: { usage: UsageSnapshot | null; stale: boolean }) {
  const windows = usage && usage.windows.length > 0 ? usage.windows : PLACEHOLDER_WINDOWS;
  return (
    <div className="mt-1.5 space-y-1 pl-4">
      {windows.map((w) => {
        const known = typeof w.utilization === "number";
        const pct = Math.min(100, w.utilization ?? 0);
        const reset = known && !stale ? formatReset(w.resetsAt) : "";
        return (
          <div key={w.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 truncate text-muted-foreground" title={w.label}>{w.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              {!known ? (
                <div className="h-full w-full rounded-full opacity-70" style={{ backgroundImage: HATCH }} />
              ) : (
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: stale ? "hsl(var(--muted-foreground))" : utilColor(pct) }}
                />
              )}
            </div>
            <span
              className={cn("w-10 shrink-0 text-right tabular-nums", (!known || stale) && "text-muted-foreground")}
              style={known && !stale ? { color: utilColor(pct) } : undefined}
            >
              {known ? `${pct}%` : "N.A."}
            </span>
            <span className="w-16 shrink-0 text-muted-foreground">{reset}</span>
          </div>
        );
      })}
      {typeof usage?.resetCredits === "number" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-12 shrink-0">resets</span>
          <span className="tabular-nums">{usage.resetCredits} available</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [selected, setSelected] = useState<ProviderId>("claude");
  // Usage keyed by `<provider>/<name>`, seeded from the local cache so bars show
  // the last-known values (greyed) immediately, before any live fetch.
  const [usage, setUsage] = useState<Record<string, UsageEntry>>(() => loadUsageCache());
  const [autoRefresh, setAutoRefresh] = useState(() => getAutoRefreshLimits());
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [auto, setAuto] = useState<AutoSwitchMap | null>(null);
  const [providers, setProviders] = useState<ProvidersStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [globalAuto, setGlobalAuto] = useState(() => getAutoSwitchGlobal());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  // The in-app pty terminal overlay (login / run), or null when none is open.
  const [terminal, setTerminal] = useState<{ args: string[]; title: string } | null>(null);

  // Notifications (auto-switches, usage-fetch failures). The event log is owned
  // by the CLI + daemon; the GUI reads it on each refresh, renders the bell +
  // flyout, and fires a best-effort desktop notification for events it has not
  // notified yet. `notifNotifiedTsRef` starts at mount time so opening the app
  // never blasts the desktop with historical events (they still show in the
  // flyout). `notifLastRead` (persisted) drives the unread badge.
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifLastRead, setNotifLastReadState] = useState(() => getNotifLastRead());
  const notifNotifiedTsRef = useRef(Date.now());

  // Usage auto-refresh: a configurable timer (default 10 min, set in General
  // settings), shown as a live countdown by the footer refresh button. Tab
  // switches do NOT refresh (per user request) — only the timer and the manual
  // button do. `nextRefreshRef` is the wall-clock deadline; `nowTick` re-renders
  // the countdown each second. `refreshRef` holds the latest refresh closure so
  // the interval always fetches the current tab.
  const [refreshMin, setRefreshMin] = useState(() => getRefreshMinutes());
  const REFRESH_MS = refreshMin * 60 * 1000;
  const nextRefreshRef = useRef(Date.now() + REFRESH_MS);
  // Per-profile cooldown: skip a usage re-fetch when the last successful one is
  // newer than the refresh interval, so a manual refresh never fetches more
  // often than the auto-refresh countdown itself — it matches the countdown
  // exactly, which keeps Claude's rate-limited endpoint from being self-tripped.
  const USAGE_COOLDOWN_MS = REFRESH_MS;
  const lastUsageFetchRef = useRef<Record<string, number>>({});
  const refreshRef = useRef<() => void>(() => {});
  const [nowTick, setNowTick] = useState(Date.now());

  function act(fn: () => Promise<void>) {
    fn()
      .then(refresh)
      .catch((e) => setError(describeError(e)));
  }

  // Global auto-switch master. Turning it OFF hides the toggles/dots AND
  // deactivates every provider's auto-switch (nothing can auto-switch behind a
  // disabled master). Turning it back ON only re-exposes the per-provider
  // toggles — it never re-enables them.
  function toggleGlobalAuto(on: boolean) {
    setAutoSwitchGlobalFlag(on);
    setGlobalAuto(on);
    if (!on) {
      Promise.all(PROVIDERS.map((p) => setAutoSwitch(p, false)))
        .then(refresh)
        .catch((e) => setError(describeError(e)));
    }
  }

  async function refresh() {
    setBusy(true);
    let loaded: ProfileRow[];
    try {
      loaded = await listProfiles();
      setRows(loaded);
      setError(null);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
      return;
    }
    // Best-effort side data — never blanks the list on failure.
    try {
      setAuto(await getAutoSwitch());
    } catch {
      /* leave previous */
    }
    try {
      setProviders(await getProviders());
    } catch {
      /* leave previous */
    }
    setApps(await listApps().catch(() => []));
    // Usage for the selected provider (Claude via its OAuth endpoint; Codex from
    // its latest rollout). Fetch SEQUENTIALLY so Claude's rate-limited endpoint
    // isn't burst-tripped (the CLI also retries a 429 underneath). Merge each
    // result in place, keyed by `<provider>/<name>`, and persist it — so neither
    // a reload nor a restart ever blanks the bars.
    if (selected === "claude" || selected === "codex") {
      const profs = loaded.filter((r) => r.provider === selected);
      for (const r of profs) {
        const key = `${selected}/${r.name}`;
        const last = lastUsageFetchRef.current[key] ?? 0;
        // Cooldown: if we already have a fresh value fetched < 60s ago, reuse it.
        if (usage[key]?.fresh && Date.now() - last < USAGE_COOLDOWN_MS) continue;
        const snap = await profileUsage(selected, r.name).catch(() => null);
        if (snap) {
          lastUsageFetchRef.current[key] = Date.now();
          setUsage((prev) => ({ ...prev, [key]: { snap, fresh: true } }));
          saveUsageSnapshot(key, snap);
        } else {
          // Record the failure (deduped in the CLI log; the daemon uses the same
          // wording so a background poll failure never double-notifies).
          await recordNotification(
            "warning",
            "Usage fetch failed",
            `Could not fetch usage limits for ${selected}/${r.name}.`,
          ).catch(() => {});
        }
      }
    }
    // The countdown is owned by the auto-refresh timer alone — a manual refresh
    // does NOT restart it (that would just delay the next usage fetch, since the
    // cooldown already blocks a re-fetch within the same interval).
    await syncNotifications();
    setBusy(false);
  }

  // Load the notification log, then fire a best-effort desktop notification for
  // any event newer than the last we notified (the flyout shows them all
  // regardless — that is the in-window fallback when desktop is denied).
  async function syncNotifications() {
    const list = await listNotifications().catch(() => [] as AppNotification[]);
    setNotifications(list);
    const fresh = list.filter((n) => n.ts > notifNotifiedTsRef.current);
    if (fresh.length === 0) return;
    notifNotifiedTsRef.current = Math.max(notifNotifiedTsRef.current, ...fresh.map((n) => n.ts));
    for (const n of fresh.slice(0, 5)) void sendDesktopNotification(n.title, n.message);
  }

  // Opening the bell marks everything up to the newest as read (persisted).
  function markNotifsRead() {
    const newest = notifications[0]?.ts ?? Date.now();
    setNotifLastRead(newest);
    setNotifLastReadState(newest);
  }

  function clearNotifs() {
    void clearNotifications()
      .then(() => setNotifications([]))
      .catch((e) => setError(describeError(e)));
  }

  // Keep the interval pointed at the latest refresh closure (current tab).
  refreshRef.current = refresh;

  function toggleAutoRefresh(on: boolean) {
    setAutoRefreshLimitsFlag(on);
    setAutoRefresh(on);
    if (on) nextRefreshRef.current = Date.now() + REFRESH_MS; // restart the countdown
  }

  function changeRefreshMin(min: number) {
    setRefreshMinutes(min);
    setRefreshMin(min);
  }

  // Re-base the countdown whenever the interval changes so a new value takes
  // effect immediately (rather than after the current, longer deadline).
  useEffect(() => {
    nextRefreshRef.current = Date.now() + REFRESH_MS;
  }, [REFRESH_MS]);

  // Initial load only. Tab switches do NOT refetch (they display cached/last-known
  // usage); the 5-minute timer and the manual button are the only refresh paths.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1s ticker: drives the countdown and fires the auto-refresh when due.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNowTick(t);
      if (autoRefresh && t >= nextRefreshRef.current) {
        nextRefreshRef.current = t + REFRESH_MS;
        void refreshRef.current();
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, REFRESH_MS]);

  const grouped = groupByProvider(rows);
  const shown = grouped[selected];

  const secondsLeft = Math.max(0, Math.ceil((nextRefreshRef.current - nowTick) / 1000));
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const unreadNotifs = notifications.filter((n) => n.ts > notifLastRead).length;

  // Only enabled providers get a tab. Before the first load, fall back to the
  // default set (Claude + Codex) so nothing flickers in.
  const enabledIds = PROVIDERS.filter((p) =>
    providers ? providers[p].cli || providers[p].ui : p !== "gemini",
  );

  // If the selected provider was just disabled, jump to the first enabled one.
  useEffect(() => {
    if (providers && enabledIds.length && !enabledIds.includes(selected)) {
      setSelected(enabledIds[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  return (
    <div className="flex h-full flex-col">
      <header
        data-tauri-drag-region
        className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur"
        style={IS_MAC ? { paddingLeft: 78 } : undefined}
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-primary"
            data-tauri-drag-region
            aria-hidden
          >
            <RefreshCw className="size-5 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold tracking-tight" data-tauri-drag-region>
            agent-switch
          </span>
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground" data-tauri-drag-region>
              {rows.length} profiles
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5" data-tauri-drag-region>
          <Button
            size="sm"
            variant={showCreate ? "secondary" : "default"}
            onClick={() => {
              setShowCreate((v) => !v);
              setNotice(null);
            }}
          >
            <Plus /> New
          </Button>
          <NotificationBell
            notifications={notifications}
            unread={unreadNotifs}
            onMarkRead={markNotifsRead}
            onClear={clearNotifs}
          />
          <Button
            size="icon"
            variant={showSessions ? "secondary" : "ghost"}
            onClick={() => {
              setShowSessions((v) => !v);
              setShowSettings(false);
              setNotice(null);
            }}
            aria-label="Sessions"
          >
            <History />
          </Button>
          <Button
            size="icon"
            variant={showSettings ? "secondary" : "ghost"}
            onClick={() => {
              setShowSettings((v) => !v);
              setShowSessions(false);
              setNotice(null);
            }}
            aria-label="Settings"
          >
            <Settings />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {terminal ? (
          <EmbeddedTerminal
            key={terminal.args.join(" ")}
            args={terminal.args}
            title={terminal.title}
            onClose={() => {
              setTerminal(null);
              void refresh();
            }}
          />
        ) : showSettings ? (
          <SettingsView
            onClose={() => setShowSettings(false)}
            onUninstall={() => act(() => uninstall().then(quitApp))}
            autoSwitchEnabled={globalAuto}
            onToggleAutoSwitch={toggleGlobalAuto}
            autoRefresh={autoRefresh}
            onToggleAutoRefresh={toggleAutoRefresh}
            refreshMin={refreshMin}
            onChangeRefreshMin={changeRefreshMin}
            onProvidersChanged={refresh}
          />
        ) : showSessions ? (
          <SessionsView
            claudeProfiles={grouped.claude.map((r) => r.name)}
            onClose={() => setShowSessions(false)}
            onTakeover={(sessionId, to, keepSource) =>
              setTerminal({
                args: takeoverArgs(sessionId, to, keepSource),
                title: `Takeover — ${sessionId.slice(0, 8)} → ${to}`,
              })
            }
          />
        ) : (
          <>
            <div
              role="tablist"
              className="grid gap-1 rounded-lg bg-muted p-1"
              style={{ gridTemplateColumns: `repeat(${Math.max(enabledIds.length, 1)}, minmax(0, 1fr))` }}
            >
              {enabledIds.map((pid) => {
                const count = grouped[pid].length;
                const active = selected === pid;
                // The count badge doubles as the auto-switch indicator (it replaces the
                // former standalone dot): green = on, red = off, grey = unavailable
                // (needs 2+ profiles). Only for providers with a usage readout (Claude)
                // and only while the global master is on; otherwise the badge is neutral.
                const autoColored = globalAuto && hasUsageReadout(pid);
                const autoState: "unavailable" | "on" | "off" =
                  count < 2 ? "unavailable" : auto?.[pid]?.enabled ? "on" : "off";
                const autoLabel =
                  autoState === "unavailable"
                    ? `Auto-switch unavailable for ${PROVIDER_LABEL[pid]} — needs 2+ profiles`
                    : `Auto-switch ${autoState} for ${PROVIDER_LABEL[pid]}`;
                return (
                  <button
                    key={pid}
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setSelected(pid);
                      setConfirmDelete(null);
                    }}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {PROVIDER_LABEL[pid]}
                    {count > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[10px] leading-tight",
                          !autoColored
                            ? active
                              ? "bg-secondary text-secondary-foreground"
                              : "bg-secondary/50"
                            : autoState === "unavailable"
                              ? "bg-muted-foreground/40 text-foreground"
                              : autoState === "on"
                                ? "bg-[hsl(var(--success))] text-white"
                                : "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
                        )}
                        title={autoColored ? autoLabel : undefined}
                        aria-label={autoColored ? autoLabel : undefined}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[13px]">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{notice}</span>
              </div>
            )}

            {showCreate && (
              <CreateProfileForm
                busy={busy}
                defaultProvider={selected}
                onCancel={() => setShowCreate(false)}
                onCreate={(provider, name, label) => {
                  try {
                    const args = loginArgs(provider, name); // validates the name (throws on invalid)
                    setError(null);
                    setNotice(null);
                    setShowCreate(false);
                    setSelected(provider); // jump to the tab we just created into
                    // Persist the (required) tag up front — it's keyed by
                    // provider/name and doesn't need the profile dir to exist yet.
                    void setProfileLabel(provider, name, label).catch(() => {});
                    // Run the login in the in-app terminal — no external window.
                    setTerminal({ args, title: `Login — ${PROVIDER_LABEL[provider]} / ${name}` });
                  } catch (e) {
                    setError(describeError(e));
                  }
                }}
              />
            )}

            {shown.length === 0 && !error ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="text-sm font-medium">No {PROVIDER_LABEL[selected]} profiles yet</div>
                <p className="max-w-[15rem] text-xs text-muted-foreground">
                  Create a profile to log in a {PROVIDER_LABEL[selected]} account.
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowCreate(true);
                    setNotice(null);
                  }}
                >
                  <Plus /> Create a profile
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {shown.map((r, i) => (
                  // Key by provider+name: a Claude and a Codex profile can share a
                  // name (e.g. "Matze1"); a name-only key lets React morph one into
                  // the other on a tab switch — the brief Claude-on-Codex flash.
                  // Each profile is its own tile with an alternating shade so the
                  // rows are easy to tell apart.
                  <div
                    key={`${r.provider}/${r.name}`}
                    className={cn(
                      "rounded-lg border border-border px-3 py-2.5",
                      i % 2 === 0 ? "bg-card" : "bg-muted/40",
                    )}
                  >
                      {editKey === `${r.provider}/${r.name}` ? (
                        <EditProfileRow
                          current={r}
                          busy={busy}
                          onCancel={() => setEditKey(null)}
                          onSave={(newName, newLabel) => {
                            setEditKey(null);
                            act(async () => {
                              if (newLabel !== r.label) await setProfileLabel(selected, r.name, newLabel);
                              if (newName !== r.name) await renameProfile(selected, r.name, newName);
                            });
                          }}
                        />
                      ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium">{r.name}</span>
                              {r.active && <span className="text-[11px] font-medium text-[hsl(var(--success))]">active</span>}
                              {r.liveSessions > 0 && <Badge variant="success">{r.liveSessions} live</Badge>}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{r.identity ?? "—"}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {confirmDelete === `${selected}/${r.name}` ? (
                            <>
                              <span className="text-xs text-muted-foreground">Delete?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setConfirmDelete(null);
                                  act(() => removeProfile(selected, r.name));
                                }}
                              >
                                Yes
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                                No
                              </Button>
                            </>
                          ) : (
                            <>
                              {r.label && <Badge variant="secondary" className="mr-0.5">{r.label}</Badge>}
                              {r.active ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => act(() => deactivateProfile(selected))}
                                >
                                  <Power /> Off
                                </Button>
                              ) : (
                                <Button size="sm" variant="secondary" onClick={() => act(() => switchProfile(selected, r.name))}>
                                  Use
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setTerminal({
                                    args: sessionArgs(selected, r.name),
                                    title: `Session — ${PROVIDER_LABEL[selected]} / ${r.name}`,
                                  })
                                }
                              >
                                <Terminal /> Term
                              </Button>
                              {selected === "codex" &&
                                (usage[`codex/${r.name}`]?.snap?.resetCredits ?? 0) > 0 &&
                                (confirmReset === `${selected}/${r.name}` ? (
                                  <>
                                    <span className="text-xs text-muted-foreground">Redeem a reset?</span>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => {
                                        setConfirmReset(null);
                                        act(() => redeemReset(selected, r.name));
                                      }}
                                    >
                                      Yes
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setConfirmReset(null)}>
                                      No
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setConfirmReset(`${selected}/${r.name}`)}
                                    title={`Redeem one banked rate-limit reset (${usage[`codex/${r.name}`]?.snap?.resetCredits} available)`}
                                  >
                                    <RotateCcw /> Reset
                                  </Button>
                                ))}
                              {apps
                                .filter((a) => a.provider === selected && a.installed)
                                .map((a) => (
                                  <Button
                                    key={a.id}
                                    size="sm"
                                    variant="ghost"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => act(() => openApp(a.id, r.name))}
                                  >
                                    <AppWindow /> {a.displayName}
                                  </Button>
                                ))}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-muted-foreground hover:text-foreground"
                                aria-label={`Edit ${r.name}`}
                                onClick={() => setEditKey(`${selected}/${r.name}`)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-muted-foreground hover:text-destructive"
                                aria-label={`Delete ${r.name}`}
                                onClick={() => setConfirmDelete(`${selected}/${r.name}`)}
                              >
                                <Trash2 />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      )}
                      {/* Claude + Codex both have a usage readout. Keyed by
                          provider/name so a same-name profile of the other provider
                          never shows here; renders last-known (grey) or hatched N.A.
                          when there's no live/cached value. */}
                      {(selected === "claude" || selected === "codex") && (
                        <UsageBars
                          usage={usage[`${selected}/${r.name}`]?.snap ?? null}
                          stale={!usage[`${selected}/${r.name}`]?.fresh}
                        />
                      )}
                    </div>
                  ))}
                </div>
            )}
          </>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5">
        {auto &&
          globalAuto &&
          hasUsageReadout(selected) &&
          !showSettings &&
          (() => {
            // Auto-switch needs 2+ profiles for the provider to have anything to switch to.
            const canAuto = grouped[selected].length >= 2;
            return (
              <button
                disabled={!canAuto}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] transition-colors",
                  !canAuto
                    ? "cursor-not-allowed text-muted-foreground/60"
                    : auto[selected].enabled
                      ? "text-[hsl(var(--success))]"
                      : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => canAuto && act(() => setAutoSwitch(selected, !auto[selected].enabled))}
                title={
                  canAuto
                    ? `Auto-switch the active ${PROVIDER_LABEL[selected]} account to the one with the most headroom when it hits its limit (this provider only)`
                    : `Auto-switch needs at least 2 ${PROVIDER_LABEL[selected]} profiles to switch between`
                }
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    !canAuto
                      ? "bg-muted-foreground/40"
                      : auto[selected].enabled
                        ? "bg-[hsl(var(--success))]"
                        : "bg-[hsl(var(--destructive))]",
                  )}
                />
                Auto-switch · {PROVIDER_LABEL[selected]}{" "}
                {!canAuto ? "not available" : auto[selected].enabled ? `on (${auto[selected].threshold}%)` : "off"}
              </button>
            );
          })()}
        <div className="ml-auto flex items-center gap-1.5">
          {autoRefresh && !terminal && (
            <span className="tabular-nums text-[11px] text-muted-foreground" title="Time until usage limits auto-refresh">
              {countdown}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={refresh}
            disabled={busy}
            aria-label="Refresh"
            title="Refresh now"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-muted-foreground hover:text-destructive"
            onClick={() => quitApp()}
          >
            <Power /> Quit
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** Inline editor for a profile's name + tag (opened by the pencil button).
 *  A tag stays required; the name is renamed via the CLI on save. */
function EditProfileRow({
  current,
  busy,
  onSave,
  onCancel,
}: {
  current: ProfileRow;
  busy: boolean;
  onSave: (name: string, label: ProfileLabel) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current.name);
  const [label, setLabel] = useState<ProfileLabel | null>(current.label);
  const trimmed = name.trim();
  // Enabled as soon as something differs from the original (and stays valid:
  // non-empty name + a tag); disabled when nothing changed.
  const changed = trimmed !== current.name || label !== current.label;
  const canSave = changed && !!trimmed && !!label && !busy;
  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        autoFocus
        aria-label="Profile name"
        className="h-8 min-w-0 flex-1"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSave) onSave(trimmed, label!);
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex shrink-0 gap-1">
        {PROFILE_LABELS.map((l) => (
          <Button key={l} size="sm" variant={label === l ? "default" : "outline"} className="h-8 px-2" onClick={() => setLabel(l)}>
            {l}
          </Button>
        ))}
      </div>
      <Button size="icon" variant="secondary" className="size-8 shrink-0" disabled={!canSave} onClick={() => onSave(trimmed, label!)} aria-label="Save">
        <Check />
      </Button>
      <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={onCancel} aria-label="Cancel edit">
        <X />
      </Button>
    </div>
  );
}


type SettingsTab = "general" | "providers" | "design" | "uninstall";
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "design", label: "Design" },
  { id: "uninstall", label: "Uninstall" },
];

/** The full-window Settings view. Replaces the agent tabs while open (they are
 *  hidden), with its own sub-tabs: General (autostart, auto-switch), Providers
 *  (enable/disable), Design (theme), and a type-to-confirm Uninstall. */
function SettingsView({
  onClose,
  onUninstall,
  autoSwitchEnabled,
  onToggleAutoSwitch,
  autoRefresh,
  onToggleAutoRefresh,
  refreshMin,
  onChangeRefreshMin,
  onProvidersChanged,
}: {
  onClose: () => void;
  onUninstall: () => void;
  autoSwitchEnabled: boolean;
  onToggleAutoSwitch: (on: boolean) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: (on: boolean) => void;
  refreshMin: number;
  onChangeRefreshMin: (min: number) => void;
  onProvidersChanged: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Settings</span>
        <Button size="icon" variant="ghost" className="size-7" onClick={onClose} aria-label="Close settings">
          <X />
        </Button>
      </div>
      <div role="tablist" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "general" && (
        <GeneralSettings
          autoSwitchEnabled={autoSwitchEnabled}
          onToggleAutoSwitch={onToggleAutoSwitch}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={onToggleAutoRefresh}
          refreshMin={refreshMin}
          onChangeRefreshMin={onChangeRefreshMin}
        />
      )}
      {tab === "providers" && <ProvidersSettings onChange={onProvidersChanged} />}
      {tab === "design" && <DesignSettings />}
      {tab === "uninstall" && <UninstallSettings onUninstall={onUninstall} />}
    </div>
  );
}

function GeneralSettings({
  autoSwitchEnabled,
  onToggleAutoSwitch,
  autoRefresh,
  onToggleAutoRefresh,
  refreshMin,
  onChangeRefreshMin,
}: {
  autoSwitchEnabled: boolean;
  onToggleAutoSwitch: (on: boolean) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: (on: boolean) => void;
  refreshMin: number;
  onChangeRefreshMin: (min: number) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<SwitchStrategy | null>(null);

  useEffect(() => {
    getAutostart()
      .then(setEnabled)
      .catch(() => setEnabled(false));
    getSwitchStrategy()
      .then(setStrategy)
      .catch(() => setStrategy("reset-first"));
  }, []);

  function pickStrategy(next: SwitchStrategy) {
    setStrategy(next);
    setSwitchStrategy(next).catch((e) => setErr(describeError(e)));
  }

  async function toggle() {
    const next = !enabled;
    try {
      await setAutostart(next);
      setEnabled(next);
      setErr(null);
    } catch (e) {
      setErr(describeError(e));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium">Start at login</div>
            <div className="text-xs text-muted-foreground">Launch agent-switch automatically when you sign in.</div>
          </div>
          <Button
            size="sm"
            variant={enabled ? "default" : "outline"}
            disabled={enabled === null}
            onClick={toggle}
            aria-label="Start at login"
          >
            {enabled === null ? "…" : enabled ? "On" : "Off"}
          </Button>
        </div>
        {err && <div className="text-xs text-destructive">{err}</div>}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <div>
            <div className="text-[13px] font-medium">Auto-switch</div>
            <div className="text-xs text-muted-foreground">
              Allow switching the active account when it hits its limit. Turning this off hides the per-provider
              toggles and disables all of them.
            </div>
          </div>
          <Button
            size="sm"
            variant={autoSwitchEnabled ? "default" : "outline"}
            onClick={() => onToggleAutoSwitch(!autoSwitchEnabled)}
            aria-label="Auto-switch globally"
          >
            {autoSwitchEnabled ? "On" : "Off"}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <div>
            <div className="text-[13px] font-medium">Auto-refresh limits</div>
            <div className="text-xs text-muted-foreground">
              Refresh usage limits automatically on the interval below. When off, use the refresh button in the footer.
            </div>
          </div>
          <Button
            size="sm"
            variant={autoRefresh ? "default" : "outline"}
            onClick={() => onToggleAutoRefresh(!autoRefresh)}
            aria-label="Auto-refresh limits"
          >
            {autoRefresh ? "On" : "Off"}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">Refresh interval</div>
            <div className="text-xs text-muted-foreground">
              How often usage limits refresh. Also the minimum spacing between manual refreshes.
            </div>
          </div>
          <select
            value={refreshMin}
            onChange={(e) => onChangeRefreshMin(Number(e.target.value))}
            aria-label="Refresh interval"
            className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-[13px]"
          >
            {REFRESH_INTERVAL_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">Switch strategy</div>
            <div className="text-xs text-muted-foreground">
              When auto-switch fires: <span className="font-medium">reset first</span> redeems a banked Codex reset
              before switching accounts; <span className="font-medium">rotation first</span> switches straight to the
              account with the most headroom.
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant={strategy === "reset-first" ? "default" : "outline"}
              disabled={strategy === null}
              onClick={() => pickStrategy("reset-first")}
            >
              Reset first
            </Button>
            <Button
              size="sm"
              variant={strategy === "rotation-first" ? "default" : "outline"}
              disabled={strategy === null}
              onClick={() => pickStrategy("rotation-first")}
            >
              Rotation first
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const PROVIDER_SURFACES: { id: ProviderSurface; label: string }[] = [
  { id: "cli", label: "CLI" },
  { id: "ui", label: "UI" },
];

/** Providers tab: enable/disable each provider's surfaces. Disabling hides a
 *  provider without deleting its profiles; `onChange` refreshes the main view so
 *  its tab strip updates immediately. */
function ProvidersSettings({ onChange }: { onChange: () => void }) {
  const [cfg, setCfg] = useState<ProvidersStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getProviders()
      .then(setCfg)
      .catch((e) => setErr(describeError(e)));
  }, []);

  async function toggle(pid: ProviderId, surface: ProviderSurface) {
    if (!cfg) return;
    const next = !cfg[pid][surface];
    try {
      await setProvider(pid, surface, next);
      setCfg({ ...cfg, [pid]: { ...cfg[pid], [surface]: next } });
      setErr(null);
      onChange();
    } catch (e) {
      setErr(describeError(e));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="text-xs text-muted-foreground">
          Enable the providers you use. Disabling one hides it — your profiles are kept and return when you re-enable it.
          A provider that isn&apos;t installed is shown but can&apos;t be enabled.
        </div>
        {cfg === null && !err && <div className="text-xs text-muted-foreground">…</div>}
        {cfg &&
          PROVIDERS.map((pid) => {
            const installed = cfg[pid].installed;
            return (
              <div
                key={pid}
                className="flex items-center justify-between gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
                <div>
                  <div className={cn("text-[13px] font-medium", !installed && "text-muted-foreground")}>
                    {PROVIDER_LABEL[pid]}
                  </div>
                  {!installed && <div className="text-[11px] text-muted-foreground">not installed</div>}
                </div>
                <div className="flex gap-1">
                  {PROVIDER_SURFACES.map((s) => {
                    const on = cfg[pid][s.id];
                    // Can't turn a surface ON when the provider isn't installed;
                    // turning an already-on one OFF stays allowed.
                    const blocked = !installed && !on;
                    return (
                      <Button
                        key={s.id}
                        size="sm"
                        variant={on ? "default" : "outline"}
                        disabled={blocked}
                        title={blocked ? `Install ${PROVIDER_LABEL[pid]} to enable it` : undefined}
                        onClick={() => toggle(pid, s.id)}
                        aria-label={`${PROVIDER_LABEL[pid]} ${s.label} ${on ? "enabled" : "disabled"}${
                          blocked ? " (not installed)" : ""
                        }`}
                      >
                        {s.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        {err && <div className="text-xs text-destructive">{err}</div>}
      </CardContent>
    </Card>
  );
}

const THEME_LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

function DesignSettings() {
  const [theme, setTheme] = useState<Theme>(getTheme());
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="text-[13px] font-medium">Appearance</div>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {THEMES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              onClick={() => {
                applyTheme(t);
                setTheme(t);
              }}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                theme === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">System follows your OS light/dark setting.</div>
      </CardContent>
    </Card>
  );
}

/** Uninstall is type-to-confirm: the destructive button stays disabled until
 *  the user actively types "uninstall", so it can never fire by a stray click. */
function UninstallSettings({ onUninstall }: { onUninstall: () => void }) {
  const [confirm, setConfirm] = useState("");
  const ready = confirm.trim().toLowerCase() === "uninstall";
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-destructive">
          <AlertTriangle className="size-4" /> Danger zone
        </div>
        <p className="text-xs text-muted-foreground">
          Uninstall removes <strong>all</strong> agent-switch profiles, credentials, directory mappings, and the
          background daemon under <span className="font-mono">~/.agent-switch</span>. This cannot be undone.
        </p>
        <div className="space-y-1">
          <Label htmlFor="uninstall-confirm">
            Type <span className="font-mono text-foreground">uninstall</span> to confirm
          </Label>
          <Input
            id="uninstall-confirm"
            placeholder="uninstall"
            value={confirm}
            autoComplete="off"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button variant="destructive" className="w-full" disabled={!ready} onClick={onUninstall}>
          <Trash2 /> Uninstall agent-switch
        </Button>
      </CardContent>
    </Card>
  );
}

/** Sessions view (behind the header history icon): the Claude sessions
 *  inventory, each with a target-profile picker + "Take over" that runs the
 *  interactive takeover in the embedded terminal. */
function SessionsView({
  claudeProfiles,
  onClose,
  onTakeover,
}: {
  claudeProfiles: string[];
  onClose: () => void;
  onTakeover: (sessionId: string, to: string, keepSource: boolean) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [fork, setFork] = useState<Record<string, boolean>>({});

  useEffect(() => {
    listSessions(undefined, 20)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Sessions</span>
        <Button size="icon" variant="ghost" className="size-7" onClick={onClose} aria-label="Close sessions">
          <X />
        </Button>
      </div>
      {sessions === null ? (
        <div className="px-1 text-xs text-muted-foreground">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No Claude sessions yet.</div>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {sessions.map((s) => {
              const others = claudeProfiles.filter((p) => p !== s.profile);
              const to = target[s.sessionId] ?? others[0] ?? "";
              return (
                <div key={`${s.profile}/${s.sessionId}`} className="space-y-1.5 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{s.profile}</span>
                    {s.live && <Badge variant="success">live</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{relativeAge(s.mtimeMs)}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{s.summary || s.cwd || s.projectDir}</div>
                  {others.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">→</span>
                      <Select value={to} onValueChange={(v) => setTarget((m) => ({ ...m, [s.sessionId]: v }))}>
                        <SelectTrigger aria-label={`Target for ${s.sessionId}`} className="h-7 w-auto gap-1 px-2 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {others.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant={fork[s.sessionId] ? "default" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setFork((m) => ({ ...m, [s.sessionId]: !m[s.sessionId] }))}
                        aria-label={`Fork ${s.sessionId}`}
                        title="Copy + fork instead of move (source keeps its own copy)"
                      >
                        fork
                      </Button>
                      <Button size="sm" variant="secondary" disabled={!to} onClick={() => onTakeover(s.sessionId, to, !!fork[s.sessionId])}>
                        <ArrowRightLeft /> Take over
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Take over moves a session to another profile and resumes it in the terminal — fork copies instead.
      </p>
    </div>
  );
}

function CreateProfileForm({
  busy,
  defaultProvider,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  defaultProvider: ProviderId;
  onCreate: (provider: ProviderId, name: string, label: ProfileLabel) => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState<ProviderId>(defaultProvider);
  const [name, setName] = useState("");
  const [label, setLabel] = useState<ProfileLabel | null>(null);
  const trimmed = name.trim();
  const canCreate = !!trimmed && !!label && !busy;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <span className="text-sm font-medium">New profile</span>
        <Button size="icon" variant="ghost" className="size-6" onClick={onCancel} aria-label="Cancel">
          <X />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="space-y-1">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            placeholder="e.g. work"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) onCreate(provider, trimmed, label!);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as ProviderId)}>
            <SelectTrigger aria-label="Provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((pid) => (
                <SelectItem key={pid} value={pid}>
                  {PROVIDER_LABEL[pid]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Tag (required)</Label>
          <div className="grid grid-cols-3 gap-1">
            {PROFILE_LABELS.map((l) => (
              <Button
                key={l}
                size="sm"
                variant={label === l ? "default" : "outline"}
                onClick={() => setLabel(l)}
              >
                {l}
              </Button>
            ))}
          </div>
        </div>
        <Button className="w-full" disabled={!canCreate} onClick={() => onCreate(provider, trimmed, label!)}>
          <LogIn /> Create & log in
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Opens an in-app terminal to complete the provider login — no external window.
        </p>
      </CardContent>
    </Card>
  );
}
