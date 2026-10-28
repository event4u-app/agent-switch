import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, Wrench } from "lucide-react";
import * as ipc from "../../ipc.js";
import { cn } from "../../lib/utils.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { PageHeader, SectionHeader } from "../../ui/Typography.js";
import { updateCount } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Check, Readiness } from "../../vm/types.js";
import { rowClick } from "./rows.js";

/** Design `qP`. */
export const READINESS: Record<Readiness, [string, string, "ok" | "warn" | "alert" | "neutral"]> = {
  starting: ["Starting", "Reading accounts and sessions …", "neutral"],
  ready: ["Ready", "Runs in the menu bar. Usage is watched in the background.", "ok"],
  degraded: ["Degraded", "Works, but something needs a look.", "warn"],
  "needs-action": ["Needs action", "Something blocks Agent Switch. See below.", "alert"],
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
  if (desired === "disabled") return "Off — you switched it off. Updates keep it off.";
  if (actual === "enabled") return "On — registered with the system and checked.";
  if (actual == null) return "Couldn't read the system state.";
  if (desired === "enabled") return `Couldn't turn it on${reason ? ` (${reason})` : ""}.`;
  // Never decided (or the preference is unreadable) and the OS says off.
  return "Off — not registered with the system yet.";
}

/** "Try again" only where the user wants it on and the OS does not have it. */
export function autostartRetry(desired: AutostartDesired, actual: AutostartActual): boolean {
  return desired === "enabled" && actual !== "enabled";
}

/** Bundle `JP`. */
export function Health() {
  const s = useAS();
  const [title, line, tone] = READINESS[s.readiness];
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
  const retry = autostartRetry(pref.state, actual);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Is everything working?" sub="Background readiness and checks with repairs." />
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="flex items-start gap-3 p-4">
          <span
            className={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              tone === "ok" ? "bg-ac-ok" : tone === "warn" ? "bg-ac-warn" : tone === "alert" ? "bg-ac-alert" : "bg-ac-faint",
            )}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ac-text">{title}</p>
            <p className="mt-1 text-xs text-ac-muted">{line}</p>
          </div>
        </Card>
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ac-text">Start at login</p>
            <p className="mt-1 text-xs text-ac-muted">{autostartText(pref.state, actual, pref.reason)}</p>
          </div>
          {retry && s.act.setAutostart ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                s.act
                  .setAutostart?.(true)
                  .catch((e) => s.toast({ text: `Couldn't turn it on: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" }))
                  .finally(readPref);
              }}
            >
              Try again
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => s.go("settings", "general")}>
              Settings
            </Button>
          )}
        </Card>
      </div>
      <section className="flex flex-col gap-2">
        <SectionHeader
          title="Checks"
          count={s.checks.length}
          actions={
            s.checks.length ? (
              problems.length ? (
                <Badge tone="warn">{problems.length} to check</Badge>
              ) : (
                <Badge tone="ok">All pass</Badge>
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
                      <Wrench /> Fix
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState
            title={s.checksCheckedAt == null ? "The checks could not be run." : "No checks reported."}
            detail={s.checksCheckedAt == null ? "`agent-switch doctor` did not answer. Check again after the CLI is reachable." : undefined}
            action={
              <Button size="sm" onClick={() => void s.reload()} disabled={s.loading}>
                Check again
              </Button>
            }
          />
        )}
      </section>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ac-text">Tools</p>
          <p className="mt-0.5 text-xs text-ac-muted">
            {updates
              ? `${updates} updates available — agent-config, rtk and the agent CLIs live under Tools.`
              : "agent-config, rtk and the agent CLIs are up to date."}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            s.go("tools");
            s.setToolsTab("tools");
          }}
        >
          Open Tools
        </Button>
      </Card>
    </div>
  );
}
