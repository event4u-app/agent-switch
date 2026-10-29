import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.js";

/** Bundle `Q3` / `$` (app L74). */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ac-brand text-ac-on-color hover:brightness-110",
        secondary: "border border-ac-line2 bg-ac-raise text-ac-text hover:border-ac-faint",
        ghost: "text-ac-soft hover:bg-ac-raise hover:text-ac-text",
        danger: "border border-ac-line2 bg-transparent text-ac-alert-text hover:bg-ac-alert-tint",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-[13px]",
        lg: "h-10 px-4 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type, ...props }, ref) => (
  <button ref={ref} type={type ?? "button"} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name and tooltip. */
  label: string;
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

/** Bundle `ht` (app L76). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, active, badge, className, children, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ac-soft transition-colors hover:bg-ac-raise hover:text-ac-text [&_svg]:size-4",
        active && "bg-ac-brand-tint text-ac-brand-text shadow-[inset_0_0_0_1px_var(--ac-brand-line)]",
        className,
      )}
      {...props}
    >
      {children}
      {badge != null && (
        <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ac-brand px-1 text-center text-[10px] font-semibold leading-4 text-ac-on-color">
          {badge}
        </span>
      )}
    </button>
  ),
);
IconButton.displayName = "IconButton";
