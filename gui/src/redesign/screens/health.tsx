import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, Wrench } from "lucide-react";
import * as ipc from "../../ipc.js";
import { t, tp, type TKey } from "../../i18n/index.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { PageHeader, SectionHeader } from "../../ui/Typography.js";
import { updateCount } from "../../vm/rules.js";
import { forceDoctorOnNextLoad } from "../../vm/slow-cache.js";
import { useAS } from "../../vm/store.js";
import type { Check, Readiness } from "../../vm/types.js";
import { rowClick } from "./rows.js";

/** Design `qP`. */
export const READINESS: Record<Readiness, [TKey, TKey, "ok" | "warn" | "alert" | "neutral"]> = {
  starting: ["tools.health.startingTitle", "tools.health.startingLine", "neutral"],
  ready: ["tools.health.readyTitle", "tools.health.readyLine", "ok"],
  degraded: ["tools.health.degradedTitle", "tools.health.degradedLine", "warn"],
  "needs-action": ["tools.health.needsActionTitle", "tools.health.needsActionLine", "alert"],
};

/** Design `ZP`; `info` (a neutral `doctor` note) gets its own glyph. */
export const CHECK_ICON: Record<Check["state"], ReactNode> = {
  ok: <CircleCheck className="size-4 text-ac-ok" />,
  warn: <TriangleAlert className="size-4 text-ac-warn" />,
  fail: <CircleX className="size-4 text-ac-alert" />,
  info: <Info className="size-4 text-ac-muted" />,
};

/** Checks that need the user: warn and fail. `info` is a note, not a problem. */
export function checksToLook(checks: readonly Check[]): Check[] {
  return checks.filter((c) => c.state === "warn" || c.state === "fail");
}

/** Problems first (fail before warn), then notes, then passes. */
export function orderChecks(checks: readonly Check[]): Check[] {
  const rank: Record<Check["state"], number> = { fail: 0, warn: 1, info: 2, ok: 3 };
  return [...checks].sort((a, b) => rank[a.state] - rank[b.state]);
}

export type AutostartDesired = "unset" | "enabled" | "disabled" | null;
export type AutostartActual = "enabled" | "disabled" | null;

/** The Start-at-login line (design `JP`). `desired` is the stored preference
 *  (null = unreadable), `actual` what the OS reports (null = unreadable). */
export function autostartText(desired: AutostartDesired, actual: AutostartActual, reason: string | null = null): string {
  if (desired === "disabled") return t("tools.health.autoOffByYou");
  if (actual === "enabled") return t("tools.health.autoOn");
  if (actual == null) return t("tools.health.autoUnreadable");
  // Wanted on, the OS has it off: a failed attempt leaves a reason; without one
  // the login item was switched off outside the app (System Settings).
  if (desired === "enabled") return reason ? t("tools.health.autoFailed", { reason }) : t("tools.health.autoOffOutside");
  // Never decided (or the preference is unreadable) and the OS says off.
  return t("tools.health.autoNotRegistered");
}

/** What the retry action reads (the action id stays English, see autostartAction). */
const AUTOSTART_ACTION: Record<"Turn on" | "Try again", TKey> = { "Turn on": "tools.health.turnOn", "Try again": "tools.health.tryAgain" };

/** "Try again" only where the user wants it on and the OS does not have it. */
export function autostartRetry(desired: AutostartDesired, actual: AutostartActual): boolean {
  return desired === "enabled" && actual !== "enabled";
}

/** The button for that state: "Turn on" after an outside switch-off, "Try
 *  again" after a failed attempt, none otherwise. */
export function autostartAction(desired: AutostartDesired, actual: AutostartActual, reason: string | null): "Turn on" | "Try again" | null {
  if (!autostartRetry(desired, actual) || actual == null) return null;
  return reason ? "Try again" : "Turn on";
}

