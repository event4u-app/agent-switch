import { X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconButton } from "./Button.js";

export interface ToastItem {
  id: number;
  text: string;
  tone?: "info" | "ok" | "warn" | "alert";
  action?: { label: string; run: () => void };
}

const DOT = { info: "bg-ac-info", ok: "bg-ac-ok", warn: "bg-ac-warn", alert: "bg-ac-alert" } as const;

/** Bottom-right toasts with an optional action (e.g. Undo). Bundle `kR`. */
export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 rounded-lg border border-ac-line2 bg-ac-panel py-2 pl-3 pr-1.5 shadow-lg"
        >
          <span className={cn("size-2 shrink-0 rounded-full", DOT[t.tone ?? "info"])} aria-hidden />
          <span className="min-w-0 flex-1 text-xs text-ac-text">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                onDismiss(t.id);
              }}
              className="h-7 shrink-0 rounded-md px-2 text-xs font-medium text-ac-brand-text hover:bg-ac-raise"
            >
              {t.action.label}
            </button>
          )}
          <IconButton label="Dismiss" className="size-7" onClick={() => onDismiss(t.id)}>
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
