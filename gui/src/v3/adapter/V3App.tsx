/** The v3 main window on real data: the 2.11 store and engines, the v3 feeds,
 *  the adapter in between. 2.11 overlays (start, re-auth, session sheet,
 *  terminal runs) open over it for the flows v3 has no dialog of its own for. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LangKeyed } from "../../i18n/LangKeyed.js";
import * as ipc from "../../ipc.js";
import { allActions } from "../../redesign/RedesignApp.js";
import { useEngines } from "../../redesign/engines/index.js";
import { OverlayHost } from "../../redesign/Hosts.js";
import { PoolsSection } from "../../redesign/screens/pools-panel.js";
import { ToolList } from "../../redesign/screens/tools.js";
import { UsageHistory, useUsageHistory } from "../../redesign/screens/usage-history.js";
import { openExternal } from "../../redesign/screens/tools.js";
import { appRequest, useTrayRequests } from "../../redesign/tray/bridge.js";
import { getFocusTerminal, setFocusTerminalFlag, setNotifLastRead } from "../../settings-store.js";
import { AcRoot } from "../../ui/AcRoot.js";
import { Toaster } from "../../ui/Toaster.js";
import { emptyViewModel, loadViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import { Choice, Modal, type NewSessionPlan } from "../dialogs.js";
import { Act } from "../kit.js";
import type { ChangedFile } from "../panels.js";
import type { Appearance } from "../themes/resolve.js";
import { V3Window, type V3Action, type V3Slots } from "../window.js";
import { dispatchV3, type DispatchDeps } from "./actions.js";
import { applyAppearance, loadAppearance, saveAppearance, themeVars } from "./appearance.js";
import { sessionKey, toV3Data } from "./data.js";
import { OpenInMenu, SessionBody, settingsSection } from "./slots.js";
import { useV3Feeds } from "./useFeeds.js";

const CHANGES_FRESH_MS = 10_000;

function usePrefersDark(): boolean {
  const q = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(q?.matches ?? true);
  useEffect(() => {
    if (!q) return;
    const on = () => setDark(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [q]);
  return dark;
}

const terminalAppFor = (platform: string) => (platform === "mac" ? "Terminal.app" : platform === "windows" ? "Windows Terminal" : "your terminal");

type Pick = Parameters<DispatchDeps["pick"]>[0];
type Prompt = Parameters<DispatchDeps["prompt"]>[0];

function PickSheet({ req, onClose }: { req: Pick; onClose: () => void }) {
  return (
    <Modal title={req.title} width={420} onClose={onClose} footer={<Act onClick={onClose}>Cancel</Act>}>
      <div role="radiogroup" className="flex flex-col gap-2">
        {req.options.map((o) => (
          <Choice key={o} on={o === req.current} title={o} onPick={() => (onClose(), req.onPick(o))} />
        ))}
      </div>
    </Modal>
  );
}

function PromptSheet({ req, onClose }: { req: Prompt; onClose: () => void }) {
  const [v, setV] = useState(req.initial);
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    onClose();
    req.onSubmit(t);
  };
  return (
    <Modal
      title={req.title}
      width={420}
      onClose={onClose}
      footer={
        <>
          <Act onClick={onClose}>Cancel</Act>
          <Act kind="accent" onClick={submit}>
            Save
          </Act>
        </>
      }
    >
      <input
        aria-label={req.title}
        autoFocus
        value={v}
        maxLength={120}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="h-8 w-full rounded-md border border-ac-line bg-ac-bg px-2.5 text-[13px] text-ac-text outline-none focus:border-ac-brand-line"
      />
    </Modal>
  );
}

export function V3Frame() {
  const s = useAS();
  const sRef = useRef(s);
  sRef.current = s;
  useEngines();
  useTrayRequests(s.open, undefined, (payload) => {
    const req = appRequest(sRef.current, payload);
    if (req && sRef.current.act.openApp) void sRef.current.act.openApp(req.appId, req.accountId);
  });
  const { feeds, refresh: refreshFeeds } = useV3Feeds();
  const prefersDark = usePrefersDark();
  const [appearance, setAppearanceState] = useState<Appearance>(loadAppearance);
  const vars = useMemo(() => themeVars(appearance, prefersDark).vars, [appearance, prefersDark]);
  useEffect(() => void applyAppearance(appearance, prefersDark), [appearance, prefersDark]);
  const [focusTerminal, setFocusTerminalState] = useState(getFocusTerminal);
  const [pick, setPick] = useState<Pick | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [changes, setChanges] = useState<Map<string, ChangedFile[]>>(new Map());
  const changesAt = useRef(new Map<string, number>());
  const downSince = useRef<number | null>(null);
  if (feeds.engine && !feeds.engine.running) downSince.current ??= feeds.readAt.engine ?? Date.now();
  else if (feeds.engine?.running) downSince.current = null;

  const refresh = useCallback(() => {
    refreshFeeds();
    void sRef.current.reload();
  }, [refreshFeeds]);

  const wantChanges = useCallback((key: string) => {
    const at = changesAt.current.get(key) ?? 0;
    if (Date.now() - at < CHANGES_FRESH_MS) return;
    changesAt.current.set(key, Date.now());
    setTimeout(() => {
      ipc
        .sessionChanges(key)
        .then((files) => setChanges((m) => new Map(m).set(key, files)))
        .catch(() => {});
    }, 0);
  }, []);

  const rows = useMemo(() => [...(s.sessionRows ?? []), ...feeds.codexRows], [s.sessionRows, feeds.codexRows]);
  const lastFolder = rows.find((r) => r.cwd)?.cwd ?? "~";
  const plan: NewSessionPlan = { folder: lastFolder, gitState: null, worktree: false, tool: "claude", model: "opus", thinking: "high", where: feeds.host?.mode === "persistent" ? "hosted" : "terminal" };
  const terminalApp = terminalAppFor(s.platform);

  const data = toV3Data(s, feeds, {
    now: s.now,
    appearance,
    prefersDark,
    focusTerminal,
    engineDownSince: downSince.current,
    plan,
    terminalApp,
    changes,
    wantChanges,
  });

  const byKey = useMemo(() => new Map(rows.map((r) => [sessionKey(r), r])), [rows]);
  const hostedKeys = new Set((feeds.host?.hosted ?? []).filter((h) => h.alive).map((h) => h.key));
  const deps: DispatchDeps = {
    ipc,
    act: s.act,
    open: s.open,
    toast: s.toast,
    openUrl: openExternal,
    refresh,
    rows: () => byKey,
    needs: () => feeds.needs?.items ?? [],
    hosted: (k) => hostedKeys.has(k),
    setAppearance: (a) => (saveAppearance(a), setAppearanceState(a)),
    setFocusTerminal: (on) => (setFocusTerminalFlag(on), setFocusTerminalState(on)),
    pick: setPick,
    prompt: setPrompt,
  };
  const act = (a: V3Action) => void dispatchV3(a, deps);

  const history = useUsageHistory(s.accounts, s.now);
  const slots: V3Slots = {
    body: (key) => (
      <SessionBody
        sessionKey={key}
        row={byKey.get(key)}
        hosted={hostedKeys.has(key)}
        vars={vars}
        followTheme={appearance.terminalFollows}
        where={terminalApp}
        onFocus={() => void ipc.focusSessionTerminal(key).catch((e: unknown) => s.toast({ tone: "alert", text: `Focus failed: ${e instanceof Error ? e.message : String(e)}` }))}
        onTakeOver={() => s.open({ kind: "session", id: `${key.split("/")[0]}:${key.split("/")[2]}` })}
        onExit={refresh}
      />
    ),
    openIn: (key) => (
      <OpenInMenu
        targets={data.openIn.targets}
        defaultTarget={data.openIn.defaultTarget}
        onOpen={(target) => void ipc.openSessionIn(key, target).catch((e: unknown) => s.toast({ tone: "alert", text: `Open failed: ${e instanceof Error ? e.message : String(e)}` }))}
      />
    ),
    usageHistory: <UsageHistory history={history} />,
    pools: <PoolsSection />,
    poolCount: s.pools.length,
    tools: <ToolList />,
    settings: settingsSection,
  };

  return (
    <>
      <V3Window data={data} slots={slots} act={act} />
      <OverlayHost />
      <Toaster toasts={s.toasts} onDismiss={s.dismissToast} />
      {pick && <PickSheet req={pick} onClose={() => setPick(null)} />}
      {prompt && <PromptSheet req={prompt} onClose={() => setPrompt(null)} />}
    </>
  );
}

/** The main window, v3. */
export default function V3App() {
  return (
    <AcRoot className="h-full">
      <ASProvider initial={emptyViewModel()} load={loadViewModel} actions={allActions} onNoticesRead={setNotifLastRead}>
        <LangKeyed>
          <V3Frame />
        </LangKeyed>
      </ASProvider>
    </AcRoot>
  );
}
