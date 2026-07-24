import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Copy, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toolingStatus, type ToolingEntry, type ToolingId } from "./ipc.js";
import { latestToolVersion, toolUpdateAvailable, UPDATE_CHECK_TOOLS } from "./tool-updates.js";
import { relativeAge } from "./transforms.js";

/**
 * Tooling section: renders the CLI's `tooling --json` readout — the ONLY data
 * channel; the GUI never shells out to detect on its own. The sweep is
 * expensive (≈850 ms cold, spike S0.2), so the result is cached by the parent
 * (it survives section switches) with a timestamp shown as "Last checked Xs
 * ago". Invalidation: manual Re-check, window focus when the cache is older
 * than {@link FOCUS_REFRESH_AFTER_MS}, and — owned by the parent — the close of
 * a `tooling install|upgrade` terminal run (the parent nulls the cache, so the
 * remount re-sweeps). A copy action never refreshes — nothing was installed by
 * copying. While a sweep runs with nothing cached, fixed-height skeleton rows
 * hold the layout (no layout shift when results land).
 *
 * Install/update runs happen in the embedded terminal (user-initiated, output
 * fully visible — the owner amendment superseding the copy-only stance); copy
 * stays as the fallback where no verified command exists (agy) and on the
 * attention states (replacing a foreign binary automatically is invasive).
 */

export interface ToolingCache {
  entries: ToolingEntry[];
  at: number;
  /** Latest known version per update-checked tool (rtk/claude/codex), fetched
   *  once per sweep and cached WITH the entries — same age, same invalidation.
   *  Absent id / null = latest unknown → that row renders no Update button. */
  latest?: Partial<Record<ToolingId, string | null>>;
}

/** Latest-version lookups for the present+healthy update-checked tools — one
 *  round per sweep. Failures are already null inside latestToolVersion, so a
 *  dead registry can never fail the sweep. */
async function fetchLatestVersions(entries: ToolingEntry[]): Promise<Partial<Record<ToolingId, string | null>>> {
  const targets = entries.filter((t) => t.present && t.healthy && UPDATE_CHECK_TOOLS.has(t.id));
  const pairs = await Promise.all(targets.map(async (t) => [t.id, await latestToolVersion(t.id)] as const));
  return Object.fromEntries(pairs);
}

/** Window-focus re-sweep threshold: a fresher cache is served as-is. */
export const FOCUS_REFRESH_AFTER_MS = 60_000;

/** Row state classes per the redesign spec § 3 — height encodes urgency:
 *  ok 58px · attention (wrong-binary/unverified/unhealthy) 94px amber ·
 *  missing 76px. */
export type RowState = "ok" | "attention" | "missing";

export function rowState(t: ToolingEntry): RowState {
  if (!t.present) return "missing";
  return t.healthy ? "ok" : "attention";
}

// Attention-first sort: the tallest (most urgent) class leads. Stable within
// groups — Array.prototype.sort preserves the CLI's input order.
const STATE_RANK: Record<RowState, number> = { attention: 0, missing: 1, ok: 2 };

export function sortByAttention(entries: ToolingEntry[]): ToolingEntry[] {
  return [...entries].sort((a, b) => STATE_RANK[rowState(a)] - STATE_RANK[rowState(b)]);
}

/** One line per tool: what it does FOR THE USER, never how it is wired
 *  (spec § Copy rules). */
export const TOOL_DESCRIPTIONS: Record<ToolingId, string> = {
  "agent-config": "Governance rules and skills for your agents",
  rtk: "Shrinks verbose tool output before it reaches your agent's context (third-party, Apache-2.0)",
  claude: "Claude Code CLI",
  codex: "Codex CLI",
  agy: "Antigravity CLI",
};

/** Tools with a verified per-platform install/upgrade command behind
 *  `agent-switch tooling install|upgrade <id>`. agy is deliberately absent —
 *  the CLI refuses it honestly (no standalone installer), so its row keeps the
 *  copy-command fallback only. */
export const INSTALLABLE_TOOLS: ReadonlySet<ToolingId> = new Set(["agent-config", "rtk", "claude", "codex"]);

/** Header attention summary: "N of M need attention", or "All M healthy". */
export function attentionSummary(entries: ToolingEntry[]): string {
  const n = entries.filter((t) => rowState(t) !== "ok").length;
  if (n === 0) return `All ${entries.length} healthy`;
  return `${n} of ${entries.length} need${n === 1 ? "s" : ""} attention`;
}

/** Footer platform tag from the webview's user agent. The CPU arch is not
 *  available in a webview UA — omit it rather than fake it (the SVG's "arm64"
 *  is aspirational; a wrong arch would be an invented fact). */
export function platformLabel(userAgent: string): string | null {
  if (/Mac/i.test(userAgent)) return "macOS";
  if (/Win/i.test(userAgent)) return "Windows";
  if (/Linux/i.test(userAgent)) return "Linux";
  return null;
}

/** The runnable command inside a CLI hint = its LAST backticked span (the
 *  first span can be a bare tool name, e.g. "the `rtk` on PATH … — install:
 *  `brew install rtk`"). Null when the hint carries no command. */
