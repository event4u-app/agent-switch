import { AlertCircle, AlertTriangle, Check, Info, type Bell } from "lucide-react";
import type { NotificationKind } from "./notifications.js";

/** Icon + colour per notification kind, shared by the bell flyout and the
 *  in-window toasts so both render an event identically. */
export const KIND_META: Record<NotificationKind, { Icon: typeof Bell; className: string }> = {
  success: { Icon: Check, className: "text-[hsl(var(--success))]" },
  error: { Icon: AlertCircle, className: "text-destructive" },
  warning: { Icon: AlertTriangle, className: "text-primary" },
  info: { Icon: Info, className: "text-muted-foreground" },
};
