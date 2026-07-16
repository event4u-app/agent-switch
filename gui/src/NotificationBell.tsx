import { useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { relativeAge } from "./transforms.js";
import { KIND_META } from "./notif-kind.js";
import type { AppNotification } from "./notifications.js";

/** Header bell + unread badge that opens a flyout listing the recent
 *  notifications (newest first) with a relative timestamp. This is the
 *  guaranteed in-window surface — desktop notifications are the best-effort
 *  layer on top. A plain state-toggled panel (not a Radix portal) so it stays
 *  testable in jsdom. */
export function NotificationBell({
  notifications,
  unread,
  onMarkRead,
  onClear,
}: {
  notifications: AppNotification[];
  unread: number;
  onMarkRead: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle() {
    setOpen((v) => {
      if (!v) onMarkRead(); // opening clears the unread count
      return !v;
    });
  }

  return (
    <div className="relative">
      <Button size="icon" variant="ghost" className="size-7" onClick={toggle} aria-label="Notifications">
        <Bell />
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
            aria-label={`${unread} unread notifications`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {/* Portalled to <body>: the header's `backdrop-blur` creates a containing
       *  block for fixed descendants, which would otherwise trap this drawer
       *  inside the titlebar instead of the window. */}
      {open && createPortal(
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40 animate-in fade-in duration-150" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="Notifications"
            className="fixed inset-y-0 right-0 z-50 flex h-full w-80 flex-col border-l border-border bg-popover shadow-xl animate-in slide-in-from-right-full duration-300 ease-out"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[13px] font-semibold">Notifications</span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  onClick={onClear}
                  disabled={notifications.length === 0}
                  aria-label="Clear notifications"
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="size-6" onClick={() => setOpen(false)} aria-label="Close notifications">
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications yet.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.map((n) => {
                    const meta = KIND_META[n.kind] ?? KIND_META.info;
                    const Icon = meta.Icon;
                    return (
                      <li key={n.id} className="flex gap-2 px-3 py-2">
                        <Icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-medium">{n.title}</span>
                            <span className="shrink-0 text-[11px] text-muted-foreground" title={new Date(n.ts).toLocaleString()}>
                              {relativeAge(n.ts)}
                            </span>
                          </div>
                          {n.message && <div className="text-xs text-muted-foreground">{n.message}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
