import { useRef } from "react";
import { Blocks, Gauge, MessageSquare, Power, Settings, Users, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type Section = "profiles" | "sessions" | "usage" | "tooling" | "ecosystem" | "settings";

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "profiles", label: "Profiles", icon: Users },
  { id: "sessions", label: "Sessions", icon: MessageSquare },
  { id: "usage", label: "Usage", icon: Gauge },
  { id: "tooling", label: "Tooling", icon: Wrench },
  { id: "ecosystem", label: "Ecosystem", icon: Blocks },
  { id: "settings", label: "Settings", icon: Settings },
];

/** Left section rail: the app's top-level navigation. 200px fixed, collapsing
 *  to a 56px icon rail below 820px window width (labels hide, icons stay). On
 *  macOS the top 44px stays empty — the native traffic lights render there
 *  (titleBarStyle: Overlay, trafficLightPosition {x:12,y:24}). Arrow keys move
 *  focus through the nav (wrapping); the active row carries a 3px left accent
 *  bar plus a filled background so colour is never the only signal. */
export function Sidebar({
  section,
  onSelect,
  onQuit,
  isMac,
}: {
  section: Section;
  onSelect: (section: Section) => void;
  onQuit: () => void;
  isMac: boolean;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onNavKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = SECTIONS.length - 1;
    const next =
      e.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    itemRefs.current[next]?.focus();
  }

  return (
    <aside className="flex w-14 shrink-0 flex-col border-r border-border bg-[hsl(var(--sidebar))] min-[820px]:w-[200px]">
      {/* Traffic-light reserve — macOS only; reclaimed on Windows/Linux. */}
      {isMac && <div className="h-11 shrink-0" data-tauri-drag-region />}
      <nav aria-label="Sections" className={cn("flex flex-col gap-0.5 px-2", !isMac && "pt-2")}>
        {SECTIONS.map((s, i) => {
          const active = section === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              aria-label={s.label}
              aria-current={active ? "page" : undefined}
              // Roving tabindex: Tab enters the nav on the active item; the
              // arrow keys move within it.
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => onNavKeyDown(e, i)}
              className={cn(
                "relative flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {active && <span aria-hidden className="absolute inset-y-[7px] left-0 w-[3px] rounded-full bg-primary" />}
              <Icon className="size-4 shrink-0" />
              <span className="hidden truncate min-[820px]:inline">{s.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="mt-auto p-2">
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start gap-2.5 px-2.5 text-muted-foreground hover:text-destructive"
          onClick={onQuit}
          aria-label="Quit"
        >
          <Power className="size-4" />
          <span className="hidden min-[820px]:inline">Quit</span>
        </Button>
      </div>
    </aside>
  );
}
