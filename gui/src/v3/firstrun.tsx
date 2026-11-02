/**
 * First run (spec §10.6): no accounts yet, one path, no tour. The detected
 * tools with their sign-in state, then the shell integration — shown in full
 * before it changes anything.
 */

import { useState } from "react";
import { CircleCheck, Download } from "lucide-react";
import { AppLogo } from "../ui/AppLogo.js";
import { Button } from "../ui/Button.js";
import { Act } from "./kit.js";

export interface DetectedTool {
  id: string;
  name: string;
  /** "~/.claude · signed in as work@example.com" or "not installed". */
  detail: string;
  signedIn: boolean;
  installed: boolean;
}

export interface ShellPlan {
  /** The rc file it would change, e.g. "~/.zshrc". */
  file: string;
  /** The exact lines it would add. */
  lines: string[];
}

/** "Add and continue" · "Add both and continue" · "Add all 3 and continue". Pure. */
export function addAllLabel(n: number): string {
  return n <= 1 ? "Add and continue" : n === 2 ? "Add both and continue" : `Add all ${n} and continue`;
}

export function FirstRun({ tools, shell, on }: { tools: DetectedTool[]; shell: ShellPlan; on: { add: (id: string) => void; install: (id: string) => void; addAll: (ids: string[]) => void; addAnother: () => void; applyShell: () => void; done: () => void } }) {
  const [step, setStep] = useState<"accounts" | "shell">("accounts");
  const ready = tools.filter((t) => t.installed && t.signedIn);
  return (
    <div className="flex h-full flex-col bg-ac-bg">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ac-line bg-ac-rail pl-[84px] pr-3">
        <AppLogo className="size-6" />
        <span className="text-[13px] font-semibold text-ac-text">Agent Switch</span>
      </header>
      <div className="flex flex-1 items-center justify-center">
        {step === "accounts" ? (
          <div className="w-[560px]">
            <h1 className="text-[22px] font-semibold text-ac-text">Let's find your accounts</h1>
            <p className="mt-1 text-[13px] text-ac-muted">Agent Switch looked on this computer. Sign-ins stay where they are; nothing is copied off the machine.</p>
            <div className="mt-5 overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
              {tools.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-b border-ac-line px-4 py-3 last:border-b-0">
                  {t.installed ? <CircleCheck className="size-4 text-ac-ok" /> : <Download className="size-4 text-ac-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ac-text">{t.name}</span>
                    <span className="block font-ac-mono text-[11px] text-ac-muted">{t.detail}</span>
                  </span>
                  {!t.installed ? (
                    <Act onClick={() => on.install(t.id)}>Install…</Act>
                  ) : t.signedIn ? (
                    <Act kind="accent" onClick={() => on.add(t.id)}>
                      Add as “work”
                    </Act>
                  ) : (
                    <Act onClick={() => on.add(t.id)}>Sign in…</Act>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" disabled={!ready.length} onClick={() => (on.addAll(ready.map((t) => t.id)), setStep("shell"))}>
                {addAllLabel(ready.length)}
              </Button>
              <Button variant="ghost" onClick={on.addAnother}>
                Add another account…
              </Button>
            </div>
            <p className="mt-4 text-xs text-ac-muted">Next: the shell integration, so a plain “claude” follows your rules — one click, shown before it changes anything.</p>
          </div>
        ) : (
          <div className="w-[560px]">
            <h1 className="text-[22px] font-semibold text-ac-text">Shell integration</h1>
            <p className="mt-1 text-[13px] text-ac-muted">
              These lines go into <span className="font-ac-mono text-ac-text">{shell.file}</span>. Nothing changes until you choose.
            </p>
            <pre className="mt-4 whitespace-pre-wrap rounded-[10px] border border-ac-line bg-ac-panel px-4 py-3 font-ac-mono text-[12px] text-ac-soft">{shell.lines.join("\n")}</pre>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="primary" onClick={() => (on.applyShell(), on.done())}>
                Add to {shell.file}
              </Button>
              <Button variant="ghost" onClick={on.done}>
                Not now
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
