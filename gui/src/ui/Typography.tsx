import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils.js";

/** Section label (`.ac-caps`), bundle `st`. */
export function Caps({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ac-caps", className)} {...props} />;
}

/** Bundle `n0`. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded border border-ac-line2 bg-ac-raise px-1.5 py-px font-ac-mono text-[10px] leading-4 text-ac-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Display-font page title (always a question) + sub + actions, bundle `Vn`. */
export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] uppercase leading-none tracking-[0.02em] text-ac-text">{title}</h1>
        {sub && <p className="mt-2 text-[13px] text-ac-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Caps title + mono count + actions, bundle `Mt`. */
export function SectionHeader({ title, count, actions }: { title: ReactNode; count?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Caps>{title}</Caps>
        {count != null && <span className="font-ac-mono text-[11px] text-ac-faint">{count}</span>}
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
