import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { Card } from "./Card.js";
import { Caps } from "./Typography.js";

/** Title + detail left, control right (stacked: control below). Bundle `Q`. */
export function SettingRow({
  title,
  detail,
  children,
  stacked,
  tone,
}: {
  title: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
  tone?: "danger";
}) {
  return (
    <div
      className={cn(
        "flex gap-x-6 gap-y-3 px-4 py-3.5",
        stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className={cn("min-w-0 [text-wrap:pretty]", !stacked && "sm:flex-1")}>
        <p className={cn("text-[13px]", tone === "danger" ? "text-ac-alert-text" : "text-ac-text")}>{title}</p>
        {detail && <div className="mt-0.5 text-xs text-ac-muted">{detail}</div>}
      </div>
      {children != null && (
        <div className={cn("flex min-w-0 items-center gap-2", stacked ? "w-full flex-wrap" : "shrink-0")}>{children}</div>
      )}
    </div>
  );
}

/** Caps title + card of divided SettingRows. Bundle `xe`. */
export function SettingGroup({ title, detail, children }: { title?: ReactNode; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {title && <Caps className="px-1">{title}</Caps>}
      {detail && <p className="-mt-1 px-1 text-xs text-ac-muted">{detail}</p>}
      <Card className="overflow-visible">
        <div className="flex flex-col divide-y divide-ac-line">{children}</div>
      </Card>
    </div>
  );
}
