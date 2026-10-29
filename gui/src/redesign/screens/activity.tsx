import { useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Download,
  Layers,
  LogIn,
  Pause,
  Play,
  Power,
  RefreshCw,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Signpost,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/utils.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Card, EmptyState } from "../../ui/Card.js";
import { Segmented } from "../../ui/Segmented.js";
import { PageHeader } from "../../ui/Typography.js";
import { ago } from "../../ui/format.js";
import { useAS } from "../../vm/store.js";
import type { ActivityEvent, ActivityKind } from "../../vm/types.js";
import { rowClick } from "./rows.js";

export type ActivityFilter = "all" | "sessions" | "accounts" | "system";

/** Design `YP`, extended by the kinds the CLI's own log reports. */
export const ACTIVITY_ICON: Record<ActivityKind, ReactNode> = {
  start: <Play className="size-3.5 text-ac-ok" />,
  rule: <Signpost className="size-3.5 text-ac-info" />,
  protection: <Pause className="size-3.5 text-ac-soft" />,
  limit: <TriangleAlert className="size-3.5 text-ac-warn" />,
  login: <LogIn className="size-3.5 text-ac-info" />,
  refresh: <RefreshCw className="size-3.5 text-ac-muted" />,
  reset: <RotateCcw className="size-3.5 text-ac-ok" />,
  repair: <Wrench className="size-3.5 text-ac-soft" />,
  autostart: <Power className="size-3.5 text-ac-muted" />,
  update: <Download className="size-3.5 text-ac-info" />,
  switch: <ArrowLeftRight className="size-3.5 text-ac-info" />,
  rebind: <Repeat className="size-3.5 text-ac-info" />,
  guard: <ShieldCheck className="size-3.5 text-ac-soft" />,
  pool: <Layers className="size-3.5 text-ac-muted" />,
  remove: <Trash2 className="size-3.5 text-ac-muted" />,
};

/** Design `XP`, extended the same way. */
export const ACTIVITY_GROUP: Record<ActivityKind, Exclude<ActivityFilter, "all">> = {
  start: "sessions",
  rule: "sessions",
  protection: "sessions",
  rebind: "sessions",
  limit: "accounts",
  login: "accounts",
  refresh: "accounts",
  reset: "accounts",
  switch: "accounts",
  pool: "accounts",
  remove: "accounts",
  repair: "system",
  autostart: "system",
  update: "system",
  guard: "system",
};

export function filterActivity(events: readonly ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  return events.filter((e) => filter === "all" || ACTIVITY_GROUP[e.kind] === filter);
}

/** Bundle `QP`. */
export function Activity() {
  const s = useAS();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const rows = filterActivity(s.activity, filter);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="What happened?" sub="Starts, bindings, pauses, sign-ins and repairs — with the reason for each." />
      <Segmented
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "sessions", label: "Sessions" },
          { value: "accounts", label: "Accounts" },
          { value: "system", label: "System" },
        ]}
      />
      {rows.length ? (
        <Card className="p-1">
          <ol className="flex flex-col divide-y divide-ac-line">
            {rows.map((o) => {
              const a = o.accountId ? s.accountById(o.accountId) : undefined;
              return (
                <li
                  key={o.id}
                  {...(a ? rowClick(() => s.open({ kind: "account", id: a.id })) : {})}
                  className={cn(
                    "grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-3 py-2.5",
                    a && "cursor-pointer transition-colors hover:bg-ac-raise",
                  )}
                >
                  <span className="flex">{ACTIVITY_ICON[o.kind]}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[13px] text-ac-text">
                      {a ? <AccountDot color={a.color} size={8} /> : <span className="w-2 shrink-0" aria-hidden />}
                      <span className="truncate">{o.text}</span>
                      {o.ok === false && <span className="shrink-0 text-[11px] font-medium text-ac-alert-text">Failed</span>}
                    </span>
                    {o.detail && <span className="mt-0.5 block truncate text-[11px] text-ac-muted">{o.detail}</span>}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-ac-faint">{ago(o.at, s.now)}</span>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : (
        <EmptyState
          title={filter === "all" ? "Nothing recorded yet." : "Nothing of this kind recorded yet."}
          detail="Switches, sign-ins, resets, pools and updates show up here with the reason for each."
        />
      )}
    </div>
  );
}
