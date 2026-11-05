/**
 * The tray (spec §10.7): the same components as the window. The head opens the
 * window. Needs you stays across tools, so nothing urgent hides in another tab;
 * below it one tab per tool — Claude first and the default, the others only
 * while they have live sessions — each with that tool's sessions (5 rows, same
 * order) and its limits. "Open Agent Switch" on the left, "Start session" on
 * the right.
 */

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { AppLogo } from "../ui/AppLogo.js";
import { Button } from "../ui/Button.js";
import type { BatchActions } from "./kit.js";
import { LimitRow, type LimitAccount } from "./limits.js";
import { NeedsZone, type AwayDigest, type NeedItem } from "./needs.js";
import { SessionsZone, liveOrder, type RowSession } from "./sessions.js";
import { TAB, TAB_ON } from "./workbench.js";

export const TRAY_SESSIONS = 5;

export type TrayTool = "claude" | "codex";
const TOOL_NAME: Record<TrayTool, string> = { claude: "Claude", codex: "Codex" };

/** A session's tool, from its key (`<tool>/<account>/<id>`). Pure. */
export const toolOf = (key: string): string => key.split("/")[0];

/** Claude always (the default), then every other tool with a live session. Pure. */
export function trayTools(live: readonly RowSession[]): TrayTool[] {
  return (["claude", "codex"] as const).filter((t) => t === "claude" || live.some((s) => toolOf(s.key) === t));
}

const noBatch: BatchActions = { onClear: () => {}, onPin: () => {}, onArchive: () => {}, onClean: () => {}, onEnd: () => {} };

export function V3Tray({
  needs,
  away,
  sessions,
  accounts,
  nowMs,
  loading,
  ready,
  on,
}: {
  /** The first read has not settled: no "No sessions running" yet. */
  loading?: boolean;
  /** Health as the tray reads it; omitted = not shown. */
  ready?: boolean;
  needs: NeedItem[];
  away: AwayDigest | null;
  sessions: RowSession[];
  accounts: LimitAccount[];
  nowMs: number;
  on: {
    verb: (n: NeedItem) => void;
    moreNeeds: () => void;
    away: () => void;
    session: (key: string) => void;
    moreSessions: () => void;
    account: (key: string) => void;
    signIn: (key: string) => void;
    start: () => void;
    open: () => void;
  };
}) {
  const [picked, setPicked] = useState<TrayTool>("claude");
  const all = liveOrder(sessions);
  const tools = trayTools(all);
  // A tool whose last session ended drops its tab; fall back to the default.
  const tab = tools.includes(picked) ? picked : "claude";
  const live = all.filter((s) => toolOf(s.key) === tab);
  const shown = live.slice(0, TRAY_SESSIONS);
  const limits = accounts.filter((a) => a.tool === tab);
  return (
    <div className="w-[360px] overflow-hidden rounded-xl border border-ac-line2 bg-ac-panel" style={{ boxShadow: "var(--ac-shadow)" }}>
      <button type="button" onClick={on.open} title="Open Agent Switch" className="group flex w-full items-center gap-2 border-b border-ac-line px-3 py-2.5 text-left hover:bg-ac-raise">
        <AppLogo className="size-5" />
        <span className="text-[13px] font-semibold text-ac-text">Agent Switch</span>
        <ArrowUpRight aria-hidden className="size-3.5 text-ac-faint group-hover:text-ac-text" />
        {ready !== undefined && (
          <span className={cn("ml-auto inline-flex items-center gap-1.5 text-[11px]", ready ? "text-ac-ok-text" : "text-ac-warn-text")}>
            <span className={cn("size-1.5 rounded-full", ready ? "bg-ac-ok" : "bg-ac-warn")} />
            {ready ? "Ready" : "Check health"}
          </span>
        )}
      </button>
      <NeedsZone tray items={needs} away={away} onVerb={on.verb} onMore={on.moreNeeds} onAway={on.away} />
      <div role="tablist" aria-label="Tools" className="mt-1.5 flex items-end gap-0.5 border-b border-ac-line px-2 pt-1">
        {tools.map((t) => {
          const isOn = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={isOn}
              onClick={() => setPicked(t)}
              className={cn(TAB, "min-w-[96px]", isOn ? TAB_ON : "border-transparent text-ac-muted hover:bg-ac-raise hover:text-ac-text")}
            >
              <span>{TOOL_NAME[t]}</span>
              <span className="ml-auto font-ac-mono text-[10.5px] text-ac-muted">{all.filter((s) => toolOf(s.key) === t).length}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={TOOL_NAME[tab]} className="bg-ac-bg">
        <div className="pb-1">
          <SessionsZone
            tray
            divider={false}
            sessions={shown}
            activeKey={null}
            selection={null}
            openKeys={new Set()}
            onSelect={on.session}
            onToggleChildren={() => {}}
            onCheck={() => {}}
            onCleanUp={() => {}}
            onDoneToday={() => {}}
            onStart={on.start}
            loading={loading}
            batch={noBatch}
          />
          {live.length > TRAY_SESSIONS && (
            <button type="button" onClick={on.moreSessions} className="ml-1.5 h-6 px-2 text-[11px] text-ac-muted hover:text-ac-text">
              {live.length - TRAY_SESSIONS} more ›
            </button>
          )}
        </div>
        {limits.length > 0 && (
          <section aria-label="Limits" className="border-t border-ac-line px-1.5 pb-1.5 pt-1">
            <div className="flex h-7 items-center px-2 text-[11px] font-semibold text-ac-soft">Limits</div>
            {limits.map((a) => (
              <LimitRow key={a.key} a={a} nowMs={nowMs} noTool onOpen={on.account} onSignIn={on.signIn} />
            ))}
          </section>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-ac-line px-3 py-2">
        <Button variant="ghost" size="sm" onClick={on.open}>
          Open Agent Switch
        </Button>
        <Button variant="primary" size="sm" className="ml-auto" onClick={on.start}>
          Start session
        </Button>
      </div>
    </div>
  );
}
