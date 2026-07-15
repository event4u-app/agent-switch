import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { X } from "lucide-react";
import { attachTerminal, tauriBackend } from "./terminal.js";
import { Button } from "@/components/ui/button";

/**
 * An in-app terminal running `agent-switch <args>` in a real pty — replaces the
 * external Terminal.app window for interactive flows (login, `run`). Mount it
 * with a stable `args` (App remounts via `key` when the command changes).
 */
export function EmbeddedTerminal({
  args,
  title,
  onClose,
}: {
  args: string[];
  title: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new XTerm({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true,
      theme: { background: "#0b0b10", foreground: "#e5e5ea" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* host not laid out yet — resize handler will fit */
    }
    term.focus(); // start typing immediately — no click-to-focus first

    const ctrl = attachTerminal(term, tauriBackend, args, () => setExited(true));
    const refit = () => {
      try {
        fit.fit();
        ctrl.resize(term.rows, term.cols);
      } catch {
        /* ignore transient layout errors */
      }
    };
    // Re-fit whenever the host box changes — window resize, the window being
    // dragged to a new size, or the initial layout settling. A ResizeObserver on
    // the host catches all three (a window-resize listener alone misses the last).
    const ro = new ResizeObserver(refit);
    ro.observe(host);
    window.addEventListener("resize", refit);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refit);
      void ctrl.dispose();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-[#0b0b10]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          {title}
          {exited && <span className="ml-2 text-[11px] text-primary">session ended — you can close this</span>}
        </span>
        <Button size="icon" variant="ghost" className="size-6" onClick={onClose} aria-label="Close terminal">
          <X className="size-3.5" />
        </Button>
      </div>
      {/* Grow to fill the panel; min-h-0 lets the flex child actually shrink so
          the FitAddon can size the pty to the real available height. A generous
          black bottom margin keeps the CLI's status line off the border so it
          stays readable (the FitAddon sizes the pty inside this padding). */}
      <div ref={hostRef} className="min-h-0 w-full flex-1 overflow-hidden px-1.5 pt-1.5 pb-16" />
    </div>
  );
}
