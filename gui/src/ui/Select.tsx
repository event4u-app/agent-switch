import { useId, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";
import { usePortalContainer } from "./AcRoot.js";

export interface SelectOption {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
  dot?: ReactNode;
  tag?: ReactNode;
  disabled?: boolean;
}

/** Radix select with optional caps label; options carry dot/hint/tag. Bundle `We`. */
export function Select({
  label,
  value,
  onChange,
  options,
  mono,
  id,
  ariaLabel,
  disabled,
}: {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  mono?: boolean;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const container = usePortalContainer();
  const current = options.find((o) => o.value === value);
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label && (
        <label htmlFor={fieldId} className="ac-caps">
          {label}
        </label>
      )}
      <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          id={fieldId}
          aria-label={label ? undefined : ariaLabel}
          className={cn(
            "group flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-ac-line2 bg-ac-bg px-2.5 text-left text-[13px] text-ac-text transition-colors",
            "hover:border-ac-faint data-[state=open]:border-ac-brand-line data-[state=open]:bg-ac-raise disabled:pointer-events-none disabled:opacity-45",
            mono && "font-ac-mono text-xs",
          )}
        >
          {current?.dot}
          <span className="min-w-0 flex-1 truncate">
            <SelectPrimitive.Value />
          </span>
          {current?.tag}
          <ChevronDown className="size-4 shrink-0 text-ac-muted transition-transform group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal container={container}>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className="ac-dialog z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-ac-line2 bg-ac-panel shadow-[var(--ac-shadow)]"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className={cn(
                    "relative flex min-h-9 cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-[13px] text-ac-text outline-none",
                    "data-[highlighted]:bg-ac-raise data-[disabled]:opacity-45",
                    "data-[state=checked]:bg-ac-brand-tint data-[state=checked]:shadow-[inset_0_0_0_1px_var(--ac-brand-line)]",
                    mono && "font-ac-mono text-xs",
                  )}
                >
                  {o.dot}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                    {o.hint && <span className="truncate text-[11px] text-ac-muted">{o.hint}</span>}
                  </span>
                  {o.tag}
                  <SelectPrimitive.ItemIndicator className="absolute right-2.5 text-ac-brand-text">
                    <Check className="size-4" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
