import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { t } from "../../i18n/index.js";
import { attachTerminal, tauriBackend, type TermBackend } from "../../terminal.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Sheet } from "../../ui/Overlay.js";
import { RestartButton } from "./settings/updates.js";
import { forceToolsOnNextLoad } from "../../vm/slow-cache.js";
import { useAS, type Overlay, type TerminalRun } from "../../vm/store.js";

/** The command a `terminal` overlay runs: a tool install/update (Tools) or any
 *  `agent-switch` run the screens hand over. */
export function terminalRun(o: Extract<Overlay, { kind: "terminal" }>): TerminalRun {
  if ("run" in o) return o.run;
  const install = o.action === "install";
  return { args: ["tooling", install ? "install" : "upgrade", o.toolId], title: o.toolId, kicker: install ? t("sessions.term.install") : t("sessions.term.update") };
}

/** An agent-config install/upgrade changes the server this app embeds, which
 *  only picks up the new version on a restart. */
export function offersRestart(run: TerminalRun): boolean {
  return run.args[0] === "tooling" && run.args[2] === "agent-config";
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.querySelector(".as-ac") ?? document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** xterm bound to the Rust pty, sized to its box (same wiring as the legacy
 *  EmbeddedTerminal). */
export function XtermBox({
  args,
  backend,
  onExit,
  onError,
  look,
}: {
  args: string[];
  backend: TermBackend;
  onExit: (code: number | null) => void;
  onError?: (message: string) => void;
  /** The v3 workbench passes its theme's terminal palette and type; the sheet keeps the default look. */
  look?: { theme: Record<string, string>; fontSize: number; lineHeight: number };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new XTerm({
      fontSize: look?.fontSize ?? 12,
      lineHeight: look?.lineHeight ?? 1,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true,
      // The CLI's ╭─╮ boxes as xterm's own rounded glyphs (spec §6.4).
      customGlyphs: true,
      theme: look?.theme ?? { background: cssVar("--ac-bg", "#0b0b10"), foreground: cssVar("--ac-soft", "#e5e5ea") },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    // customGlyphs only draws the rounded box arcs with a GPU renderer; the DOM
    // renderer falls back to the font, which leaves gaps (spec §6.4). Without
    // WebGL the DOM renderer stays.
    let disposed = false;
    if (look)
      void import("@xterm/addon-webgl")
        .then(({ WebglAddon }) => {
          if (disposed) return;
          const gl = new WebglAddon();
          gl.onContextLoss(() => gl.dispose());
          term.loadAddon(gl);
        })
        .catch(() => undefined);
    try {
      fit.fit();
    } catch {
      /* not laid out yet — the observer fits */
    }
    term.focus();
    const ctrl = attachTerminal(term, backend, args, onExit, onError);
    const refit = () => {
      try {
        fit.fit();
        ctrl.resize(term.rows, term.cols);
      } catch {
        /* transient layout */
      }
    };
    const ro = new ResizeObserver(refit);
    ro.observe(host);
    return () => {
      disposed = true;
      ro.disconnect();
      void ctrl.dispose();
      term.dispose();
    };
    // Mounted once per command; the host remounts via `key` on a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // `data-terminal`: app shortcuts ignore keys typed in here (useGlobalShortcuts).
  if (!look) return <div ref={hostRef} data-terminal className="min-h-[260px] w-full flex-1 overflow-hidden" />;
  // v3: 16/20 px inside, on the terminal's own background (spec §6.4). The
  // wrapper is padded, never the host, because FitAddon measures the host.
  return (
    <div data-terminal-frame className="flex min-h-0 w-full flex-1 px-5 py-4" style={{ background: look.theme.background }}>
      <div ref={hostRef} data-terminal className="min-h-0 w-full flex-1 overflow-hidden" />
    </div>
  );
}

type Phase = { kind: "running" } | { kind: "finished"; code: number | null } | { kind: "failed"; message: string };

/** Design `terminal` overlay (bundle `wP`, sheet 520) with a real pty instead
 *  of the scripted lines. Closing ends the command, so there is no "Run in
 *  background" — and while it runs, only the Close buttons close the sheet:
 *  Escape goes to the program, a click outside does nothing, and the store
 *  refuses to put another overlay in its place. Closing reloads the view model. */
export function TerminalSheet({ run, backend = tauriBackend }: { run: TerminalRun; backend?: TermBackend }) {
  const s = useAS();
  const [phase, setPhase] = useState<Phase>({ kind: "running" });
  const running = phase.kind === "running";
  const { setTerminalBusy } = s;
  useEffect(() => {
    setTerminalBusy(running);
  }, [running, setTerminalBusy]);
  useEffect(() => () => setTerminalBusy(false), [setTerminalBusy]);
  const close = () => {
    s.close();
    // An install/update changed the tools: the reload re-sweeps them.
    if (run.args[0] === "tooling") forceToolsOnNextLoad();
    void s.reload();
  };
  const status =
    phase.kind === "running" ? (
      <Badge tone="info" dot>
        {t("sessions.term.running")}
      </Badge>
    ) : phase.kind === "failed" ? (
      <Badge tone="alert" dot>
        {t("sessions.term.couldntStart", { message: phase.message })}
      </Badge>
    ) : (
      <Badge tone={phase.code === 0 || phase.code == null ? "ok" : "alert"} dot>
        {t("sessions.term.finished", { code: phase.code == null ? "?" : String(phase.code) })}
      </Badge>
    );
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && close()}
      dismissible={!running}
      kicker={run.kicker ?? t("sessions.term.kicker")}
      title={run.title}
      width={520}
      footer={
        <>
          <span className="mr-auto" role="status" aria-live="polite">
            {status}
          </span>
          {phase.kind === "finished" && phase.code === 0 && offersRestart(run) && s.act.restart && <RestartButton restart={s.act.restart} />}
          <Button size="sm" variant={running ? "secondary" : "primary"} onClick={close} title={running ? t("sessions.term.closingEnds") : undefined}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-[260px] flex-col gap-2">
        <p className="font-ac-mono text-[11px] text-ac-faint">$ agent-switch {run.args.join(" ")}</p>
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-ac-line bg-ac-bg p-3">
          <XtermBox
            key={run.args.join(" ")}
            args={run.args}
            backend={backend}
            onExit={(code) => setPhase({ kind: "finished", code })}
            onError={(message) => setPhase({ kind: "failed", message })}
          />
        </div>
      </div>
    </Sheet>
  );
}
