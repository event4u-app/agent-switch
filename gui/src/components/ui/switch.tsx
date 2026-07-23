import * as React from "react";
import { cn } from "@/lib/utils";

/** Pill toggle per the redesign spec (40×22, primary when on, sliding knob).
 *  Plain button with role="switch" — no radix-switch dependency needed. */
const Switch = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }
>(({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    ref={ref}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      "relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      checked ? "bg-primary" : "bg-muted",
      disabled && "cursor-not-allowed opacity-50",
      className,
    )}
    {...props}
  >
    <span
      aria-hidden
      className={cn(
        "block size-4 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-[21px]" : "translate-x-[3px]",
      )}
    />
  </button>
));
Switch.displayName = "Switch";

export { Switch };
