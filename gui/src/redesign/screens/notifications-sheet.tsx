import { Settings2 } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { getDevMode } from "../../settings-store.js";
import { Button } from "../../ui/Button.js";
import { Sheet } from "../../ui/Overlay.js";
import { Caps } from "../../ui/Typography.js";
import { ago } from "../../ui/format.js";
import { useAS } from "../../vm/store.js";
import type { Notice } from "../../vm/types.js";

const DOT: Record<Notice["tone"], string> = { info: "bg-ac-info", ok: "bg-ac-ok", warn: "bg-ac-warn", alert: "bg-ac-alert" };

/** Today = the last 3 hours, as in the design. */
export const TODAY_MS = 3 * 3_600_000;

export function splitNotices(notices: readonly Notice[], now: number): { today: Notice[]; earlier: Notice[] } {
  return {
    today: notices.filter((n) => now - n.at < TODAY_MS),
    earlier: notices.filter((n) => now - n.at >= TODAY_MS),
  };
}

/** Bundle `PP` (sheet 420), fed by `notifications --json`. */
export function NotificationsSheet() {
  const s = useAS();
  const { today, earlier } = splitNotices(s.notices, s.now);
  const unread = s.notices.filter((n) => n.unread).length;
  const devMode = getDevMode();

  const group = (title: string, items: Notice[]) =>
    items.length > 0 && (
      <section className="flex flex-col gap-1">
        <Caps className="mb-1">{title}</Caps>
        {items.map((n) => (
          <div key={n.id} className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-ac-raise">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[n.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={cn("text-[13px]", n.unread ? "font-medium text-ac-text" : "text-ac-soft")}>{n.title}</p>
              {n.detail && <p className="mt-0.5 text-xs text-ac-muted">{n.detail}</p>}
            </div>
            <span className="shrink-0 text-[11px] text-ac-faint" title={new Date(n.at).toLocaleString("en-GB")}>
              {ago(n.at, s.now)}
            </span>
            {n.unread && <span className="sr-only">unread</span>}
          </div>
        ))}
      </section>
    );

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && s.close()}
      kicker="Notifications"
      title={`${unread} unread`}
      width={420}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => s.go("settings", "notifications")}>
            <Settings2 /> Notification settings
          </Button>
          <span className="flex-1" />
          {devMode && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                s.update((vm) => ({
                  notices: [
                    ...Array.from({ length: 25 }, (_, i) => ({
                      id: `t${vm.now}-${i}`,
                      title: `Test notification ${i + 1}`,
                      detail: "Generated in developer mode.",
                      at: vm.now - i * 60_000,
                      unread: true,
                      tone: (["info", "ok", "warn", "alert"] as const)[i % 4],
                    })),
                    ...vm.notices,
                  ],
                }))
              }
            >
              + 25 test
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!s.notices.length || !s.act.clearNotifications}
            onClick={() =>
              s.open({
                kind: "confirm",
                title: "Clear all notifications?",
                // `notifications clear` empties the log; the action also removes
                // the desktop notifications this app delivered (the daemon's own
                // OS notifications belong to another process and stay).
                body: "Empties this list and removes the desktop notifications Agent Switch showed.",
                confirm: "Clear all",
                onConfirm: () => {
                  s.update({ notices: [] });
                  s.act.clearNotifications?.().catch((e) => s.toast({ text: e instanceof Error ? e.message : String(e), tone: "alert" }));
                },
              })
            }
          >
            Clear all
          </Button>
          <Button size="sm" onClick={s.markNoticesRead} disabled={!unread}>
            Mark all read
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {s.notices.length ? (
          <>
            {group("Today", today)}
            {group("Earlier", earlier)}
          </>
        ) : (
          <p className="py-8 text-center text-xs text-ac-muted">No notifications. Alerts show up here and, if you allow it, as desktop notifications.</p>
        )}
      </div>
    </Sheet>
  );
}
