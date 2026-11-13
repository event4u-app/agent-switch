import { X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconButton } from "./Button.js";
import { CopyButton } from "./CopyButton.js";
import { t } from "../i18n/index.js";

export interface ToastItem {
  id: number;
  text: string;
  tone?: "info" | "ok" | "warn" | "alert";
  action?: { label: string; run: () => void };
}

const DOT = { info: "bg-ac-info", ok: "bg-ac-ok", warn: "bg-ac-warn", alert: "bg-ac-alert" } as const;

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-ac-line2 bg-ac-panel py-2 pl-3 pr-1.5 shadow-lg">
      <span className={cn("size-2 shrink-0 rounded-full", DOT[item.tone ?? "info"])} aria-hidden />
      <span className="min-w-0 flex-1 text-xs text-ac-text">{item.text}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action!.run();
            onDismiss(item.id);
          }}
          className="h-7 shrink-0 rounded-md px-2 text-xs font-medium text-ac-brand-text hover:bg-ac-raise"
        >
          {item.action.label}
        </button>
      )}
      <CopyButton text={item.text} label={t("ui.toast.copy")} className="size-7 [&_svg]:size-3.5" />
      <IconButton label={t("common.dismiss")} className="size-7" onClick={() => onDismiss(item.id)}>
        <X />
      </IconButton>
    </div>
  );
}

/** Bottom-right toasts with an optional action (e.g. Undo). Bundle `kR`. The
 *  live regions stay mounted while empty — a region that appears together with
 *  its first message is not announced. Alert-tone toasts go to role="alert". */
export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const alerts = toasts.filter((t) => t.tone === "alert");
  const rest = toasts.filter((t) => t.tone !== "alert");
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2">
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {rest.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={onDismiss} />
        ))}
      </div>
      <div role="alert" className="flex flex-col gap-2">
        {alerts.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}
