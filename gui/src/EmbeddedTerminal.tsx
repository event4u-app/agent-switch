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

    const ctrl = attachTerminal(term, tauriBackend, args, () => setExited(true));
    const onResize = () => {
      try {
        fit.fit();
        ctrl.resize(term.rows, term.cols);
      } catch {
        /* ignore transient layout errors */
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      void ctrl.dispose();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col rounded-md border border-border bg-[#0b0b10]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          {title}
          {exited && <span className="ml-2 text-[11px] text-primary">session ended — you can close this</span>}
        </span>
        <Button size="icon" variant="ghost" className="size-6" onClick={onClose} aria-label="Close terminal">
          <X className="size-3.5" />
        </Button>
      </div>
      <div ref={hostRef} className="h-64 w-full overflow-hidden p-1.5" />
    </div>
  );
}
