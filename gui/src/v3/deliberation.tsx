/**
 * Council, arena, panel (owner, 2026-11-26): whether the agent offers one of them when a question warrants it,
 * runs the fitting one itself, or leaves them out. agent-config owns the setting; Agent Switch sets it for
 * everyone (Settings › Agents) and for one chat (the status bar), like the model.
 */

import { useState } from "react";
import { ChevronDown, Scale } from "lucide-react";

import { cn } from "../lib/utils.js";
import { Segmented } from "../ui/Segmented.js";
import { Anchored, Menu, POPOVER_TRIGGER } from "./menus.js";
import { Group, Row } from "./settings.js";

export type DeliberationMode = "off" | "offer" | "auto";
export interface DeliberationState {
  mode: DeliberationMode;
  source: "session" | "global" | "default";
}

export const MODE_TEXT: Record<DeliberationMode, { label: string; detail: string }> = {
  off: { label: "Off", detail: "The default: never offered, never run on its own — until you turn it on, here or for one chat." },
  offer: { label: "Offer", detail: "When a question warrants one, the agent offers the fitting council, arena or panel as an answer you can pick." },
  auto: { label: "Auto", detail: "When it clearly helps, the agent runs the fitting one itself and says which and why." },
};

/** Settings › Agents: the one setting every chat starts from. `error`: agent-config cannot answer (missing or too old). */
export function DeliberationSettings({ state, error, onChange }: { state: DeliberationState | null; error?: string | null; onChange: (mode: DeliberationMode) => void }) {
  return (
    <Group title="Council, arena, panel" detail="agent-config's deliberation tools: a council asks other model families, an arena lets competing solutions fight it out, a panel has independent judges vote. Off unless you turn it on — for everyone here, or for one chat in its status bar.">
      <div className="rounded-[10px] border border-ac-line bg-ac-panel px-4">
        <Row title="When a question warrants one" detail={error ? `Not available: ${error}` : state ? MODE_TEXT[state.mode].detail : "Reading agent-config…"}>
          <Segmented
            label="Council, arena, panel"
            value={state?.mode ?? "off"}
            onChange={onChange}
            options={(["off", "offer", "auto"] as const).map((m) => ({ value: m, label: MODE_TEXT[m].label, disabled: !state || !!error, why: error ?? undefined }))}
          />
        </Row>
      </div>
    </Group>
  );
}

/**
 * The status bar's control for one chat: what it runs with, and a menu to change it — Off, Offer, Auto, or back
 * to the global setting. Hidden when agent-config cannot answer.
 */
export function DeliberationChip({ state, global, onChange }: { state: DeliberationState; global: DeliberationMode | null; onChange: (mode: DeliberationMode | "inherit") => void }) {
  const [open, setOpen] = useState(false);
  const own = state.source === "session";
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        {...POPOVER_TRIGGER}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Council, arena, panel: ${MODE_TEXT[state.mode].label}${own ? " for this chat" : ""}`}
        title={`Council, arena, panel: ${MODE_TEXT[state.mode].label}${own ? " (this chat)" : " (global)"} — ${MODE_TEXT[state.mode].detail}`}
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-5 items-center gap-1 rounded px-1.5 hover:bg-ac-raise hover:text-ac-text", own && "text-ac-soft", open && "bg-ac-raise text-ac-text")}
      >
        <Scale aria-hidden className="size-3.5" />
        <span>{MODE_TEXT[state.mode].label}</span>
        {own && <span aria-hidden className="size-1 rounded-full bg-ac-brand" />}
        <ChevronDown aria-hidden className="size-3" />
      </button>
      {open && (
        <Anchored onClose={() => setOpen(false)} className="absolute bottom-full right-0 z-30 mb-1">
          <Menu
            label="Council, arena, panel for this chat"
            autoFocus
            width={300}
            items={[
              { section: "Council, arena, panel · this chat", label: "" },
              ...(["off", "offer", "auto"] as const).map((m) => ({ id: m, label: MODE_TEXT[m].label, hint: MODE_TEXT[m].detail, checked: own && state.mode === m, onClick: () => (setOpen(false), onChange(m)) })),
              { divider: true, label: "" },
              { id: "inherit", label: `Same as global${global ? ` (${MODE_TEXT[global].label})` : ""}`, checked: !own, onClick: () => (setOpen(false), onChange("inherit")) },
            ]}
          />
        </Anchored>
      )}
    </span>
  );
}
