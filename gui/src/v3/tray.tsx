/**
 * The tray (spec §10.7): the same components as the window, in this order —
 * Needs you (3 rows), Sessions (5 rows, same order), the Limits strip, then
 * "Start session" and "Open Agent Switch".
 */

import { Button } from "../ui/Button.js";
import type { BatchActions } from "./kit.js";
import { LimitsStrip, type LimitAccount } from "./limits.js";
import { NeedsZone, type AwayDigest, type NeedItem } from "./needs.js";
import { SessionsZone, liveOrder, type RowSession } from "./sessions.js";

export const TRAY_SESSIONS = 5;

const noBatch: BatchActions = { onClear: () => {}, onPin: () => {}, onArchive: () => {}, onClean: () => {}, onEnd: () => {} };

export function V3Tray({
  needs,
  away,
  sessions,
  accounts,
  nowMs,
  on,
}: {
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
  const live = liveOrder(sessions);
  const shown = live.slice(0, TRAY_SESSIONS);
  return (
    <div className="w-[360px] rounded-xl border border-ac-line2 bg-ac-panel" style={{ boxShadow: "var(--ac-shadow)" }}>
      <NeedsZone items={needs} away={away} onVerb={on.verb} onMore={on.moreNeeds} onAway={on.away} />
      <SessionsZone
        sessions={shown}
        activeKey={null}
        selection={null}
        openKeys={new Set()}
        onSelect={on.session}
        onToggleChildren={() => {}}
        onCheck={() => {}}
        onCleanUp={() => {}}
        onDoneToday={() => {}}
        batch={noBatch}
      />
      {live.length > TRAY_SESSIONS && (
        <button type="button" onClick={on.moreSessions} className="px-3.5 text-[11px] text-ac-muted hover:text-ac-text">
          {live.length - TRAY_SESSIONS} more ›
        </button>
      )}
      <LimitsStrip accounts={accounts} nowMs={nowMs} openKey={null} onOpen={on.account} onSignIn={on.signIn} />
      <div className="flex gap-2 border-t border-ac-line p-2">
        <Button variant="primary" size="sm" className="flex-1" onClick={on.start}>
          Start session
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={on.open}>
          Open Agent Switch
        </Button>
      </div>
    </div>
  );
}
