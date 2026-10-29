import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/utils.js";

export interface CopyButtonProps {
  text: string;
  /** Inside another button (an account row) a nested <button> is invalid
   *  HTML, so it renders as a focusable span with the button role. */
  nested?: boolean;
  className?: string;
}

/** Small icon that copies `text`; shows a check for a moment after. The click
 *  never reaches the row or button around it. */
export function CopyButton({ text, nested, className }: CopyButtonProps) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);

  const copy = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setDone(true))
      .catch(() => {});
  };
  const label = done ? "Copied" : `Copy ${text}`;
  const props = {
    "aria-label": label,
    title: label,
    "data-row-stop": "",
    onClick: copy,
    className: cn(
      "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-ac-faint transition-colors hover:bg-ac-raise hover:text-ac-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-ac-brand [&_svg]:size-3",
      className,
    ),
  };
  const icon = done ? <Check /> : <Copy />;
  if (!nested) {
    return (
      <button type="button" {...props}>
        {icon}
      </button>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") copy(e);
      }}
    >
      {icon}
    </span>
  );
}

/** Text followed by its copy icon. */
export function Copyable({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 align-middle", className)}>
      <span className="truncate">{text}</span>
      <CopyButton text={text} />
    </span>
  );
}
