import { useState } from "react";
import { handoffSeedArgs } from "../../ipc.js";
import type { ProviderId } from "../../transforms.js";
import { t } from "../../i18n/index.js";
import { cn } from "../../lib/utils.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { UsageWindowRow } from "../../ui/Meters.js";
import { Sheet } from "../../ui/Overlay.js";
import { Select } from "../../ui/Select.js";
import { SessionStateIcon } from "../../ui/SessionStateIcon.js";
import { Caps } from "../../ui/Typography.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import { limitOptions, limitSession, limitTargets, switchTargets, type LimitChoice } from "./logic.js";

const PRIMARY: Record<LimitChoice, (name: string) => string> = {
  pause: () => t("sessions.near.pauseResume"),
  switch: (name) => t("sessions.near.switchTo", { name }),
  "continue-elsewhere": (name) => t("sessions.near.continueOn", { name }),
  keep: () => t("sessions.near.keepGoing"),
};

/** Bundle `vR`, sheet 460. Offers only what the backend can do; the rest stays
 *  visible, disabled, with its reason. */
export function NearLimitSheet({ attentionId }: { attentionId: string }) {
  const s = useAS();
  const item = s.attention.find((a) => a.id === attentionId);
  const account = item?.accountId ? s.accountById(item.accountId) : undefined;
  const session = item ? limitSession(item, s.sessions) : null;
  const targets = account ? limitTargets(account, s.accounts, s.now) : [];
  const options = account ? limitOptions(account, session, targets, s.platform) : [];
  const [choice, setChoice] = useState<LimitChoice>(options.find((o) => !o.disabled)?.id ?? "pause");
  const [target, setTarget] = useState(targets[0]?.account.id ?? "");
  const [busy, setBusy] = useState(false);
  if (!item || !account) return null;

  const selected = options.find((o) => o.id === choice);
  // A live switch may only land on an account nobody is using; fall back to the
  // first such one when the remembered pick is not in this choice's list.
  // Codex moves the session instead of switching its login, so any target works.
  const shown = choice === "switch" && account?.tool !== "codex" ? switchTargets(targets) : targets;
  const targetId = shown.some((r) => r.account.id === target) ? target : (shown[0]?.account.id ?? "");
  const targetAccount = s.accountById(targetId);
  const needsTarget = choice === "switch" || choice === "continue-elsewhere";
  const done = () => {
    s.update((vm) => ({ attention: vm.attention.filter((a) => a.id !== item.id) }));
  };

  const go = async () => {
    if (!session || !targetAccount) return;
    if (choice === "switch" && account.tool === "codex") {
      // Move + resume with "continue" in the app's terminal; takeover refuses
      // while codex still runs in the user's own terminal and says so there.
      done();
      s.open({
        kind: "terminal",
        run: {
          kicker: t("sessions.limit.moveTitle"),
          title: `${session.project} → ${TOOL_LABEL[targetAccount.tool]} · ${targetAccount.name}`,
          args: s.act.moveAndContinueArgs!(session.id, targetAccount.id),
        },
      });
    } else if (choice === "switch") {
      setBusy(true);
      try {
        await s.act.rebind!(session.id, targetAccount.id);
        // Same conversation, new login: one message makes it carry on.
        const sent = (await s.act.continueSession?.(session.id)) === true;
        done();
        s.close();
        s.toast({ text: t(sent ? "sessions.sheet.continues" : "sessions.sheet.typeToContinue", { project: session.project, name: targetAccount.name }), tone: "ok" });
      } catch (e) {
        s.toast({
          text: t("sessions.sheet.switchFailed", { project: session.project, name: account.name, error: e instanceof Error ? e.message : String(e) }),
          tone: "alert",
        });
      } finally {
        setBusy(false);
      }
    } else if (choice === "continue-elsewhere") {
      setBusy(true);
      try {
        const b = await s.act.handoffBrief!(session.id, targetAccount.id);
        if (!b.briefPath) throw new Error(t("sessions.sheet.briefNotWritten"));
        done();
        s.open({
          kind: "terminal",
          run: {
            kicker: t("sessions.limit.elsewhereTitle"),
            title: `${session.project} → ${TOOL_LABEL[targetAccount.tool]} · ${targetAccount.name}`,
            args: handoffSeedArgs(targetAccount.tool as ProviderId, targetAccount.name, b.briefPath),
          },
        });
      } catch (e) {
        s.toast({ text: t("sessions.near.briefFailed", { error: e instanceof Error ? e.message : String(e) }), tone: "alert" });
      } finally {
        setBusy(false);
      }
    }
  };

  const actionMissing = (choice === "switch" && (account.tool === "codex" ? !s.act.moveAndContinueArgs : !s.act.rebind)) || (choice === "continue-elsewhere" && !s.act.handoffBrief);

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && s.close()}
      kicker={t("sessions.near.kicker")}
      title={item.title}
      width={460}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => s.close()}>
            {t("sessions.near.later")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!selected || selected.disabled || busy || actionMissing || (needsTarget && !targetAccount)}
            onClick={() => void go()}
          >
            {choice === "switch" && account.tool === "codex" ? t("sessions.near.continueOn", { name: targetAccount?.name ?? "…" }) : PRIMARY[choice](targetAccount?.name ?? "…")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-3 p-3">
          <div className="flex items-center gap-3">
            {session ? (
              <>
                <SessionStateIcon state={session.state} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ac-text">
                  {session.project} · {session.title}
                </span>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate text-[13px] text-ac-muted">{t("sessions.near.noSession")}</span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-ac-soft">
              <AccountDot color={account.color} size={8} /> {TOOL_LABEL[account.tool]} · {account.name}
            </span>
          </div>
          {account.windows.map((w) => (
            <UsageWindowRow key={w.key} window={w} threshold={account.threshold} now={s.now} />
          ))}
          {session?.protectionNote && <p className="text-[11px] text-ac-muted">{session.protectionNote}</p>}
        </Card>
        <div role="radiogroup" aria-label={t("sessions.near.howAria")} className="flex flex-col gap-2">
          <Caps className="mb-1">{t("sessions.near.how")}</Caps>
          {options.map((o) => {
            const on = choice === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={o.disabled}
                onClick={() => setChoice(o.id)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-45",
                  on ? "border-transparent bg-ac-brand-tint shadow-[inset_0_0_0_1px_var(--ac-brand-line)]" : "border-ac-line hover:border-ac-line2",
                )}
              >
                <span
                  className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-ac-brand" : "border-ac-line2")}
                  aria-hidden
                >
                  {on && <span className="size-2 rounded-full bg-ac-brand" />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-ac-text">
                    {o.title} {o.isDefault && <Badge tone="ok">{t("sessions.near.default")}</Badge>}
                  </span>
                  <span className="text-xs text-ac-muted">{o.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        {needsTarget && shown.length > 0 && (
          <Select
            label={choice === "switch" ? t("sessions.near.switchToLabel") : t("sessions.near.continueOnLabel")}
            value={targetId}
            onChange={setTarget}
            options={shown.map((r) => ({
              value: r.account.id,
              label: `${TOOL_LABEL[r.account.tool]} · ${r.account.name}`,
              hint: r.reason,
              dot: <AccountDot color={r.account.color} size={8} />,
              tag: r.rank === 1 ? <Badge tone="info">{t("sessions.near.mostLeft")}</Badge> : undefined,
            }))}
          />
        )}
        <p className="text-[11px] text-ac-faint">{t("sessions.near.pauseNote")}</p>
      </div>
    </Sheet>
  );
}