/** Bundle `JP`. */
export function Health() {
  const s = useAS();
  const [titleKey, lineKey, tone] = READINESS[s.readiness];
  const problems = checksToLook(s.checks);
  const updates = updateCount(s.tools);
  const [pref, setPref] = useState<{ state: AutostartDesired; reason: string | null }>({ state: null, reason: null });

  const readPref = useCallback(() => {
    ipc
      .getAutostartPreference()
      .then((p) => setPref({ state: p.state, reason: p.degradedReason }))
      .catch(() => setPref({ state: null, reason: null }));
  }, []);
  useEffect(readPref, [readPref, s.autostart.actual]);

  const actual = s.autostart.actual;
  const retry = autostartAction(pref.state, actual, pref.reason);

  // Opening Health re-runs `doctor` (cached between other reloads, slow-cache.ts).
  const { reload } = s;
  useEffect(() => {
    forceDoctorOnNextLoad();
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("tools.health.title")} sub={t("tools.health.sub")} />
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="flex items-start gap-3 p-4">
          <span
            className={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              tone === "ok" ? "bg-ac-ok" : tone === "warn" ? "bg-ac-warn" : tone === "alert" ? "bg-ac-alert" : "bg-ac-faint",
            )}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ac-text">{t(titleKey)}</p>
            <p className="mt-1 text-xs text-ac-muted">{t(lineKey)}</p>
          </div>
        </Card>
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ac-text">{t("tools.health.startAtLogin")}</p>
            <p className="mt-1 text-xs text-ac-muted">{autostartText(pref.state, actual, pref.reason)}</p>
          </div>
          {retry && s.act.setAutostart ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                s.act
                  .setAutostart?.(true)
                  .catch((e) => s.toast({ text: t("tools.health.turnOnFailed", { error: e instanceof Error ? e.message : String(e) }), tone: "alert" }))
                  .finally(readPref);
              }}
            >
              {t(AUTOSTART_ACTION[retry])}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => s.go("settings", "general")}>
              {t("tools.health.settings")}
            </Button>
          )}
        </Card>
      </div>
      <section className="flex flex-col gap-2">
        <SectionHeader
          title={t("tools.health.checks")}
          count={s.checks.length}
          actions={
            s.checks.length ? (
              problems.length ? (
                <Badge tone="warn">{t("tools.health.toCheck", { count: problems.length })}</Badge>
              ) : (
                <Badge tone="ok">{t("tools.health.allPass")}</Badge>
              )
            ) : undefined
          }
        />
        {s.checks.length ? (
          <Card className="p-1">
            <ul className="flex flex-col divide-y divide-ac-line">
              {orderChecks(s.checks).map((c) => (
                <li
                  key={c.id}
                  {...(c.fix ? rowClick(() => s.open({ kind: "fix", checkId: c.id })) : {})}
                  className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5", c.fix && "cursor-pointer transition-colors hover:bg-ac-raise")}
                >
                  <span className="flex">{CHECK_ICON[c.state]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ac-text">{c.title}</span>
                    {c.detail && <span className="mt-0.5 block text-[11px] text-ac-muted">{c.detail}</span>}
                  </span>
                  {c.fix && (
                    <Button size="sm" onClick={() => s.open({ kind: "fix", checkId: c.id })}>
                      <Wrench /> {t("tools.health.fix")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            title={t(s.checksCheckedAt == null ? "tools.health.notRun" : "tools.health.noChecks")}
            detail={s.checksCheckedAt == null ? t("tools.health.notRunDetail") : undefined}
            action={
              <Button
                size="sm"
                onClick={() => {
                  forceDoctorOnNextLoad();
                  void s.reload();
                }}
                disabled={s.loading}
              >
                {t("tools.health.checkAgain")}
              </Button>
            }
          />
        )}
      </section>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ac-text">{t("tools.health.tools")}</p>
          <p className="mt-0.5 text-xs text-ac-muted">
            {updates ? tp("tools.health.updates", updates) : t("tools.health.upToDate")}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            s.go("tools");
            s.setToolsTab("tools");
          }}
        >
          {t("tools.health.openTools")}
        </Button>
      </Card>
    </div>
  );
}
