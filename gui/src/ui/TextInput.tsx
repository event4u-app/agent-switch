import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/utils.js";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

/** Bundle `vo`. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(({ className, mono, ...props }, ref) => (
  <input
    ref={ref}
    spellCheck={false}
    autoComplete="off"
    className={cn(
      "h-8 min-w-0 rounded-md border border-ac-line2 bg-ac-bg px-2.5 text-xs text-ac-text outline-none placeholder:text-ac-faint focus:border-ac-brand-line",
      mono && "font-ac-mono",
      className,
    )}
    {...props}
  />
));
TextInput.displayName = "TextInput";
