import { useState } from "react";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentConfigView } from "./agent-config.js";

/**
 * Generated brand mark for the card — a gradient rounded square with a
 * stacked-layers glyph (the "curated library compiled into hosts" idea). Inline
 * SVG so it stays crisp at any DPI and picks up the app's primary colour, so it
 * themes with the rest of the UI instead of shipping a fixed raster asset.
 */
export function AgentConfigMark() {
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
 * Recommendation / upgrade card for the companion CLI. Two render sites:
 * the Ecosystem section (`variant="ecosystem"`, permanent, user-visited) and
 * a first-run variant on Profiles (`variant="first-run"`, dismissible — a
 * dismissal is permanent, persisted by the parent). The primary action runs
 * the install/upgrade one-click in the background via `onRun`; the parent
 * owns the run (IPC + re-detection) and routes any failure through the
 * notification system — never inline, so `onRun` must not reject. In dev
 * mode a preview toggle cycles through every display, and a "Test error"
 * button exercises the error path.
 */
export function AgentConfigCard({
  view,
  variant,
  devMode,
  onOpenRepo,
  onRun,
  onDismiss,
  onNotifyError,
}: {
  view: VisibleView;
  variant: "ecosystem" | "first-run";
  devMode: boolean;
  onOpenRepo: () => void;
  /** Runs `tooling install|upgrade agent-config` in the background. Never
   *  rejects — the parent reports failures via the notification system. */
  onRun: (action: "install" | "upgrade") => Promise<void>;
  /** first-run only: permanent dismissal, persisted by the parent. */
  onDismiss?: () => void;
  onNotifyError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Dev-only preview cursor over the 3 states — starts on the real (detected)
  // one, so cycling visits each display exactly once (no duplicate real state).
  const [previewIdx, setPreviewIdx] = useState(() => Math.max(0, PREVIEW_MODES.indexOf(view.mode)));

  const shown = devMode ? previewView(PREVIEW_MODES[previewIdx], view) : view;

  async function run() {
    setBusy(true);
    try {
      await onRun(shown.mode === "update" ? "upgrade" : "install");
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

  const showAction = shown.mode === "install" || shown.mode === "update";

  return (
    <div className="rounded-[10px] border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        {/* The card body is the repo link (a real button → keyboard-accessible);
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
            >
              Test error
            </Button>
          )}
          {devMode && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-muted-foreground"
              title={`Preview card state (dev) — ${PREVIEW_MODES[previewIdx]}`}
              aria-label="Cycle card preview"
              onClick={() => setPreviewIdx((i) => (i + 1) % PREVIEW_MODES.length)}
            >
              <Eye />
            </Button>
          )}
          {showAction && (
            <Button size="sm" disabled={busy} onClick={() => void run()}>
              {busy
                ? shown.mode === "update"
                  ? "Updating…"
                  : "Installing…"
                : shown.mode === "update"
                  ? `Update to v${shown.latest}`
                  : "Install"}
            </Button>
          )}
          {variant === "first-run" && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-muted-foreground"
              title="Dismiss — the recommendation stays available under Ecosystem"
              aria-label="Dismiss agent-config recommendation"
              onClick={onDismiss}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
