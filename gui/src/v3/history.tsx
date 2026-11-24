/**
 * History (owner, 2026-11-24, as v2's Activity): what Agent Switch did — starts,
 * switches, sign-ins, refreshes, updates — newest first, from the CLI's own
 * activity log. A full-height sheet on the right like Needs you, filtered by
 * the same four kinds as v2. A failed action says so in red.
 */
import { useState } from "react";
import { ACTIVITY_GROUP, ACTIVITY_ICON, filterActivity, type ActivityFilter } from "../redesign/screens/activity.js";
import { Segmented } from "../ui/Segmented.js";
import type { ActivityEvent } from "../vm/types.js";
import { ago } from "./kit.js";

export { ACTIVITY_GROUP };

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sessions", label: "Sessions" },
  { value: "accounts", label: "Accounts" },
  { value: "system", label: "System" },
];

export function HistorySheet({ events, nowMs }: { events: readonly ActivityEvent[]; nowMs: number }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const rows = filterActivity(events, filter);
  return (
    <div role="dialog" aria-label="History" className="flex h-full w-[420px] flex-col border-l border-ac-line2 bg-ac-panel" style={{ boxShadow: "var(--ac-shadow)" }}>
      <div className="shrink-0 space-y-2 p-2 pb-1.5">
        <div className="flex h-8 items-center px-2">
          <span className="ac-caps">History</span>
          <span className="ml-auto text-[11px] text-ac-muted">{events.length} events</span>
        </div>
        <Segmented size="sm" fill label="Show" value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows.map((e) => (
          <li key={e.id} data-history-row="" className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-md px-2 py-1.5 hover:bg-ac-raise">
            <span className="flex h-[18px] items-center">{ACTIVITY_ICON[e.kind]}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-[12.5px] leading-[18px] text-ac-text">
                <span className="truncate">{e.text}</span>
                {e.ok === false && <span className="shrink-0 text-[11px] font-medium text-ac-alert-text">failed</span>}
              </span>
              {e.detail && <span className="block truncate text-[11px] text-ac-muted">{e.detail}</span>}
            </span>
            <span className="whitespace-nowrap text-[11px] leading-[18px] text-ac-faint">{ago(nowMs - e.at)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-2 py-6 text-center text-[12px] text-ac-muted">{filter === "all" ? "Nothing recorded yet." : "Nothing of this kind yet."}</li>}
      </ol>
    </div>
  );
}
