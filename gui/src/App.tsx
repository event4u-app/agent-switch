import { useEffect, useState } from "react";
import { Plus, RefreshCw, Play, LogIn, X, AlertCircle, Info, Power, Trash2 } from "lucide-react";
import {
  activeStatus,
  createProfile,
  deactivateProfile,
  listProfiles,
  openSession,
  quitApp,
  removeProfile,
  switchProfile,
} from "./ipc.js";
import { groupByProvider, nearestLimit, type ProfileRow, type StatusJson, type ProviderId } from "./transforms.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROVIDERS: ProviderId[] = ["claude", "codex", "gemini"];
const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };

/** Turn a raw CLI failure into something the user can act on. A spawn failure
 *  means the `agent-switch` binary is not on PATH. */
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

export default function App() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [status, setStatus] = useState<StatusJson | null>(null);
  const [selected, setSelected] = useState<ProviderId>("claude");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /** Run a mutating CLI action, then refresh; surface any failure. */
  function act(fn: () => Promise<void>) {
    fn()
      .then(refresh)
      .catch((e) => setError(describeError(e)));
  }

  async function refresh() {
    // Load the list first; if that fails the CLI is unreachable, so surface an
    // actionable error and skip status. A status failure must never blank the
    // already-loaded list, so it gets its own catch. Status is per-selected-
    // provider (usage only exists for Claude; others report identity only).
    setBusy(true);
    try {
      setRows(await listProfiles());
      setError(null);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
      return;
    }
    try {
      setStatus(await activeStatus(selected));
    } catch (e) {
      setStatus(null);
      setError(describeError(e));
    }
    setBusy(false);
  }

  // Re-runs on mount and whenever the provider tab changes (status is per-provider).
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const grouped = groupByProvider(rows);
  const limit = nearestLimit(status?.usage ?? null);
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
        {/* Provider switcher: profiles are sectioned by provider, one panel at a time. */}
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
            onCreate={async (provider, name) => {
              setBusy(true);
              try {
                await createProfile(provider, name);
                setError(null);
                setShowCreate(false);
                setSelected(provider); // jump to the tab we just created into
                setNotice(
                  `Creating ${PROVIDER_LABEL[provider]} profile “${name}”. Complete the login in the Terminal window, then hit Refresh.`,
                );
              } catch (e) {
                setError(describeError(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {status && status.provider === selected && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Active</span>
                <div className="flex items-center gap-1.5">
                  {limit !== null && <Badge variant={limit >= 90 ? "outline" : "default"}>{limit}% used</Badge>}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => act(() => deactivateProfile(status.provider))}
                  >
                    <Power /> Deactivate
                  </Button>
                </div>
              </div>
              <div className="text-sm font-medium">
                {PROVIDER_LABEL[status.provider]} / {status.name}
                {status.identity && <span className="ml-1.5 font-normal text-muted-foreground">{status.identity}</span>}
              </div>
            </CardHeader>
            <CardContent>
              {status.usage && status.usage.windows.length > 0 ? (
                <div className="space-y-2">
                  {status.usage.windows.map((w) => (
                    <div key={w.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{w.label}</span>
                        <span className="tabular-nums">{w.utilization ?? "?"}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, w.utilization ?? 0)}%`,
                            background: utilColor(w.utilization ?? 0),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No usage source</div>
              )}
            </CardContent>
          </Card>
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
                <div key={r.name} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: r.active ? "hsl(var(--success))" : "hsl(var(--border))" }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">{r.name}</span>
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
                        {!r.active && (
                          <Button size="sm" variant="secondary" onClick={() => act(() => switchProfile(selected, r.name))}>
                            Use
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openSession(selected, r.name)}>
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
              ))}
            </div>
          </Card>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">Menu-bar app · closing hides it</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-muted-foreground hover:text-destructive"
          onClick={() => quitApp()}
        >
          <Power /> Quit
        </Button>
      </footer>
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
  // Pre-selected to the open provider tab; the user can still change it.
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
          Opens a terminal to complete the provider login, then hit Refresh.
        </p>
      </CardContent>
    </Card>
  );
}
