import { cn } from "../lib/utils.js";

/** role=switch toggle, brand when on. Bundle `re`. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-45",
        checked ? "border-ac-brand-line bg-ac-brand-tint" : "border-ac-line2 bg-ac-raise",
      )}
    >
      <span
        className={cn(
          "absolute size-3.5 rounded-full transition-transform",
          checked ? "translate-x-[18px] bg-ac-brand" : "translate-x-[2px] bg-ac-faint",
        )}
      />
    </button>
  );
}
