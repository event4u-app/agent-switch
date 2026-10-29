import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/utils.js";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  /** Why a disabled option is unavailable (tooltip + accessible description). */
  why?: string;
}

/** Radiogroup with arrow-key roving over enabled options. Bundle `_e`. */
export function Segmented<V extends string>({
  label,
  value,
  onChange,
  options,
  fill,
  size = "md",
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: SegmentedOption<V>[];
  fill?: boolean;
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  // Exactly one stop in the tab order: the selected option, or — when the value
  // matches none — the first enabled one.
  const tabStop = options.some((o) => o.value === value) ? options.findIndex((o) => o.value === value) : (enabled[0] ?? 0);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || !enabled.length) return;
    e.preventDefault();
    const pos = enabled.indexOf(index);
    const next = enabled[(pos + step + enabled.length) % enabled.length];
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-0.5 rounded-lg border border-ac-line bg-ac-bg p-[3px]",
        size === "sm" ? "h-8" : "h-9",
        fill && "flex w-full",
      )}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        const whyId = o.disabled && o.why ? `${uid}-why-${i}` : undefined;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={o.disabled || undefined}
            tabIndex={i === tabStop ? 0 : -1}
            title={o.disabled ? o.why : undefined}
            aria-describedby={whyId}
            onClick={() => !o.disabled && onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex h-full items-center justify-center whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors",
              fill && "flex-1",
              selected
                ? "bg-ac-brand-tint text-ac-brand-text shadow-[inset_0_0_0_1px_var(--ac-brand-line)]"
                : o.disabled
                  ? "cursor-not-allowed text-ac-faint"
                  : "text-ac-muted hover:bg-ac-raise hover:text-ac-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
      {/* Disabled reasons, referenced by aria-describedby (outside the buttons,
          so they describe without becoming part of the option's name). */}
      {options.map((o, i) =>
        o.disabled && o.why ? (
          <span key={`why-${o.value}`} id={`${uid}-why-${i}`} className="sr-only">
            {o.why}
          </span>
        ) : null,
      )}
    </div>
  );
}