export function commandFromHint(hint: string): string | null {
  const spans = hint.match(/`([^`]+)`/g);
  return spans && spans.length > 0 ? spans[spans.length - 1].slice(1, -1) : null;
}

/** Render a hint sentence with its backticked spans as inline code. */
function HintText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[11px]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

/** State label + explanation. Colour is never the only signal — every row
 *  pairs its icon/accent with a text label. rtk's identity states get their
 *  own sentences (the collision must be named); everything else shows the
 *  CLI's actionable hint verbatim (single source, two renderers). */
function describeEntry(t: ToolingEntry): { label: string; explanation: string | null } {
  const state = rowState(t);
  if (state === "ok") return { label: "OK", explanation: null };
  if (state === "missing") return { label: "Not installed", explanation: t.hint };
  if (t.identity === "unknown-rtk") {
    return {
      label: "Wrong binary",
      explanation:
        "This `rtk` is not Token Killer — it is likely the unrelated Rust Type Kit (a documented name collision). Install the real one:",
    };
  }
  if (t.identity === "unverified") {
    return {
      label: "Unverified",
      explanation:
        "The identity check failed (the probe timed out or crashed) — verify manually with `rtk gain`:",
    };
  }
  return { label: "Unhealthy", explanation: t.hint };
}

function ToolingRow({
  entry,
  isWindows,
  profileCount,
  updateTo,
  latest,
  onRunTool,
  onNotifyError,
}: {
  entry: ToolingEntry;
  isWindows: boolean;
  /** Isolated profile count for provider rows (claude/codex/agy); undefined
   *  for non-provider tools. */
  profileCount?: number;
  /** agent-config only: the newer version App's update detection found (null =
   *  none known) — turns the Update label into "Update to vX". */
  updateTo: string | null;
  /** Latest known version from the sweep's registry check (rtk/claude/codex);
   *  null = unknown/unfetchable → no Update button (honest, not speculative). */
  latest: string | null;
  onRunTool: (action: "install" | "upgrade", id: ToolingId) => void;
  onNotifyError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const state = rowState(entry);
  const { label, explanation } = describeEntry(entry);
  const command = state === "ok" ? null : commandFromHint(entry.hint);
  const installable = INSTALLABLE_TOOLS.has(entry.id);
  // Button per row state (owner amendment): missing + verified command →
  // Install runs in the embedded terminal; healthy → Update ONLY when an
  // update actually exists (owner requirement): agent-config from App's
  // release detection (single source), rtk/claude/codex from the sweep's
  // registry check. Unknown latest → no button, never a speculative one.
  // Copy stays for agy (no verified command) and the attention states
  // (auto-replacing a foreign binary is invasive).
  const updateAvailable = entry.id === "agent-config" ? updateTo !== null : toolUpdateAvailable(entry, latest);
  const showInstall = state === "missing" && installable;
  const showUpdate = state === "ok" && installable && updateAvailable;
  const showCopy = command !== null && !showInstall;
  const updateVersion = entry.id === "agent-config" ? updateTo : latest;

  async function copyCommand() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      onNotifyError(e instanceof Error ? e.message : String(e)); // notification only — nothing inline
    }
  }

  // Description line per the design contract: what the tool does · version ·
  // isolated-profile count (provider rows only).
  const meta = [
    TOOL_DESCRIPTIONS[entry.id],
    entry.version ? `v${entry.version}` : null,
    profileCount != null && profileCount > 0
      ? `${profileCount} profile${profileCount === 1 ? "" : "s"} isolated`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-testid="tooling-row"
      data-state={state}
      className={cn(
        "flex flex-col justify-center rounded-[10px] border border-border bg-card px-4 py-2.5",
        state === "ok" && "min-h-[58px]",
        state === "attention" && "min-h-[94px] border-l-[3px] border-l-[hsl(var(--warning))]",
        state === "missing" && "min-h-[76px]",
      )}
    >
      <div className="flex items-center gap-2">
        {state === "ok" ? (
          <Check className="size-4 shrink-0 text-[hsl(var(--success))]" aria-hidden />
        ) : state === "attention" ? (
          <AlertTriangle className="size-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
        ) : (
          <AlertCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="text-[13px] font-medium">{entry.id}</span>
        <span
          className={cn(
            "text-[11px] font-medium",
            state === "ok"
              ? "text-[hsl(var(--success))]"
              : state === "attention"
                ? "text-[hsl(var(--warning))]"
                : "rounded-full bg-muted px-1.5 text-muted-foreground",
          )}
        >
          {state === "missing" ? "Not found" : label}
        </span>
        {state === "ok" && entry.path && (
          <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={entry.path}>
            {entry.path}
          </span>
        )}
        {showUpdate && (
          <Button
            size="sm"
            variant="secondary"
            className={cn("shrink-0", !entry.path && "ml-auto")}
            onClick={() => onRunTool("upgrade", entry.id)}
            title={`Run \`agent-switch tooling upgrade ${entry.id}\` in the embedded terminal`}
          >
            {updateVersion ? `Update to v${updateVersion.replace(/^[vV]/, "")}` : "Update"}
          </Button>
        )}
        {showInstall && (
          <Button
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => onRunTool("install", entry.id)}
            title={`Run \`agent-switch tooling install ${entry.id}\` in the embedded terminal`}
          >
            <Download /> Install
          </Button>
        )}
        {showCopy && (
          <Button size="sm" className="ml-auto shrink-0" onClick={() => void copyCommand()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy command"}
          </Button>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{meta}</p>
      {explanation && <HintText text={explanation} className="mt-1" />}
      {showCopy && command && !isWindows && command.startsWith("npm ") && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Run it in your own terminal. If it fails with EACCES, see npm&apos;s permissions guide (or use a Node
          version manager).
        </p>
      )}
    </div>
  );
}

