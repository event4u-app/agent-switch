import { useState } from "react";
import { handoffSeedArgs } from "../../ipc.js";
import type { ProviderId } from "../../transforms.js";
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
import { limitOptions, limitSession, limitTargets, type LimitChoice } from "./logic.js";

const PRIMARY: Record<LimitChoice, (name: string) => string> = {
  pause: () => "Pause & resume",
  switch: (name) => `Switch to ${name}`,
  "continue-elsewhere": (name) => `Continue on ${name}`,
  keep: () => "Keep going",
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
  const targetAccount = s.accountById(target);
  const needsTarget = choice === "switch" || choice === "continue-elsewhere";
  const done = () => {
    s.update((vm) => ({ attention: vm.attention.filter((a) => a.id !== item.id) }));
  };

  const go = async () => {
    if (!session || !targetAccount) return;
    if (choice === "switch") {
      setBusy(true);
      try {
        await s.act.rebind!(session.id, targetAccount.id);
        done();
        s.close();
        s.toast({ text: `${session.project} now runs on ${targetAccount.name}.`, tone: "ok" });
      } catch (e) {
        s.toast({ text: `Switch failed — ${session.project} stays on ${account.name}. ${e instanceof Error ? e.message : String(e)}`, tone: "alert" });
      } finally {
        setBusy(false);
      }
    } else if (choice === "continue-elsewhere") {
      setBusy(true);
      try {
        const b = await s.act.handoffBrief!(session.id, targetAccount.id);
        if (!b.briefPath) throw new Error("the brief file was not written");
        done();
        s.open({
          kind: "terminal",
          run: {
            kicker: "Continue on another account",
            title: `${session.project} → ${TOOL_LABEL[targetAccount.tool]} · ${targetAccount.name}`,
            args: handoffSeedArgs(targetAccount.tool as ProviderId, targetAccount.name, b.briefPath),
          },
        });
      } catch (e) {
        s.toast({ text: `Couldn't prepare the brief: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" });
      } finally {
        setBusy(false);
      }
    }
  };

  const actionMissing = (choice === "switch" && !s.act.rebind) || (choice === "continue-elsewhere" && !s.act.handoffBrief);

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && s.close()}
      kicker="Near limit · you decide"
      title={item.title}
      width={460}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => s.close()}>
            Later
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!selected || selected.disabled || busy || actionMissing || (needsTarget && !targetAccount)}
            onClick={() => void go()}
          >
            {PRIMARY[choice](targetAccount?.name ?? "…")}
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
              <span className="min-w-0 flex-1 truncate text-[13px] text-ac-muted">No running session on this account</span>
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
        <div role="radiogroup" aria-label="How to go on" className="flex flex-col gap-2">
          <Caps className="mb-1">How do you want to go on?</Caps>
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
                    {o.title} {o.isDefault && <Badge tone="ok">Default</Badge>}
                  </span>
                  <span className="text-xs text-ac-muted">{o.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        {needsTarget && targets.length > 0 && (
          <Select
            label={choice === "switch" ? "Switch to" : "Continue on"}
            value={target}
            onChange={setTarget}
            options={targets.map((r) => ({
              value: r.account.id,
              label: `${TOOL_LABEL[r.account.tool]} · ${r.account.name}`,
              hint: r.reason,
              dot: <AccountDot color={r.account.color} size={8} />,
              tag: r.rank === 1 ? <Badge tone="info">Most left</Badge> : undefined,
            }))}
          />
        )}
        <p className="text-[11px] text-ac-faint">"Pause requested" turns into "Paused" only when the session has really stopped.</p>
      </div>
    </Sheet>
  );
}
