import { useEffect, useState } from "react";
import { Plus, RefreshCw, Play, LogIn, X, AlertCircle, Info, Power, Trash2, Settings, AlertTriangle, AppWindow } from "lucide-react";
import {
  deactivateProfile,
  getAutoSwitch,
  getAutostart,
  getProviders,
  listApps,
  listProfiles,
  loginArgs,
  openApp,
  profileUsage,
  quitApp,
  removeProfile,
  sessionArgs,
  setAutoSwitch,
  setAutostart,
  setProfileLabel,
  setProvider,
  switchProfile,
  uninstall,
  type AppInfo,
  type AutoSwitchMap,
} from "./ipc.js";
import { EmbeddedTerminal } from "./EmbeddedTerminal.js";
import { applyTheme, getTheme, THEMES, type Theme } from "./theme.js";
import { getAutoSwitchGlobal, setAutoSwitchGlobalFlag } from "./settings-store.js";
import {
  groupByProvider,
  formatReset,
  hasUsageReadout,
  PROFILE_LABELS,
  type ProfileRow,
  type ProfileLabel,
  type UsageSnapshot,
  type ProviderId,
  type ProvidersStatus,
  type ProviderSurface,
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

function UsageBars({ usage }: { usage: UsageSnapshot }) {
  const windows = usage.windows.filter((w) => typeof w.utilization === "number");
  if (windows.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1 pl-4">
      {windows.map((w) => {
        const pct = w.utilization ?? 0;
        const reset = formatReset(w.resetsAt);
        return (
          <div key={w.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-8 shrink-0 text-muted-foreground">{w.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: utilColor(pct) }} />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums" style={{ color: utilColor(pct) }}>
              {pct}%
            </span>
            <span className="w-16 shrink-0 text-muted-foreground">{reset ? `${reset}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [selected, setSelected] = useState<ProviderId>("claude");
  const [usage, setUsage] = useState<Record<string, UsageSnapshot>>({});
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [auto, setAuto] = useState<AutoSwitchMap | null>(null);
  const [providers, setProviders] = useState<ProvidersStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [globalAuto, setGlobalAuto] = useState(() => getAutoSwitchGlobal());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // The in-app pty terminal overlay (login / run), or null when none is open.
  const [terminal, setTerminal] = useState<{ args: string[]; title: string } | null>(null);

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
    // Per-profile usage for the selected provider (Claude only has a readout).
    if (selected === "claude") {
      const claude = loaded.filter((r) => r.provider === "claude");
      const entries = await Promise.all(
        claude.map(async (r) => [r.name, await profileUsage("claude", r.name).catch(() => null)] as const),
      );
      const map: Record<string, UsageSnapshot> = {};
      for (const [name, snap] of entries) if (snap) map[name] = snap;
      setUsage(map);
    } else {
      setUsage({});
    }
    setBusy(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const grouped = groupByProvider(rows);
  const shown = grouped[selected];

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
          <Button size="icon" variant="ghost" onClick={refresh} disabled={busy} aria-label="Refresh">
            <RefreshCw className={busy ? "animate-spin" : undefined} />
          </Button>
          <Button
            size="icon"
            variant={showSettings ? "secondary" : "ghost"}
            onClick={() => {
              setShowSettings((v) => !v);
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
            onProvidersChanged={refresh}
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
                    {/* Auto-switch status dot AFTER the label: green = on, red = off,
                        grey = unavailable (needs 2+ profiles). Shown only for providers
                        with a usage readout (Claude), and hidden when the global master
                        is off. */}
                    {globalAuto && hasUsageReadout(pid) && (
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          count < 2
                            ? "bg-muted-foreground/40"
                            : auto?.[pid]?.enabled
                              ? "bg-[hsl(var(--success))]"
                              : "bg-[hsl(var(--destructive))]",
                        )}
                        title={
                          count < 2
                            ? `Auto-switch unavailable for ${PROVIDER_LABEL[pid]} — needs 2+ profiles`
                            : `Auto-switch ${auto?.[pid]?.enabled ? "on" : "off"} for ${PROVIDER_LABEL[pid]}`
                        }
                        aria-label={
                          count < 2
                            ? `Auto-switch unavailable for ${PROVIDER_LABEL[pid]}`
                            : `Auto-switch ${auto?.[pid]?.enabled ? "on" : "off"} for ${PROVIDER_LABEL[pid]}`
                        }
                      />
                    )}
                    {count > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[10px] leading-tight",
                          active ? "bg-secondary text-secondary-foreground" : "bg-secondary/50",
                        )}
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
                    <div key={r.name} className="px-3 py-2">
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
                                <Play /> Run
                              </Button>
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
                      {usage[r.name] && <UsageBars usage={usage[r.name]} />}
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
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-2 text-muted-foreground hover:text-destructive"
          onClick={() => quitApp()}
        >
          <Power /> Quit
        </Button>
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
  onProvidersChanged,
}: {
  onClose: () => void;
  onUninstall: () => void;
  autoSwitchEnabled: boolean;
  onToggleAutoSwitch: (on: boolean) => void;
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
        <GeneralSettings autoSwitchEnabled={autoSwitchEnabled} onToggleAutoSwitch={onToggleAutoSwitch} />
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
}: {
  autoSwitchEnabled: boolean;
  onToggleAutoSwitch: (on: boolean) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getAutostart()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, []);

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
