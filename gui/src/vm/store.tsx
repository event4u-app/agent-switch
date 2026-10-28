/**
 * The redesign store (bundle `bm`/`useAS`, bundle.pretty L5424–5437): one
 * context holding the view model plus navigation (`go`), the single overlay
 * slot (`open`/`close`), `update`, toasts and the `act` backend seam.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Actions } from "./actions.js";
import type { ViewModel } from "./types.js";

export type Screen = "home" | "sessions" | "accounts" | "tools" | "activity" | "health" | "settings";
export type SettingsTab =
  | "general"
  | "sign-ins"
  | "protection"
  | "distribution"
  | "notifications"
  | "pet"
  | "providers"
  | "updates"
  | "advanced";
export type AccountsTab = "accounts" | "history" | "projects";
export type ToolsTab = "tools" | "apps";

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
}

export type Overlay =
  | { kind: "none" }
  | { kind: "session"; id: string }
  | { kind: "account"; id: string }
  | { kind: "start"; cwd?: string; tool?: string; accountId?: string }
  | { kind: "add-account"; tool?: string }
  | { kind: "limit"; attentionId: string }
  | { kind: "notifications" }
  | { kind: "reauth"; accountId: string }
  | { kind: "fix"; checkId: string }
  | { kind: "terminal"; toolId: string; action: "install" | "update" }
  | ({ kind: "confirm" } & ConfirmRequest);

export interface Toast {
  id: number;
  text: string;
  tone?: "info" | "ok" | "warn" | "alert";
  action?: { label: string; run: () => void };
}

export interface Store extends ViewModel {
  screen: Screen;
  settingsTab: SettingsTab;
  accountsTab: AccountsTab;
  setAccountsTab: (t: AccountsTab) => void;
  toolsTab: ToolsTab;
  setToolsTab: (t: ToolsTab) => void;
  go: (screen: Screen, settingsTab?: SettingsTab) => void;
  overlay: Overlay;
  open: (o: Overlay) => void;
  close: () => void;
  act: Actions;
  accountById: (id: string) => ViewModel["accounts"][number] | undefined;
  markNoticesRead: () => void;
  update: (patch: Partial<ViewModel> | ((vm: ViewModel) => Partial<ViewModel>)) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  /** Re-read everything from the CLI; no-op when the provider has no loader. */
  reload: () => Promise<void>;
  loading: boolean;
}

const StoreContext = createContext<Store | null>(null);

const TOAST_MS = 6000;
const MAX_TOASTS = 3;
const CLOCK_MS = 30_000;

export interface ASProviderProps {
  initial: ViewModel;
  /** Builds the store's `act` from a reload callback and a view-model getter. */
  actions?: (getVm: () => ViewModel, reload: () => Promise<void>) => Actions;
  load?: () => Promise<ViewModel>;
  onNoticesRead?: (at: number) => void;
  startScreen?: Screen;
  startOverlay?: Overlay;
  startSettingsTab?: SettingsTab;
  startToolsTab?: ToolsTab;
  startAccountsTab?: AccountsTab;
  children: ReactNode;
}

export function ASProvider({
  initial,
  actions,
  load,
  onNoticesRead,
  startScreen = "home",
  startOverlay = { kind: "none" },
  startSettingsTab = "general",
  startToolsTab = "tools",
  startAccountsTab = "accounts",
  children,
}: ASProviderProps) {
  const [vm, setVm] = useState<ViewModel>(initial);
  const [screen, setScreen] = useState<Screen>(startScreen);
  const [overlay, setOverlay] = useState<Overlay>(startOverlay);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(startSettingsTab);
  const [accountsTab, setAccountsTab] = useState<AccountsTab>(startAccountsTab);
  const [toolsTab, setToolsTab] = useState<ToolsTab>(startToolsTab);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loading, setLoading] = useState(false);
  const toastSeq = useRef(0);
  const vmRef = useRef(vm);
  vmRef.current = vm;

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++toastSeq.current;
      setToasts((ts) => [...ts.slice(-(MAX_TOASTS - 1)), { ...t, id }]);
      window.setTimeout(() => dismissToast(id), TOAST_MS);
    },
    [dismissToast],
  );

  const reload = useCallback(async () => {
    if (!load) return;
    setLoading(true);
    try {
      setVm(await load());
    } catch (e) {
      setVm((prev) => ({ ...prev, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setLoading(false);
    }
  }, [load]);

  const act = useMemo<Actions>(() => (actions ? actions(() => vmRef.current, reload) : {}), [actions, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const t = window.setInterval(() => setVm((prev) => ({ ...prev, now: Date.now() })), CLOCK_MS);
    return () => window.clearInterval(t);
  }, []);

  const store = useMemo<Store>(
    () => ({
      ...vm,
      screen,
      settingsTab,
      accountsTab,
      setAccountsTab,
      toolsTab,
      setToolsTab,
      go: (s, tab) => {
        setScreen(s);
        if (tab) setSettingsTab(tab);
        setOverlay({ kind: "none" });
      },
      overlay,
      open: setOverlay,
      close: () => setOverlay({ kind: "none" }),
      act,
      accountById: (id) => vm.accounts.find((a) => a.id === id),
      markNoticesRead: () => {
        setVm((prev) => ({ ...prev, notices: prev.notices.map((n) => ({ ...n, unread: false })) }));
        onNoticesRead?.(Date.now());
      },
      update: (patch) => setVm((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) })),
      toasts,
      toast,
      dismissToast,
      reload,
      loading,
    }),
    [vm, screen, settingsTab, accountsTab, toolsTab, overlay, act, toasts, toast, dismissToast, reload, loading, onNoticesRead],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useAS(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useAS() outside <ASProvider>");
  return s;
}
