import { useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { usePortalContainer } from "./AcRoot.js";
import { IconButton } from "./Button.js";
import { Caps } from "./Typography.js";

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  kicker?: ReactNode;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
  /** false: Escape and a click outside do not close it (the keys stay with
   *  what has focus, e.g. a running terminal); only explicit buttons do. */
  dismissible?: boolean;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "password", "number", ""]);

/** A text field the user types into — the embedded terminal's textarea excluded. */
function textField(t: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(t.type)))) return null;
  return t.closest("[data-terminal]") ? null : t;
}

/** Radix handlers: Escape in a text field leaves the field (its own handler
 *  still sees the key) instead of closing the overlay; a non-dismissible
 *  overlay ignores Escape and clicks outside altogether. */
function guard(dismissible: boolean) {
  const keep = (e: Event) => e.preventDefault();
  return {
    onEscapeKeyDown: (e: KeyboardEvent) => {
      if (!dismissible) return e.preventDefault();
      const field = textField(e.target);
      if (field) {
        e.preventDefault();
        field.blur();
      }
    },
    ...(dismissible ? {} : { onInteractOutside: keep }),
  };
}

function OverlayHeader({ title, kicker, className }: { title: ReactNode; kicker?: ReactNode; className: string }) {
  return (
    <header className={className}>
      <div className="min-w-0">
        {kicker && <Caps className="mb-2 block text-ac-brand-text">{kicker}</Caps>}
        <DialogPrimitive.Title className="text-[17px] font-semibold leading-snug text-ac-text">{title}</DialogPrimitive.Title>
      </div>
      <DialogPrimitive.Close asChild>
        <IconButton label="Close">
          <X />
        </IconButton>
      </DialogPrimitive.Close>
    </header>
  );
}

/** Right-hand sheet with brand hairline, scroll body and footer. Bundle `Ts`. */
export function Sheet({ open, onOpenChange, title, kicker, width = 440, footer, children, dismissible = true }: OverlayProps) {
  const container = usePortalContainer();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ac-scrim fixed inset-0 z-40 bg-[var(--ac-scrim)]" />
        <DialogPrimitive.Content
          ref={ref}
          {...guard(dismissible)}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            ref.current?.focus();
          }}
          className="ac-sheet fixed inset-y-0 right-0 z-50 flex max-w-[94vw] flex-col border-l border-ac-line bg-ac-panel shadow-[var(--ac-shadow)] outline-none"
          style={{ width, boxShadow: "inset 0 2px 0 var(--ac-brand), var(--ac-shadow)" }}
          aria-describedby={undefined}
        >
          <OverlayHeader
            title={title}
            kicker={kicker}
            className="flex items-start justify-between gap-3 border-b border-ac-line px-5 pb-4 pt-5"
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ac-line px-5 py-3">{footer}</footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Centred modal at 8vh, same anatomy as Sheet. Bundle `Is`. */
export function Dialog({ open, onOpenChange, title, kicker, width = 560, footer, children, dismissible = true }: OverlayProps) {
  const container = usePortalContainer();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ac-scrim fixed inset-0 z-40 bg-[var(--ac-scrim)]" />
        <DialogPrimitive.Content
          ref={ref}
          {...guard(dismissible)}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            ref.current?.focus();
          }}
          className="ac-dialog fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-xl border border-ac-line2 bg-ac-panel outline-none"
          style={{ width, boxShadow: "var(--ac-shadow)" }}
          aria-describedby={undefined}
        >
          <OverlayHeader title={title} kicker={kicker} className="flex items-start justify-between gap-3 px-5 pb-3 pt-5" />
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ac-line px-5 py-3">{footer}</footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Caps title + aside, divided from the previous section. Bundle `Hn`. */
export function SheetSection({ id, title, aside, children }: { id?: string; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3 border-t border-ac-line pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Caps>{title}</Caps>
        {aside}
      </div>
      {children}
    </section>
  );
}
