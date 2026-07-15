import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KIND_META } from "./notif-kind.js";
import type { AppNotification } from "./notifications.js";

/** Stacked, transient in-window toasts. This is the active fallback shown when a
 *  desktop notification could not be delivered (permission denied / unavailable)
 *  — the bell flyout keeps the full history regardless. Auto-dismissal is owned
 *  by the caller (it schedules `onDismiss`); this component only renders + wires
 *  the manual close, so it stays a pure, testable view. */
export function Toaster({ toasts, onDismiss }: { toasts: AppNotification[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[60] flex w-72 flex-col gap-2" role="region" aria-label="Notifications">
      {toasts.map((t) => {
        const meta = KIND_META[t.kind] ?? KIND_META.info;
        const Icon = meta.Icon;
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex gap-2 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t.title}</div>
              {t.message && <div className="text-xs text-muted-foreground">{t.message}</div>}
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
