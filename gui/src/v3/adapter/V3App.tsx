/** The v3 main window on real data: the 2.11 store and engines, the v3 feeds,
 *  the adapter in between. 2.11 overlays (start, re-auth, session sheet,
 *  terminal runs) open over it for the flows v3 has no dialog of its own for. */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { LangKeyed } from "../../i18n/LangKeyed.js";
import * as ipc from "../../ipc.js";
import { allActions } from "../../redesign/RedesignApp.js";
import { useEngines } from "../../redesign/engines/index.js";
import { OverlayHost } from "../../redesign/Hosts.js";
import { PoolsSection } from "../../redesign/screens/pools-panel.js";
import { UsageHistory, useUsageHistory } from "../../redesign/screens/usage-history.js";
import { openExternal } from "../../redesign/screens/tools.js";
import { appRequest, useTrayRequests } from "../../redesign/tray/bridge.js";
import { getFocusTerminal, getLimitAutoOpen, setFocusTerminalFlag, setNotifLastRead } from "../../settings-store.js";
import { AcRoot } from "../../ui/AcRoot.js";
import { Toaster } from "../../ui/Toaster.js";
import { emptyViewModel, loadViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import { Modal, type NewSessionPlan } from "../dialogs.js";
import { Act } from "../kit.js";
import type { ChangedFile } from "../panels.js";
import type { Appearance } from "../themes/resolve.js";
import { V3Window, type V3Action, type V3Slots } from "../window.js";
import { localLayout } from "../layout.js";
import { KEYS_STORAGE, withRebinds } from "../keys.js";
import { dispatchV3, type DispatchDeps } from "./actions.js";
import { applyAppearance, loadAppearance, saveAppearance, themeVars } from "./appearance.js";
import { sessionKey, toV3Data, worktreeOf, type AdapterEnv } from "./data.js";
import { SessionBody, ToolsSlot, settingsSection } from "./slots.js";
import type { SessionRow } from "../../transforms.js";
import { useV3Feeds } from "./useFeeds.js";
import { useChats } from "./chats.js";
import { ReviewHost } from "./ReviewHost.js";
import { McpHost } from "./McpHost.js";
import { viewStep } from "./viewSwitch.js";
import { fold } from "../timeline.js";
import { sessionFromRow } from "../../vm/build.js";
import { ChatView } from "../chatview.js";

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

type Prompt = Parameters<DispatchDeps["prompt"]>[0];

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

export interface ThemeState {
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  prefersDark: boolean;
  vars: Record<string, string>;
}

/** The appearance and its resolved tokens. They go on the `.as-ac` root, whose
 *  stylesheet defaults would otherwise win over tokens set higher up. */
export function useTheme(): ThemeState & { mode: "dark" | "light" } {
  const prefersDark = usePrefersDark();
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const { vars, mode } = useMemo(() => themeVars(appearance, prefersDark), [appearance, prefersDark]);
  useEffect(() => void applyAppearance(appearance, prefersDark), [appearance, prefersDark]);
  // The other window (main ↔ tray) changed it: follow.
  useEffect(() => {
    const on = (e: StorageEvent) => (e.key === null || e.key === "agent-switch-appearance") && setAppearance(loadAppearance());
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  return { appearance, setAppearance, prefersDark, vars, mode };
}

export function V3Frame({ theme }: { theme: ThemeState }) {
  const s = useAS();
  const sRef = useRef(s);
  sRef.current = s;
  useEngines();
  useTrayRequests(s.open, undefined, (payload) => {
    const req = appRequest(sRef.current, payload);
    if (req && sRef.current.act.openApp) void sRef.current.act.openApp(req.appId, req.accountId);
  });
  const { feeds, refresh: refreshFeeds } = useV3Feeds();
  const { appearance, prefersDark, vars } = theme;
  const setAppearanceState = theme.setAppearance;
  const [focusTerminal, setFocusTerminalState] = useState(getFocusTerminal);
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
  const [route, setRoute] = useState<AdapterEnv["route"]>(null);
  useEffect(() => {
    if (lastFolder === "~") return;
    let alive = true;
    ipc
      .resolveDir("claude", lastFolder)
      .then((r) => alive && setRoute({ profile: r.profile, why: r.why ?? [], ...(r.blocked ? { blocked: r.blocked } : {}) }))
      .catch(() => alive && setRoute(null));
    return () => {
      alive = false;
    };
  }, [lastFolder]);

  const byKeyRef = useRef(new Map<string, SessionRow>());
  const titleOf = (key: string) => byKeyRef.current.get(key)?.summary ?? key.split("/")[1] ?? "A session";
  const chats = useChats(titleOf);
  const [focus, setFocus] = useState<{ key: string; n: number } | undefined>(undefined);
  const openTab = (key: string) => setFocus((f) => ({ key: chats.tabOf(key) ?? key, n: (f?.n ?? 0) + 1 }));
  const newChat = () => {
    const profile = route?.profile ? route.profile.slice(route.profile.indexOf("/") + 1) : s.accounts.find((a) => a.tool === "claude" && a.isDefault)?.name;
    if (!profile || lastFolder === "~") return s.toast({ tone: "warn", text: "No Claude account or folder to start a chat in yet" });
    const tab = `claude/${profile}/chat-${Date.now().toString(36)}`;
    chats.open(tab, { new: { profile, provider: "claude", cwd: lastFolder }, mode: "default" });
    openTab(tab);
  };

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
    route,
    chats: chats.keys,
    // A new chat that the CLI already lists under its real key needs no stand-in row.
    chatRows: chats.rows.filter((r) => {
      const real = chats.states.get(sessionKey(r))?.session?.key;
      return !real || !(s.sessionRows ?? []).some((x) => sessionKey(x) === real);
    }),
  });
  // Until the first read settles, empty lists are "not read yet" (no empty states).
  data.loading = !s.loaded;

  const byKey = useMemo(() => new Map(rows.map((r) => [sessionKey(r), r])), [rows]);
  byKeyRef.current = byKey;
  const hostedKeys = new Set((feeds.host?.hosted ?? []).filter((h) => h.alive).map((h) => h.key));
  const parkedKeys = new Set((feeds.host?.hosted ?? []).filter((h) => h.alive && h.parked).map((h) => h.key));
  const deps: DispatchDeps = {
    ipc,
    act: s.act,
    open: s.open,
    toast: s.toast,
    openUrl: openExternal,
    refresh,
    reveal: () => void ipc.showWindow().catch(() => {}),
    rows: () => byKey,
    needs: () => feeds.needs?.items ?? [],
    requests: () => s.switchRequests,
    hosted: (k) => hostedKeys.has(k),
    setAppearance: (a) => (saveAppearance(a), setAppearanceState(a)),
    setFocusTerminal: (on) => (setFocusTerminalFlag(on), setFocusTerminalState(on)),
    prompt: setPrompt,
    newChat,
    openTab,
    chatOf: (key) => {
      const tab = chats.tabOf(key);
      return tab ? (chats.states.get(tab) ?? null) : null;
    },
  };
  const act = (a: V3Action) => void dispatchV3(a, deps);

  // The [Terminal | Chat] switch (Phase 4): only between turns, so a switch
  // asked for during a turn is armed and happens when the turn ends.
  const [armed, setArmed] = useState<ReadonlyMap<string, "terminal" | "chat">>(new Map());
  const arm = (key: string, to: "terminal" | "chat" | null) =>
    setArmed((m) => {
      if ((m.get(key) ?? null) === to) return m;
      const n = new Map(m);
      if (to) n.set(key, to);
      else n.delete(key);
      return n;
    });
  const chatRunning = (key: string) => {
    const tab = chats.tabOf(key);
    const c = tab ? chats.states.get(tab) : undefined;
    return !!c && c.status === "ready" && fold(c.events).running;
  };
  const terminalRunning = (key: string) => {
    const r = byKey.get(key);
    return !!r && sessionFromRow(r, s.now).state === "working";
  };
  function switchView(key: string, to: "terminal" | "chat") {
    const tab = chats.tabOf(key);
    const step = viewStep(to, { inChat: !!tab, hosted: hostedKeys.has(key), parked: parkedKeys.has(key), chatRunning: chatRunning(key), terminalRunning: terminalRunning(key) });
    const restore = () =>
      void ipc
        .viewSwitch(key, "terminal")
        .catch((e: unknown) => s.toast({ tone: "alert", text: e instanceof Error ? e.message : String(e) }))
        .finally(refresh);
    const armTo = (t: "terminal" | "chat") => {
      if (armed.get(key) !== t) s.toast({ tone: "info", text: `Switches to the ${t} after this turn` });
      arm(key, t);
    };
    switch (step.do) {
      case "none":
        return;
      case "no-terminal":
        return s.toast({ tone: "info", text: "This session started in the chat view; it has no terminal here" });
      case "arm":
        return armTo(step.to);
      case "close-chat":
        arm(key, null);
        // Closing the chat ends its bridge, which brings the program back in the window.
        chats.close(tab!);
        // A bridge that already ended (a failed start, a reloaded window) brings nothing back: ask once more. Idempotent.
        return void setTimeout(() => (parkedKeys.has(key) ? restore() : refresh()), 1500);
      case "restore":
        arm(key, null);
        return restore();
      case "open-chat":
        void ipc
          .viewSwitch(key, "chat")
          .then(() => {
            arm(key, null);
            chats.open(key, { key, mode: "default" });
          })
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (/switch after this turn/.test(msg)) return armTo("chat");
            arm(key, null);
            s.toast({ tone: "alert", text: msg });
          });
    }
  }
  deps.switchView = switchView;
  useEffect(() => {
    for (const [key, to] of armed) {
      if (to === "terminal" ? !chatRunning(key) : !terminalRunning(key)) switchView(key, to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, chats.states, byKey]);

  const history = useUsageHistory(s.accounts, s.now);
  // The user's rebinds on top of the defaults; a blocked store keeps the defaults.
  const keys = useMemo(() => {
    try {
      return withRebinds(localStorage.getItem(KEYS_STORAGE));
    } catch {
      return withRebinds(null);
    }
  }, []);
  const slots: V3Slots = {
    body: (key) => {
      const tab = chats.tabOf(key);
      const chat = tab ? chats.states.get(tab) : undefined;
      if (tab) return chat ? <ChatView b={chat} findFiles={(q) => ipc.sessionFiles(chat.session?.key ?? key, q)} worktreeOf={worktreeOf(byKey.get(chat.session?.key ?? key))} /> : <p className="m-auto text-[13px] text-ac-muted">Starting the chat…</p>;
      return (
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
      );
    },
    review: (key) => {
      const tab = chats.tabOf(key);
      const chat = tab ? chats.states.get(tab) : undefined;
      const row = byKey.get(key);
      const running = (chat ? chat.status === "ready" && fold(chat.events).running : false) || (row ? sessionFromRow(row, s.now).state === "working" : false);
      return (
        <ReviewHost
          sessionKey={chat?.session?.key ?? key}
          title={data.sessions.find((x) => x.key === key)?.title ?? row?.summary ?? key}
          running={running}
          comment={chat && chat.status === "ready" ? (text) => chat.send(text) : undefined}
          agentReview={chat && key.startsWith("codex/") ? chat.review : undefined}
          toast={(t) => s.toast({ tone: t.tone, text: t.text })}
          askMessage={(onSubmit) => setPrompt({ title: "Commit message", initial: "", onSubmit })}
          createPr={() => act({ type: "create-pr", key })}
        />
      );
    },
    usageHistory: <UsageHistory history={history} />,
    pools: <PoolsSection />,
    mcp: <McpHost toast={(t) => s.toast(t)} />,
    poolCount: s.pools.length,
    tools: <ToolsSlot />,
    settings: settingsSection,
  };

  return (
    <>
      <V3Window data={data} slots={slots} act={act} focus={focus} layout={localLayout} keys={keys} autoOpenLimits={getLimitAutoOpen()} />
      {chats.runners}
      <OverlayHost />
      <Toaster toasts={s.toasts} onDismiss={s.dismissToast} />
      {prompt && <PromptSheet req={prompt} onClose={() => setPrompt(null)} />}
    </>
  );
}

/** The main window, v3. */
export default function V3App() {
  const theme = useTheme();
  return (
    <AcRoot className="h-full" mode={theme.mode} style={theme.vars as CSSProperties}>
      <ASProvider initial={emptyViewModel()} load={loadViewModel} actions={allActions} onNoticesRead={setNotifLastRead}>
        <LangKeyed>
          <V3Frame theme={theme} />
        </LangKeyed>
      </ASProvider>
    </AcRoot>
  );
}
