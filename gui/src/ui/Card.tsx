import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/utils.js";

/** Bundle `ae`. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[10px] border border-ac-line bg-ac-panel", className)} {...props} />;
}

/** Dashed empty card, bundle `a0`. */
export function EmptyState({ title, detail, action }: { title: ReactNode; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[10px] border border-dashed border-ac-line2 px-4 py-5">
      <p className="text-[13px] font-medium text-ac-soft">{title}</p>
      {detail && <p className="text-xs text-ac-muted">{detail}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Two-column term/value list, bundle `Vi`. Rows are [term, value]. */
export function DefinitionList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-2 text-[13px]">
      {rows.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="text-ac-muted">{term}</dt>
          <dd className="min-w-0 break-words text-ac-text">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
