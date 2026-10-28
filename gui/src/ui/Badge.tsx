import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils.js";
import type { Tone } from "../vm/types.js";

const TONE: Record<Tone, string> = {
  ok: "bg-ac-ok-tint text-ac-ok-text",
  warn: "bg-ac-warn-tint text-ac-warn-text",
  alert: "bg-ac-alert-tint text-ac-alert-text",
  info: "bg-ac-info-tint text-ac-info-text",
  brand: "bg-ac-brand-tint text-ac-brand-text",
  violet: "bg-ac-violet-tint text-ac-violet-text",
  neutral: "border border-ac-line text-ac-soft",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

/** Bundle `te` + `Z3`. */
export function Badge({ tone = "neutral", dot, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] font-medium leading-none",
        TONE[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
