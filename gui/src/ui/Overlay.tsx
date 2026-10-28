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
export function Sheet({ open, onOpenChange, title, kicker, width = 440, footer, children }: OverlayProps) {
  const container = usePortalContainer();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ac-scrim fixed inset-0 z-40 bg-[var(--ac-scrim)]" />
        <DialogPrimitive.Content
          ref={ref}
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
export function Dialog({ open, onOpenChange, title, kicker, width = 560, footer, children }: OverlayProps) {
  const container = usePortalContainer();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ac-scrim fixed inset-0 z-40 bg-[var(--ac-scrim)]" />
        <DialogPrimitive.Content
          ref={ref}
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
export function SheetSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-ac-line pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Caps>{title}</Caps>
        {aside}
      </div>
      {children}
    </section>
  );
}
