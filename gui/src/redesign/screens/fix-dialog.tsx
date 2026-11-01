import { useRef, useState } from "react";
import { Check as CheckIcon, Copy, Wrench } from "lucide-react";
import { t, type TKey } from "../../i18n/index.js";
import { getShareSource } from "../../settings-store.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Dialog } from "../../ui/Overlay.js";
import type { Actions } from "../../vm/actions.js";
import { forceDoctorOnNextLoad } from "../../vm/slow-cache.js";
import { useAS } from "../../vm/store.js";
import type { Check } from "../../vm/types.js";

export type Repair = "autostart" | "share-sync" | "shell-integration";

/** The checks Agent Switch can repair itself — only where a real backend call
 *  exists. Everything else is explained, never faked. */
export function repairFor(check: Pick<Check, "id">, act: Pick<Actions, "setAutostart" | "shareSync" | "installShellIntegration">): Repair | null {
  if (check.id === "autostart" && act.setAutostart) return "autostart";
  if (check.id === "shell-integration" && act.installShellIntegration) return "shell-integration";
  if (check.id.startsWith("share-") && act.shareSync) return "share-sync";
  return null;
}

/** The command inside a fix text: the first backticked span (the shell
 *  integration fix names `eval …` first and a help command second), or the
 *  whole text when it is a bare command. */
export function commandInFix(fix: string | undefined): string | null {
  if (!fix) return null;
  const span = /`([^`]+)`/.exec(fix);
  if (span) return span[1];
  return /^(npm|npx|brew|agent-switch|agent-config)\s/.test(fix.trim()) ? fix.trim() : null;
}

/** Translation keys, not text: call `t()` at render time. */
export const CHECK_STATE_LABEL: Record<Check["state"], TKey> = {
  ok: "accounts.fix.statePasses",
  warn: "accounts.fix.stateWarn",
  fail: "accounts.fix.stateFails",
  info: "accounts.fix.stateInfo",
};

async function runRepair(repair: Repair, act: Actions) {
  // The reload after the write must re-run `doctor` to show the after state.
  forceDoctorOnNextLoad();
  if (repair === "autostart") await act.setAutostart?.(true);
  else if (repair === "shell-integration") await act.installShellIntegration?.();
  else await act.shareSync?.(getShareSource());
}

/** Bundle `eR` (dialog 520). Repair re-runs `doctor` (via the reload every
 *  write does) and shows before/after. */
export function FixDialog({ checkId }: { checkId: string }) {
  const s = useAS();
  const check = s.checks.find((c) => c.id === checkId);
  const before = useRef(check?.state);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!check) return null;

  const repair = repairFor(check, s.act);
  const command = repair ? null : commandInFix(check.fix);

  async function onRepair() {
    if (!repair) return;
    setPhase("running");
    setError(null);
    try {
      await runRepair(repair, s.act);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    }
  }

  const footer =
    repair && phase !== "done" ? (
      <>
        <Button size="sm" variant="ghost" onClick={() => s.close()}>
          {t("accounts.fix.notNow")}
        </Button>
        <Button size="sm" variant="primary" onClick={() => void onRepair()} disabled={phase === "running"}>
          <Wrench /> {phase === "running" ? t("accounts.fix.repairing") : phase === "failed" ? t("accounts.action.tryAgain") : t("accounts.fix.repair")}
        </Button>
      </>
    ) : (
      <>
        {!repair && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              forceDoctorOnNextLoad();
              void s.reload();
            }}
            disabled={s.loading}
          >
            {s.loading ? t("accounts.fix.checking") : t("accounts.fix.checkAgain")}
          </Button>
        )}
        <Button size="sm" variant={phase === "done" ? "primary" : "secondary"} onClick={() => s.close()}>
          {t("common.close")}
        </Button>
      </>
    );

  return (
    <Dialog open onOpenChange={(o) => !o && s.close()} kicker={t("accounts.fix.kicker")} title={check.title} width={520} footer={footer}>
      <div className="flex flex-col gap-4">
        <div>
          <span className="ac-caps">{t("accounts.fix.found")}</span>
          <p className="mt-1.5 text-[13px] text-ac-soft">{check.detail || "—"}</p>
        </div>
        <div>
          <span className="ac-caps">{repair ? t("accounts.fix.willChange") : t("accounts.fix.toDo")}</span>
          <p className="mt-1.5 rounded-md border border-ac-line bg-ac-bg p-3 font-ac-mono text-xs text-ac-text">{check.fix}</p>
        </div>
        {command && (
          <div className="flex items-center gap-2 rounded-md border border-ac-line bg-ac-bg px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-ac-mono text-[11px] text-ac-text" title={command}>
              {command}
            </code>
            <IconButton
              label={copied ? t("common.copied") : t("accounts.fix.copyCommand", { command })}
              onClick={() => {
                navigator.clipboard?.writeText(command).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? <CheckIcon /> : <Copy />}
            </IconButton>
          </div>
        )}
        {phase === "done" && (
          <p className="text-[13px] text-ac-soft" role="status">
            {t("accounts.fix.beforeAfter", {
              before: before.current ? t(CHECK_STATE_LABEL[before.current]) : "—",
              after: t(CHECK_STATE_LABEL[check.state]),
            })}
          </p>
        )}
        {phase === "failed" && error && (
          <p className="text-xs text-ac-alert-text" role="alert">
            {t("accounts.fix.failed", { error })}
          </p>
        )}
        <p className="text-[11px] text-ac-faint">
          {repair
            ? t("accounts.fix.repairNote")
            : t("accounts.fix.manualNote")}
        </p>
      </div>
    </Dialog>
  );
}
