/** The v3 tray card on real data. The tray window may only run its read-only
 *  scopes (capabilities/tray.json), so it reads the queue and the hosted
 *  sessions and nothing else; every action opens or drives the main window. */

import type { CSSProperties } from "react";

import { LangKeyed } from "../../i18n/LangKeyed.js";
import * as ipc from "../../ipc.js";
import { forwardToMain, openMainWindow } from "../../redesign/tray/bridge.js";
import { TrayBridge, TrayLifecycle, trayActions, useFitWindow } from "../../redesign/tray/TrayApp.js";
import { AcRoot } from "../../ui/AcRoot.js";
import { emptyViewModel, loadViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import { DEFAULT_APPEARANCE } from "../themes/resolve.js";
import { V3Tray } from "../tray.js";
import { toV3Data } from "./data.js";
import { useV3Feeds, type FeedDeps } from "./useFeeds.js";
import { useTheme } from "./V3App.js";

const notInTray = () => Promise.reject(new Error("not read in the tray"));

/** The reads the tray scope allows; the rest are never attempted. */
export const TRAY_DEPS: FeedDeps = {
  needs: ipc.listNeeds,
  host: ipc.hostList,
  engine: notInTray,
  library: notInTray,
  openTargets: notInTray,
  agents: notInTray,
  remote: notInTray,
  codexRows: notInTray,
};

function V3TrayFrame() {
  const s = useAS();
  const ref = useFitWindow();
  const { feeds } = useV3Feeds(TRAY_DEPS);
  const d = toV3Data(s, feeds, {
    now: s.now,
    appearance: DEFAULT_APPEARANCE,
    prefersDark: true,
    focusTerminal: true,
    engineDownSince: null,
    plan: { folder: "~", gitState: null, worktree: false, tool: "claude", model: "", thinking: "", where: "terminal" },
    terminalApp: "",
    changes: new Map(),
    wantChanges: () => {},
  });
  const main = () => void openMainWindow();
  return (
    <div ref={ref} className="w-[360px]">
      <TrayBridge />
      <TrayLifecycle />
      <V3Tray
        needs={d.needs}
        away={d.away}
        sessions={d.sessions}
        accounts={d.limits}
        nowMs={d.nowMs}
        loading={!s.loaded}
        on={{ verb: main, moreNeeds: main, away: main, session: main, moreSessions: main, account: main, signIn: main, start: () => void forwardToMain({ kind: "start" }), open: main }}
      />
    </div>
  );
}

/** Second entry (tray.html) when the v3 window is on. */
export default function V3TrayApp() {
  const { vars, mode } = useTheme();
  return (
    <AcRoot mode={mode} style={vars as CSSProperties}>
      <ASProvider initial={emptyViewModel()} load={loadViewModel} actions={trayActions}>
        <LangKeyed>
          <V3TrayFrame />
        </LangKeyed>
      </ASProvider>
    </AcRoot>
  );
}
