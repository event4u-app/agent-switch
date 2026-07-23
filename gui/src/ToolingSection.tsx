import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toolingStatus, type ToolingEntry } from "./ipc.js";
import { relativeAge } from "./transforms.js";

/**
 * Tooling section: renders the CLI's `tooling --json` readout — the ONLY data
 * channel; the GUI never shells out to detect on its own. The sweep is
 * expensive (≈850 ms cold, spike S0.2), so the result is cached by the parent
 * (it survives section switches) with a timestamp shown as "checked Xs ago".
 * Invalidation: manual Refresh, and window focus when the cache is older than
 * {@link FOCUS_REFRESH_AFTER_MS}. A copy action never refreshes — nothing was
 * installed by copying. While a sweep runs with nothing cached, fixed-height
 * skeleton rows hold the layout (no layout shift when results land).
 */

export interface ToolingCache {
  entries: ToolingEntry[];
  at: number;
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
  onNotifyError,
}: {
  entry: ToolingEntry;
  isWindows: boolean;
  onNotifyError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const state = rowState(entry);
  const { label, explanation } = describeEntry(entry);
  const command = state === "ok" ? null : commandFromHint(entry.hint);

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
        {entry.version && <span className="text-xs text-muted-foreground">v{entry.version}</span>}
        <span
          className={cn(
            "text-[11px] font-medium",
            state === "ok"
              ? "text-[hsl(var(--success))]"
              : state === "attention"
                ? "text-[hsl(var(--warning))]"
                : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {state === "ok" && entry.path && (
          <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={entry.path}>
            {entry.path}
          </span>
        )}
        {command && (
          <Button size="sm" className="ml-auto shrink-0" onClick={() => void copyCommand()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy command"}
          </Button>
        )}
      </div>
      {explanation && <HintText text={explanation} className="mt-1" />}
      {command && !isWindows && command.startsWith("npm ") && (
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
  onNotifyError,
}: {
  /** Sweep cache, owned by the parent so it survives section switches. */
  cache: ToolingCache | null;
  onCache: (cache: ToolingCache) => void;
  isWindows: boolean;
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
      onCache({ entries, at: Date.now() });
    } catch (e) {
      onNotifyError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // First open with nothing cached → run the sweep in the background (the
  // skeletons below hold the layout). A cached readout renders immediately.
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

  // 1s ticker for the "checked Xs ago" age line (same cadence as the footer).
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const entries = cache ? sortByAttention(cache.entries) : null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold tracking-tight">Tooling</div>
          <p className="text-xs text-muted-foreground">
            Health of your agent toolchain — detected by the agent-switch CLI, never run from this app.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {cache && (
            <span className="tabular-nums text-[11px] text-muted-foreground" title="Age of the last detection sweep">
              checked {relativeAge(cache.at, nowTick)} ago
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => void sweep()}
            disabled={busy}
            aria-label="Refresh tooling"
            title="Re-run the detection sweep now"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          </Button>
        </div>
      </div>
      {entries ? (
        <div className="space-y-2.5">
          {entries.map((t) => (
            <ToolingRow key={t.id} entry={t} isWindows={isWindows} onNotifyError={onNotifyError} />
          ))}
        </div>
      ) : (
        <SkeletonRows />
      )}
    </div>
  );
}
