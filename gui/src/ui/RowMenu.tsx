import { Fragment, type ReactElement, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn } from "../lib/utils.js";
import { usePortalContainer } from "./AcRoot.js";

export interface RowMenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect?: () => void;
}

/** Row ⋯ menu. Bundle `c0`. */
export function RowMenu({ trigger, items, align = "end" }: { trigger: ReactElement; items: RowMenuItem[]; align?: "start" | "center" | "end" }) {
  const container = usePortalContainer();
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Content
          align={align}
          sideOffset={6}
          className="ac-dialog z-50 min-w-[240px] rounded-lg border border-ac-line2 bg-ac-panel p-1 shadow-[var(--ac-shadow)]"
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separatorBefore && <Menu.Separator className="my-1 h-px bg-ac-line" />}
              <Menu.Item
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  "flex min-h-8 cursor-default select-none items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-[13px] outline-none [&_svg]:size-4 [&_svg]:shrink-0",
                  "data-[highlighted]:bg-ac-raise data-[disabled]:opacity-45",
                  item.danger ? "text-ac-alert-text" : "text-ac-text",
                )}
              >
                {item.icon && <span className={item.danger ? "" : "text-ac-muted"}>{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.hint && <span className="font-ac-mono text-[11px] text-ac-faint">{item.hint}</span>}
              </Menu.Item>
            </Fragment>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