/** Fixed-height placeholders while the first sweep runs — same card shape as a
 *  healthy row (58px) so results landing never shift the layout upward. */
function SkeletonRows() {
  return (
    <div className="space-y-2.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          data-testid="tooling-skeleton"
          className="flex min-h-[58px] animate-pulse flex-col justify-center rounded-[10px] border border-border bg-card px-4 py-2.5"
        >
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="mt-2 h-3 w-48 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function ToolingSection({
  cache,
  onCache,
  isWindows,
  profileCounts,
  agentConfigUpdateTo,
  onRunTool,
  onNotifyError,
}: {
  /** Sweep cache, owned by the parent so it survives section switches (and so
   *  the parent can null it after a tooling terminal run → remount re-sweeps). */
  cache: ToolingCache | null;
  onCache: (cache: ToolingCache) => void;
  isWindows: boolean;
  /** Profile count per provider tool id ("N profiles isolated" on those rows). */
  profileCounts: Partial<Record<ToolingId, number>>;
  /** Newer agent-config version from App's update detection, or null. */
  agentConfigUpdateTo: string | null;
  /** Open the embedded terminal on `agent-switch tooling <action> <id>`. */
  onRunTool: (action: "install" | "upgrade", id: ToolingId) => void;
  onNotifyError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  // Refs so the mount/focus effects read the CURRENT cache + busy state without
  // re-subscribing (and never queue overlapping sweeps).
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const busyRef = useRef(false);

  async function sweep() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const entries = await toolingStatus();
      const at = Date.now();
      onCache({ entries, at });
      // Latest-version lookups ride the same sweep (and the same cache entry —
      // same age, same invalidation) but land after the rows, so a slow
      // registry never delays the readout itself.
      const latest = await fetchLatestVersions(entries);
      onCache({ entries, at, latest });
    } catch (e) {
      onNotifyError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // First open with nothing cached → run the sweep in the background (the
  // skeletons below hold the layout). A cached readout renders immediately.
  // This is also the re-check path after a tooling terminal run: the parent
  // nulls the cache on that terminal's close, and this remount re-sweeps.
  useEffect(() => {
    if (!cacheRef.current) void sweep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window focus invalidation: the user may have just installed something in
  // their own terminal — re-sweep, but only when the cache has actually aged.
  useEffect(() => {
    const onFocus = () => {
      const c = cacheRef.current;
      if (c && Date.now() - c.at > FOCUS_REFRESH_AFTER_MS) void sweep();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1s ticker for the "Last checked Xs ago" footer line.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const entries = cache ? sortByAttention(cache.entries) : null;
  const platform = platformLabel(typeof navigator === "undefined" ? "" : navigator.userAgent);

  return (
    <div className="flex min-h-full flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2.5">
          <div className="text-sm font-semibold tracking-tight">Tooling</div>
          {entries && <span className="text-xs text-muted-foreground">{attentionSummary(entries)}</span>}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => void sweep()}
          disabled={busy}
          aria-label="Re-check tooling"
          title="Re-run the detection sweep now"
        >
          <RefreshCw className={cn(busy && "animate-spin")} /> Re-check
        </Button>
      </div>
      <div className="text-[10px] font-medium tracking-[.09em] text-muted-foreground">AGENT STACK</div>
      {entries ? (
        <div className="space-y-2.5">
          {entries.map((t) => (
            <ToolingRow
              key={t.id}
              entry={t}
              isWindows={isWindows}
              profileCount={profileCounts[t.id]}
              updateTo={agentConfigUpdateTo}
              latest={cache?.latest?.[t.id] ?? null}
              onRunTool={onRunTool}
              onNotifyError={onNotifyError}
            />
          ))}
        </div>
      ) : (
        <SkeletonRows />
      )}
      <HintText text="Checks run from the same readout as `agent-switch doctor` — the CLI and this page can never disagree." />
      <div className="mt-auto flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums" title="Age of the last detection sweep">
          {cache ? `Last checked ${relativeAge(cache.at, nowTick)} ago` : "Checking…"}
        </span>
        {platform && <span>{platform}</span>}
      </div>
    </div>
  );
}
