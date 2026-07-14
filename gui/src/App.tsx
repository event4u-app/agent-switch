import { useEffect, useState } from "react";
import { Plus, RefreshCw, Play, LogIn, X, AlertCircle, Info, Power, Trash2 } from "lucide-react";
import {
  deactivateProfile,
  getAutoSwitch,
  listProfiles,
  loginArgs,
  profileUsage,
  quitApp,
  removeProfile,
  sessionArgs,
  setAutoSwitch,
  setProfileLabel,
  switchProfile,
  uninstall,
  type AutoSwitchMap,
} from "./ipc.js";
import { EmbeddedTerminal } from "./EmbeddedTerminal.js";
import {
  groupByProvider,
  formatReset,
  PROFILE_LABELS,
  type ProfileRow,
  type ProfileLabel,
  type UsageSnapshot,
  type ProviderId,
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
  const [auto, setAuto] = useState<AutoSwitchMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  // The in-app pty terminal overlay (login / run), or null when none is open.
  const [terminal, setTerminal] = useState<{ args: string[]; title: string } | null>(null);

  function act(fn: () => Promise<void>) {
    fn()
      .then(refresh)
      .catch((e) => setError(describeError(e)));
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
        ) : (
          <>
            <div role="tablist" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {PROVIDERS.map((pid) => {
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
                    {auto?.[pid]?.enabled && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--destructive))]"
                        title={`Auto-switch on for ${PROVIDER_LABEL[pid]}`}
                        aria-label={`Auto-switch on for ${PROVIDER_LABEL[pid]}`}
                      />
                    )}
                    {PROVIDER_LABEL[pid]}
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
        {auto && (
          <button
            className={cn(
              "flex items-center gap-1.5 text-[11px] transition-colors",
              auto[selected].enabled ? "text-[hsl(var(--destructive))]" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => act(() => setAutoSwitch(selected, !auto[selected].enabled))}
            title={`Auto-switch the active ${PROVIDER_LABEL[selected]} account to the one with the most headroom when it hits its limit (this provider only)`}
          >
            <span
              className={cn("size-2 rounded-full", auto[selected].enabled ? "bg-[hsl(var(--destructive))]" : "bg-border")}
            />
            Auto-switch · {PROVIDER_LABEL[selected]} {auto[selected].enabled ? `on (${auto[selected].threshold}%)` : "off"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {confirmUninstall ? (
            <>
              <span className="text-[11px] text-muted-foreground">Remove all data?</span>
              <Button size="sm" variant="destructive" onClick={() => act(() => uninstall().then(quitApp))}>
                Uninstall
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmUninstall(false)}>
                No
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmUninstall(true)}
            >
              Uninstall
            </Button>
          )}
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
