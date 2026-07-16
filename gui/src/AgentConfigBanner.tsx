import { useState } from "react";
import { Download, RefreshCw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentConfigView } from "./agent-config.js";

/**
 * Generated brand mark for the banner — a gradient rounded square with a
 * stacked-layers glyph (the "curated library compiled into hosts" idea). Inline
 * SVG so it stays crisp at any DPI and picks up the app's primary colour, so it
 * themes with the rest of the UI instead of shipping a fixed raster asset.
 */
function AgentConfigMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="agent-config-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="34" height="34" rx="9" fill="url(#agent-config-mark)" />
      <g fill="#fff">
        <rect x="9" y="10.5" width="18" height="4" rx="2" opacity="0.95" />
        <rect x="9" y="16.5" width="14" height="4" rx="2" opacity="0.8" />
        <rect x="9" y="22.5" width="10" height="4" rx="2" opacity="0.6" />
      </g>
    </svg>
  );
}

type VisibleView = Extract<AgentConfigView, { visible: true }>;

/** Dev-mode preview: the ordered set of displays the toggle cycles through. */
const PREVIEW_MODES = ["install", "update", "installed"] as const;

/** Build a synthetic view for a preview mode, reusing the real versions where
 *  known and falling back to sample numbers so every display is inspectable. */
function previewView(mode: (typeof PREVIEW_MODES)[number], real: VisibleView): VisibleView {
  const current = "current" in real ? real.current : "9.1.0";
  const latest = real.mode === "update" || real.mode === "installed" ? (real.latest ?? "9.2.0") : "9.2.0";
  if (mode === "install") return { visible: true, mode: "install" };
  if (mode === "update") return { visible: true, mode: "update", current, latest };
  return { visible: true, mode: "installed", current, latest };
}

/**
 * Recommendation / upgrade banner for the companion CLI, shown above the footer.
 * The body is a link to the repo; the action button (Install / Update) runs the
 * install/upgrade and, on success, the parent re-detects and hides the banner.
 * A failure is surfaced ONLY through the notification system (`onNotifyError` →
 * in-app + host desktop notification) — never inline. In dev mode a preview
 * toggle cycles through every display, and a "Test error" button exercises the
 * error path.
 */
export function AgentConfigBanner({
  view,
  devMode,
  onOpenRepo,
  onInstall,
  onUpdate,
  onSuccess,
  onNotifyError,
}: {
  view: VisibleView;
  devMode: boolean;
  onOpenRepo: () => void;
  onInstall: () => Promise<void>;
  onUpdate: () => Promise<void>;
  onSuccess: () => void;
  onNotifyError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Dev-only preview cursor over the 3 states — starts on the real (detected)
  // one, so cycling visits each display exactly once (no duplicate real state).
  const [previewIdx, setPreviewIdx] = useState(() => Math.max(0, PREVIEW_MODES.indexOf(view.mode)));

  const shown = devMode ? previewView(PREVIEW_MODES[previewIdx], view) : view;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      onSuccess(); // parent re-detects → banner hides when it's now installed / up to date
    } catch (e) {
      onNotifyError(e instanceof Error ? e.message : String(e)); // notification only — nothing inline
    } finally {
      setBusy(false);
    }
  }

  const headline =
    shown.mode === "install"
      ? "Supercharge your AI agents with agent-config (free & open source)"
      : shown.mode === "update"
        ? "agent-config update available"
        : shown.latest === shown.current
          ? "agent-config is up to date"
          : "agent-config is installed";
  const body =
    shown.mode === "install"
      ? "A curated library of skills, commands and governed rules compiled into Claude Code, Cursor and 5+ hosts — with zero runtime daemon."
      : shown.mode === "update"
        ? `Installed v${shown.current} · v${shown.latest} available.`
        : `Installed v${shown.current} · ${shown.latest ? `latest is v${shown.latest}` : "latest unknown"}.`;

  return (
    <div className="flex items-center gap-3 border-t border-border bg-gradient-to-r from-primary/15 to-primary/5 px-3 py-2.5">
      {/* The banner body is the repo link (a real button → keyboard-accessible);
       *  the controls are siblings, never nested inside it. */}
      <button
        type="button"
        onClick={onOpenRepo}
        title="Open the agent-config repository"
        className="flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity hover:opacity-90"
      >
        <AgentConfigMark />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight">{headline}</div>
          <div className="truncate text-xs text-muted-foreground">{body}</div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        {devMode && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => onNotifyError("Simulated agent-config failure (dev test).")}
            disabled={busy}
          >
            Test error
          </Button>
        )}
        {shown.mode === "install" && (
          <Button size="sm" onClick={() => run(onInstall)} disabled={busy}>
            <Download />
            {busy ? "Installing…" : "Install (free)"}
          </Button>
        )}
        {shown.mode === "update" && (
          <Button size="sm" onClick={() => run(onUpdate)} disabled={busy}>
            <RefreshCw />
            {busy ? "Updating…" : `Update to v${shown.latest}`}
          </Button>
        )}
        {devMode && (
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground"
            title={`Preview banner state (dev) — ${PREVIEW_MODES[previewIdx]}`}
            aria-label="Cycle banner preview"
            onClick={() => setPreviewIdx((i) => (i + 1) % PREVIEW_MODES.length)}
          >
            <Eye />
          </Button>
        )}
      </div>
    </div>
  );
}
