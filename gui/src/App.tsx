import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Terminal, LogIn, X, AlertCircle, Info, Power, Trash2, Settings, AlertTriangle, AppWindow, History, ArrowRightLeft, RotateCcw, Coins, Minimize2 } from "lucide-react";
import {
  compactArgs,
  deactivateProfile,
  getAutoSwitch,
  getAutostart,
  getNotifyConfig,
  getProviders,
  getTokens,
  listApps,
  listProfiles,
  listSessions,
  loginArgs,
  openApp,
  profileUsage,
  redeemReset,
  setNotify,
  setTrayTooltip,
  takeoverArgs,
  quitApp,
  removeProfile,
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
  type TokensError,
} from "./ipc.js";
import { EmbeddedTerminal } from "./EmbeddedTerminal.js";
import { applyTheme, getTheme, THEMES, type Theme } from "./theme.js";
import { getAutoSwitchGlobal, setAutoSwitchGlobalFlag, getAutoRefreshLimits, setAutoRefreshLimitsFlag } from "./settings-store.js";
import { loadUsageCache, saveUsageSnapshot, type UsageEntry } from "./usage-cache.js";
import {
  groupByProvider,
  formatReset,
  formatContextBadge,
  formatTokensK,
  hasUsageReadout,
  relativeAge,
  worstLiveContextPct,
  contextTrayTooltip,
  PROFILE_LABELS,
  type ProfileRow,
  type ProfileLabel,
  type UsageSnapshot,
  type ProviderId,
  type ProvidersStatus,
  type ProviderSurface,
  type SessionRow,
  type SessionContext,
  type TokenRow,
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
const NO_LABEL = "none";

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
  const [showTokens, setShowTokens] = useState(false);
  const [globalAuto, setGlobalAuto] = useState(() => getAutoSwitchGlobal());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  // The in-app pty terminal overlay (login / run), or null when none is open.
  const [terminal, setTerminal] = useState<{ args: string[]; title: string } | null>(null);

  // Usage auto-refresh: a 5-minute timer, shown as a live countdown by the
  // footer refresh button. Tab switches do NOT refresh (per user request) — only
  // the timer and the manual button do. `nextRefreshRef` is the wall-clock
  // deadline; `nowTick` re-renders the countdown each second. `refreshRef` holds
  // the latest refresh closure so the interval always fetches the current tab.
  const REFRESH_MS = 5 * 60 * 1000;
  const nextRefreshRef = useRef(Date.now() + REFRESH_MS);
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
        const snap = await profileUsage(selected, r.name).catch(() => null);
        if (snap) {
          const key = `${selected}/${r.name}`;
          setUsage((prev) => ({ ...prev, [key]: { snap, fresh: true } }));
          saveUsageSnapshot(key, snap);
        }
      }
    }
    // Tray tooltip: the active Claude profile's worst live-session context fill
    // (one number, own account only). Best-effort + non-blocking — a tray hiccup
    // must never delay or blank the panel.
    void (async () => {
      try {
        const sess = await listSessions(undefined, 20);
        const activeClaude = loaded.filter((r) => r.provider === "claude" && r.active).map((r) => r.name);
        await setTrayTooltip(contextTrayTooltip(worstLiveContextPct(sess, activeClaude)));
      } catch {
        /* best-effort tray update */
      }
    })();
    nextRefreshRef.current = Date.now() + REFRESH_MS; // any refresh restarts the countdown
    setBusy(false);
  }

  // Keep the interval pointed at the latest refresh closure (current tab).
  refreshRef.current = refresh;

  function toggleAutoRefresh(on: boolean) {
    setAutoRefreshLimitsFlag(on);
    setAutoRefresh(on);
    if (on) nextRefreshRef.current = Date.now() + REFRESH_MS; // restart the countdown
  }

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
  }, [autoRefresh]);

  const grouped = groupByProvider(rows);
  const shown = grouped[selected];

  const secondsLeft = Math.max(0, Math.ceil((nextRefreshRef.current - nowTick) / 1000));
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

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
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">agent-switch</span>
          {rows.length > 0 && <span className="text-xs text-muted-foreground">{rows.length} profiles</span>}
        </div>
        <div className="flex items-center gap-1.5">
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
          <Button
            size="icon"
            variant={showTokens ? "secondary" : "ghost"}
            onClick={() => {
              setShowTokens((v) => !v);
              setShowSessions(false);
              setShowSettings(false);
              setNotice(null);
            }}
            aria-label="Tokens"
          >
            <Coins />
          </Button>
          <Button
            size="icon"
            variant={showSessions ? "secondary" : "ghost"}
            onClick={() => {
              setShowSessions((v) => !v);
              setShowTokens(false);
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
              setShowTokens(false);
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
            onProvidersChanged={refresh}
          />
        ) : showTokens ? (
          <TokensView onClose={() => setShowTokens(false)} />
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
            onCompact={(profile) =>
              setTerminal({
                args: compactArgs(profile),
                title: `Compact — ${profile}`,
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
                onCreate={(provider, name) => {
                  try {
                    const args = loginArgs(provider, name); // validates the name (throws on invalid)
                    setError(null);
                    setNotice(null);
                    setShowCreate(false);
                    setSelected(provider); // jump to the tab we just created into
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
              <Card>
                <div className="divide-y divide-border">
                  {shown.map((r) => (
                    // Key by provider+name: a Claude and a Codex profile can share a
                    // name (e.g. "Matze1"); a name-only key lets React morph one into
                    // the other on a tab switch — the brief Claude-on-Codex flash.
                    <div key={`${r.provider}/${r.name}`} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: r.active ? "hsl(var(--success))" : "hsl(var(--border))" }}
                            aria-hidden
                          />
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
                              <LabelSelect
                                value={r.label}
                                onChange={(label) => act(() => setProfileLabel(selected, r.name, label))}
                              />
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
              </Card>
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

function LabelSelect({ value, onChange }: { value: ProfileLabel | null; onChange: (v: ProfileLabel | null) => void }) {
  return (
    <Select value={value ?? NO_LABEL} onValueChange={(v) => onChange(v === NO_LABEL ? null : (v as ProfileLabel))}>
      <SelectTrigger aria-label="Label" className="h-7 w-auto gap-1 border-0 bg-transparent px-1.5 shadow-none focus:ring-1">
        {value ? <Badge variant="secondary">{value}</Badge> : <span className="text-xs text-muted-foreground">Tag</span>}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LABEL}>— None</SelectItem>
        {PROFILE_LABELS.map((l) => (
          <SelectItem key={l} value={l}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  onProvidersChanged,
}: {
  onClose: () => void;
  onUninstall: () => void;
  autoSwitchEnabled: boolean;
  onToggleAutoSwitch: (on: boolean) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: (on: boolean) => void;
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
}: {
  autoSwitchEnabled: boolean;
  onToggleAutoSwitch: (on: boolean) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: (on: boolean) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<SwitchStrategy | null>(null);
  const [notify, setNotifyState] = useState<boolean | null>(null);
  const [notifyThresholds, setNotifyThresholds] = useState<number[]>([]);

  useEffect(() => {
    getAutostart()
      .then(setEnabled)
      .catch(() => setEnabled(false));
    getSwitchStrategy()
      .then(setStrategy)
      .catch(() => setStrategy("reset-first"));
    getNotifyConfig()
      .then((c) => {
        setNotifyState(c.notify);
        setNotifyThresholds(c.contextThresholds);
      })
      .catch(() => setNotifyState(false));
  }, []);

  async function toggleNotify() {
    const next = !notify;
    try {
      await setNotify(next, notifyThresholds);
      setNotifyState(next);
      setErr(null);
    } catch (e) {
      setErr(describeError(e));
    }
  }

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
              Refresh usage limits automatically every 5 minutes. When off, use the refresh button in the footer.
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
          <div>
            <div className="text-[13px] font-medium">Notifications</div>
            <div className="text-xs text-muted-foreground">
              Notify when a session's context window crosses a threshold
              {notifyThresholds.length > 0 && ` (${notifyThresholds.join("%, ")}%)`}.
            </div>
          </div>
          <Button
            size="sm"
            variant={notify ? "default" : "outline"}
            disabled={notify === null}
            onClick={toggleNotify}
            aria-label="Notifications"
          >
            {notify === null ? "…" : notify ? "On" : "Off"}
          </Button>
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

/** Compact context-window badge for a live session, coloured with the same
 *  thresholds as the usage bars (green <70, amber <90, red ≥90). Own-session
 *  only — never a comparison across sessions. Empty context renders nothing. */
function ContextBadge({ context }: { context?: SessionContext | null }) {
  const label = formatContextBadge(context);
  if (!label) return null;
  const pct = context?.pct ?? null;
  const color = typeof pct === "number" ? utilColor(pct) : undefined;
  return (
    <span
      className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums"
      style={color ? { color, borderColor: color } : undefined}
      title={context?.model ? `Context window — ${context.model}` : "Context window"}
    >
      {label}
    </span>
  );
}

/** Sessions view (behind the header history icon): the Claude sessions
 *  inventory, each with a target-profile picker + "Take over" that runs the
 *  interactive takeover in the embedded terminal, plus a "Compact" action on
 *  live sessions. */
function SessionsView({
  claudeProfiles,
  onClose,
  onTakeover,
  onCompact,
}: {
  claudeProfiles: string[];
  onClose: () => void;
  onTakeover: (sessionId: string, to: string, keepSource: boolean) => void;
  onCompact: (profile: string) => void;
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
                    <ContextBadge context={s.context} />
                    <span className="ml-auto text-xs text-muted-foreground">{relativeAge(s.mtimeMs)}</span>
                    {s.live && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => onCompact(s.profile)}
                        title="Run /compact in this session's terminal to shrink its context window"
                      >
                        <Minimize2 /> Compact
                      </Button>
                    )}
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

/** One profile's token usage: a per-day table (date · tokens · cost) + a total
 *  row. A notional cost basis (API-equivalent value of subscription usage) is
 *  greyed + italic with an explanatory tooltip so it is never read as real spend. */
function TokenProfileCard({ row }: { row: TokenRow }) {
  const t = row.tokens;
  const notional = t?.costBasis === "notional";
  const costTitle = notional ? "API-equivalent value of subscription usage, not real spend" : undefined;
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{row.name}</span>
          {t && (
            <Badge variant="outline" title={costTitle}>
              {t.costBasis}
            </Badge>
          )}
        </div>
        {!t || t.days.length === 0 ? (
          <div className="text-xs text-muted-foreground">No usage recorded.</div>
        ) : (
          <div className="space-y-1 text-[11px]">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="w-20 shrink-0">Date</span>
              <span className="flex-1 text-right">Tokens</span>
              <span className="w-16 shrink-0 text-right">Cost</span>
            </div>
            {t.days.map((d) => (
              <div key={d.date} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate">{d.date}</span>
                <span className="flex-1 text-right tabular-nums">{formatTokensK(d.totalTokens)}</span>
                <span
                  className={cn("w-16 shrink-0 text-right tabular-nums", notional && "italic text-muted-foreground")}
                  title={costTitle}
                >
                  ${d.cost.toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2 border-t border-border pt-1 font-medium">
              <span className="w-20 shrink-0">Total</span>
              <span className="flex-1 text-right tabular-nums">{formatTokensK(t.totals.totalTokens)}</span>
              <span
                className={cn("w-16 shrink-0 text-right tabular-nums", notional && "italic text-muted-foreground")}
                title={costTitle}
              >
                ${t.totals.cost.toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Tokens view (behind the header coins icon): per-profile Claude token usage
 *  from `tokens --json`. A pure `--json` client — when ccusage is missing the
 *  payload carries an install hint, shown in place of the tables. */
function TokensView({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<TokenRow[] | TokensError | null>(null);

  useEffect(() => {
    getTokens()
      .then(setData)
      .catch(() => setData({ error: "tokens-unavailable" }));
  }, []);

  const err = data && !Array.isArray(data) ? data : null;
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Token usage</span>
        <Button size="icon" variant="ghost" className="size-7" onClick={onClose} aria-label="Close tokens">
          <X />
        </Button>
      </div>
      {data === null ? (
        <div className="px-1 text-xs text-muted-foreground">Loading…</div>
      ) : err ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {err.hint || "Install ccusage for token tracking."}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No token usage yet.</div>
      ) : (
        rows.map((r) => <TokenProfileCard key={`${r.provider}/${r.name}`} row={r} />)
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Daily token totals per profile. Costs marked <span className="italic">notional</span> are the API-equivalent
        value of subscription usage, not real spend.
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
  onCreate: (provider: ProviderId, name: string) => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState<ProviderId>(defaultProvider);
  const [name, setName] = useState("");
  const trimmed = name.trim();

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
              if (e.key === "Enter" && trimmed && !busy) onCreate(provider, trimmed);
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
        <Button className="w-full" disabled={!trimmed || busy} onClick={() => onCreate(provider, trimmed)}>
          <LogIn /> Create & log in
        </Button>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Opens an in-app terminal to complete the provider login — no external window.
        </p>
      </CardContent>
    </Card>
  );
}
