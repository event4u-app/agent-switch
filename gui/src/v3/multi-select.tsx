/**
 * A multi-select dropdown for a filter bar (owner, 2026-11-24): the trigger looks
 * like the filter input beside it (h-8, outlined, inset fill); the list ticks each
 * option with the one checkbox of the kit and stays open while you tick. Nothing
 * ticked = every option, said as "All …" on the trigger.
 */
import type { ReactNode } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";
import { usePortalContainer } from "../ui/AcRoot.js";
import { CheckMark } from "./kit.js";

export interface MultiOption<T extends string> {
  value: T;
  label: string;
  /** A count or other quiet fact on the right. */
  hint?: ReactNode;
}

/** The trigger's words: "All tools", one name, or the names joined. Pure. */
export function multiLabel<T extends string>(options: readonly MultiOption<T>[], picked: ReadonlySet<T>, all: string): string {
  const on = options.filter((o) => picked.has(o.value));
  return on.length === 0 || on.length === options.length ? all : on.map((o) => o.label).join(", ");
}

export function MultiSelect<T extends string>({
  label,
  all,
  options,
  picked,
  onChange,
  width = 168,
}: {
  /** The field's name, for screen readers and the trigger's tooltip ("Tool"). */
  label: string;
  /** What nothing ticked means, shown on the trigger ("All tools"). */
  all: string;
  options: readonly MultiOption<T>[];
  picked: ReadonlySet<T>;
  onChange: (next: ReadonlySet<T>) => void;
  width?: number;
}) {
  const container = usePortalContainer();
  const text = multiLabel(options, picked, all);
  const toggle = (v: T) => {
    const next = new Set(picked);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // Every option ticked is the same as none: back to "All".
    onChange(next.size === options.length ? new Set() : next);
  };
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger
        aria-label={`${label}: ${text}`}
        title={`${label}: ${text}`}
        style={{ width }}
        className={cn(
          "group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-ac-line2 bg-ac-bg px-2.5 text-left text-xs text-ac-text outline-none",
          "hover:border-ac-faint focus-visible:border-ac-brand-line data-[state=open]:border-ac-brand-line",
        )}
      >
        <span className="shrink-0 text-ac-muted">{label}</span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ac-muted transition-transform group-data-[state=open]:rotate-180" />
      </Dropdown.Trigger>
      <Dropdown.Portal container={container}>
        <Dropdown.Content
          align="start"
          sideOffset={4}
          style={{ minWidth: width }}
          className="z-50 rounded-xl border border-ac-line2 bg-ac-panel p-1 shadow-[var(--ac-shadow)]"
        >
          <Dropdown.Item
            onSelect={(e) => (e.preventDefault(), onChange(new Set()))}
            className="flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-xs text-ac-text outline-none data-[highlighted]:bg-ac-raise"
          >
            <CheckMark checked={picked.size === 0} size={14} />
            <span className="flex-1">{all}</span>
          </Dropdown.Item>
          <Dropdown.Separator className="mx-1 my-1 h-px bg-ac-line" />
          {options.map((o) => (
            <Dropdown.CheckboxItem
              key={o.value}
              checked={picked.has(o.value)}
              onSelect={(e) => (e.preventDefault(), toggle(o.value))}
              className="flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-xs text-ac-text outline-none data-[highlighted]:bg-ac-raise"
            >
              <CheckMark checked={picked.has(o.value)} size={14} />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint != null && <span className="shrink-0 font-ac-mono text-[11px] text-ac-muted">{o.hint}</span>}
            </Dropdown.CheckboxItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
