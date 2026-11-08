/**
 * The v3 Sessions window, assembled (spec §4–§10): frame, the three zones,
 * the workbench with page and session tabs, the right tool windows and the
 * overlays. Data comes in as `V3Data`, the 2.11 screens that v3 keeps come in
 * as `slots`, and every action leaves through one `act` callback, so the
 * window owns layout state only — never a session, an account or a file.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { ArrowRightToLine, Copy, Ellipsis, FileCode, Layers, Library, ListTree, Pin, PinOff, Plus, RotateCcw, Settings, Wrench, X } from "lucide-react";
import { Button, IconButton } from "../ui/Button.js";
import { Kbd } from "../ui/Typography.js";
import type { IdentityColor, ToolEntry } from "../vm/types.js";
import { DecisionSheet, NewSessionDialog, type MoveHow, type NewSessionFacts, type NewSessionPlan, type SheetMove, type SheetSession } from "./dialogs.js";
import { Shell, useFrame, type PageId } from "./frame.js";
import { LimitsPopover, LimitsStrip, RoomLeft, type LimitAccount } from "./limits.js";
import { RunningOn, runningOn } from "./running-on.js";

/** The model popover opened from the limits popover sits to its right (352 + 320 + 12 + 11). */
const LIMITS_MODEL_X = 695;
import { NeedsZone, type AwayDigest, type NeedItem } from "./needs.js";
import { limitToOpen, markLimitOpened, openedLimits, wasOpened } from "./adapter/limit-auto.js";
import { accountOfKey } from "../vm/switch-requests.js";
import { InboxPopover, Palette, PeekCard, type DoneItem, type PaletteEntry } from "./overlays.js";
import { AccountsPage, AllSessionsPage, LibraryPage, type AccountsView, type LibraryRow, type PageAccount, type TableSession } from "./pages.js";
import { ChangesWindow, ChildrenWindow, SummaryWindow, type ChangedFile, type SummaryFacts } from "./panels.js";
import { SessionsZone, childNoun, type RowSession } from "./sessions.js";
import { AgentsSettings, AppearanceSettings, OpenInSettings, RemoteSettings, SettingsPage, type AgentRowView, type AgentSuggestionView, type OpenTarget, type SettingsSection } from "./settings.js";
import type { Appearance } from "./themes/resolve.js";
import { updateNeeds } from "./tools.js";
import { BlockerStrip, HintStrip, ModelPopover, SessionBar, SystemBanner, TabStrip, engineDownText, type BarSession, type ModelChoices, type TabItem } from "./workbench.js";
import { Act, type BatchActions } from "./kit.js";
import { Anchored, Menu, OpenInButton, OpenInMenu, POPOVER_TRIGGER, monogram, type MenuItem, type OpenFacts, type OpenPick } from "./menus.js";
import { startTabs, type LayoutStore } from "./layout.js";
import { actionFor, DEFAULT_KEYS, label as keyLabel, type Action, type Binding } from "./keys.js";
import { EMPTY_TABS, canReopen, closable, closeOthers, closeTab, closeToRight, closeUnpinned, isPageTab, moveTab, nextActive, openTab, pinTab, reopenTab, seedTabs, unpinTab, type TabState } from "./tabs.js";
import { nextFocus } from "./needs.js";
import { Switcher } from "./overlays.js";
import { GROUP_LABEL, SORT_LABEL, liveOrder, type GroupBy, type SortBy } from "./sessions.js";

export interface V3Data {
  nowMs: number;
  health: { state: "ready" } | { state: "down"; sinceMs: number; hostedRunning: number; elsewhere?: true };
  needs: NeedItem[];
  away: AwayDigest | null;
  history: DoneItem[];
  sessions: RowSession[];
  limits: LimitAccount[];
  accounts: PageAccount[];
  table: TableSession[];
  library: LibraryRow[];
  vaultBytes: number;
  autoKeep: boolean;
  tools: ToolEntry[];
  palette: PaletteEntry[];
  appearance: Appearance;
  prefersDark: boolean;
  openIn: { targets: OpenTarget[]; defaultTarget: string | null; lastUsed: string | null; perRepo: Record<string, string>; focusTerminal: boolean; agentApps: { id: string; label: string; tool: string }[]; terminal?: string | null; terminals?: { id: string; name: string; installed: boolean }[] };
  /** Settings › Agents (v3.2). */
  agents: { rows: AgentRowView[]; suggestions: AgentSuggestionView[] };
  /** Settings › Remote (v3.2): R1 accounts and the SSH stage. */
  remote: { remoteControl: string[]; ssh: boolean };
  newSession: { initial: NewSessionPlan; facts: NewSessionFacts };
  /** The question shared with agent-config (road-to-the-agent-config-link):
   *  open requests it raised, and accounts ("claude/work") whose limit was
   *  already answered outside the app this cycle. */
  link?: { asked: { id: string; account: string }[]; answered: string[] };
  /** The near-limit decision, by account key ("claude/work") or by session key — a limit item's subject is either. */
  decision: (subject: string) => { account: string; tool?: string; targets?: { name: string; color: IdentityColor }[]; pctUsed: number; window: string; resetsIn: string; sessions: SheetSession[]; suggestion: string; suggestionWhy?: string; askedByAgentConfig?: boolean } | null;
  bar: (key: string) => BarSession | null;
  /** What the model popover offers for a session; absent: the chips stay closed. */
  models?: (key: string) => ModelChoices | null;
  summary: (key: string) => SummaryFacts | null;
  changes: (key: string) => ChangedFile[];
  next: (key: string) => { text: string; action: string } | null;
  /** The session-menu entries that do something for this session; all when absent. */
  menu?: (key: string) => readonly SessionMenuItem[];
  /** "Commit…" in the Changes window; disabled with its reason when false. */
  commitAvailable?: boolean;
  /** The first read has not settled yet: empty lists are "not read yet", so no empty state is shown. */
  loading?: boolean;
}

export interface V3Slots {
  /** The session body: the hosted terminal or the user's-own-terminal view. */
  body: (key: string) => ReactNode;
  usageHistory: ReactNode;
  pools: ReactNode;
  poolCount: number;
  /** Accounts › MCP & plugins (v3.1). */
  mcp?: ReactNode;
  tools: ReactNode;
  /** v3.1: the Review page of one session (spec §10.9). Absent: Review and Commit stay disabled. */
  review?: (key: string) => ReactNode;
  /** The 2.11 settings screens v3 keeps, by section. */
  settings: (section: SettingsSection) => ReactNode;
}

export type V3Action =
  | { type: "need"; item: NeedItem }
  | { type: "reveal" }
  | { type: "need-more" }
  | { type: "need-later"; id: string }
  | { type: "away" }
  | { type: "needs-later-all" }
  | { type: "start"; plan: NewSessionPlan }
  | { type: "choose-account" }
  | { type: "move"; how: MoveHow; moves: SheetMove[] }
  | { type: "keep-account"; account: string }
  | { type: "session-menu"; key: string; item: SessionMenuItem }
  | { type: "batch"; op: keyof BatchActions; keys: string[] }
  | { type: "clean-up" }
  | { type: "view"; key: string; view: "terminal" | "chat" }
  | { type: "open-in"; key: string; pick: Exclude<OpenPick, { kind: "configure" }> | { kind: "default" } }
  | { type: "set-model"; key: string; model: string }
  | { type: "set-thinking"; key: string; level: string }
  | { type: "blocker"; key: string }
  | { type: "create-pr" | "open-pr" | "review" | "commit"; key: string }
  | { type: "account"; op: "add" | "refresh" | "use" | "sign-in" | "terminal" | "more"; key?: string }
  | { type: "library"; op: "auto-keep"; value: boolean }
  | { type: "library"; op: "pin" | "archive"; key: string; value: boolean }
  | { type: "library"; op: "resume"; key: string }
  | { type: "palette"; entry: PaletteEntry; newTab: boolean }
  | { type: "appearance"; value: Appearance }
  | { type: "open-default"; target: string; repo?: string }
  | { type: "open-terminal"; id: string }
  | { type: "focus-terminal-setting"; value: boolean }
  | { type: "agent-enabled"; id: string; value: boolean }
  | { type: "agent-install"; id: string }
  | { type: "remote-rc"; account: string; value: boolean }
  | { type: "remote-ssh"; value: boolean }
  | { type: "restart-engine" };

export const SESSION_MENU = ["Rename…", "Pin", "Move to another account…", "Take over here…", "Hand off…", "Compact", "Detach", "End…"] as const;
export type SessionMenuItem = (typeof SESSION_MENU)[number];

type Page = PageId | "sessions-table" | `review:${string}`;
const PAGE_TAB: Record<PageId | "sessions-table", { label: string; icon: ReactNode }> = {
  accounts: { label: "Accounts", icon: <Layers className="size-3.5" /> },
  library: { label: "Library", icon: <Library className="size-3.5" /> },
  tools: { label: "Tools", icon: <Wrench className="size-3.5" /> },
  settings: { label: "Settings", icon: <Settings className="size-3.5" /> },
  "sessions-table": { label: "All sessions", icon: <ListTree className="size-3.5" /> },
};

/** A page id the window can (re)open: a known page, or the review of a session that still exists. */
function isKnownPage(p: string, sessions: ReadonlySet<string>): boolean {
  return p in PAGE_TAB || (p.startsWith("review:") && sessions.has(p.slice(7)));
}

/** A window point in the shell's coordinates, kept so a menu `width` wide stays inside. */
function shellPoint(at: { x: number; y: number }, width = 260): { x: number; y: number } {
  const r = typeof document !== "undefined" ? document.querySelector("[data-v3-shell]")?.getBoundingClientRect() : undefined;
  const x = at.x - (r?.left ?? 0);
  const y = at.y - (r?.top ?? 0);
  return { x: r && r.width ? Math.max(4, Math.min(x, r.width - width - 4)) : x, y };
}

/** The session actions a tab's menu repeats; "Pin" stays in the session's own menu (it pins in the list, not the tab). */
const TAB_SESSION_ITEMS: readonly SessionMenuItem[] = ["Rename…", "Move to another account…", "Hand off…", "Detach", "End…"];

/** The palette's own commands: pages the window can open (spec §7.1). */
export const PAGE_COMMANDS: PaletteEntry[] = [
  { id: "page:sessions-table", group: "commands", title: "All sessions", meta: "every session, filter and batch" },
  { id: "page:accounts", group: "commands", title: "Accounts" },
  { id: "page:library", group: "commands", title: "Library" },
  { id: "page:tools", group: "commands", title: "Tools" },
  { id: "page:settings", group: "commands", title: "Settings", hint: "⌘," },
];

/** ⌘ on macOS, Ctrl elsewhere (spec §12). */
const PLATFORM: "mac" | "other" = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent) ? "mac" : "other";

export function V3Window({
  data,
  slots,
  act,
  focus,
  layout,
  keys = DEFAULT_KEYS,
  platform = PLATFORM,
  autoOpenLimits = false,
}: {
  data: V3Data;
  slots: V3Slots;
  act: (a: V3Action) => void;
  focus?: { key: string; n: number };
  layout?: LayoutStore;
  keys?: Record<Action, Binding>;
  platform?: "mac" | "other";
  /** Open a limit's decision sheet by itself (the app passes the user's setting;
   *  spec §11's "never automatic" stays the component default). */
  autoOpenLimits?: boolean;
}) {
  const saved = useMemo(() => layout?.load() ?? null, [layout]);
  // Tab order, pins and the recently closed tabs (tabs.ts); page tabs are `page:<id>`.
  const [strip, setStrip] = useState<TabState>(EMPTY_TABS);
  const pages = strip.order.filter(isPageTab).map((id) => id.slice(5) as Page);
  const sessionTabs = strip.order.filter((id) => !isPageTab(id));
  const [active, setActive] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<null | "palette" | "inbox" | "new" | "sessions-menu" | { listView: number } | { switcher: number } | { limits: string } | { model: string; x: number; chip: "model" | "thinking"; at?: "limits" } | { decide: string } | { menu: string } | { openin: string } | { tabMenu: string; x: number; y: number }>(null);
  const [accountsView, setAccountsView] = useState<AccountsView>("accounts");
  const [section, setSection] = useState<SettingsSection>("General");
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [openKids, setOpenKids] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hintsDismissed, setHintsDismissed] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [comfortable, setComfortable] = useState(saved?.comfortable ?? false);
  const [sortBy, setSortBy] = useState<SortBy>(saved?.sort ?? "activity");
  // An older layout's "group by project" comes back as the project grouping.
  const [groupBy, setGroupBy] = useState<GroupBy>(saved?.group ?? (saved?.groupByProject ? "project" : "none"));
  const [pinnedOnly, setPinnedOnly] = useState(saved?.pinnedOnly ?? false);
  const [focusedNeed, setFocusedNeed] = useState<string | null>(null);
  // Hover peek (spec §5.2): after 400 ms on a row, one card at a time, never while a layer is open.
  const [peek, setPeek] = useState<{ key: string; y: number } | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const onPeek = (key: string | null, y: number) => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    // The active row already shows its facts in the workbench.
    if (!key || key === activeRef.current) return setPeek(null);
    peekTimer.current = setTimeout(() => setPeek({ key, y }), 400);
  };
  useEffect(() => () => void (peekTimer.current && clearTimeout(peekTimer.current)), []);

  const openPage = useCallback((p: Page) => {
    setStrip((cur) => openTab(cur, `page:${p}`));
    setActive(`page:${p}`);
  }, []);
  const frame = useFrame(openPage);
  const openSession = (key: string) => {
    setStrip((cur) => openTab(cur, key));
    setActive(key);
  };
  // The window opens where the user left off, else on the first live session;
  // once, when the sessions are first known (they arrive after the first paint).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !data.sessions.length) return;
    started.current = true;
    if (active) return;
    const s = startTabs(saved, data.sessions);
    // Pinned tabs come back too, pages included; a pinned session that ended does not.
    const known = new Set(data.sessions.map((x) => x.key));
    const pins = (saved?.pinned ?? []).filter((id) => (isPageTab(id) ? isKnownPage(id.slice(5), known) : s.tabs.includes(id)));
    setStrip((cur) => seedTabs(cur, [...pins.filter(isPageTab), ...s.tabs], pins));
    setActive(s.active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.sessions]);
  useEffect(() => {
    if (started.current) layout?.save({ tabs: sessionTabs, pinned: strip.pinned, active: active?.startsWith("page:") ? null : active, comfortable, pinnedOnly, sort: sortBy, group: groupBy });
    // sessionTabs is derived from strip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, strip, active, comfortable, pinnedOnly, sortBy, groupBy]);

  /** Apply a change to the strip; when the active tab leaves, its neighbour takes over. */
  const changeStrip = (f: (s: TabState) => TabState) => {
    const next = f(strip);
    if (next === strip) return;
    setStrip(next);
    setActive(nextActive(strip.order, next.order, active ?? "", active));
  };
  const reopenClosed = (): boolean => {
    const known = new Set(data.sessions.map((x) => x.key));
    const r = reopenTab(strip, (id) => (isPageTab(id) ? isKnownPage(id.slice(5), known) : known.has(id)));
    setStrip(r.state);
    if (r.id) setActive(r.id);
    return !!r.id;
  };
  /** Right click on a tab (owner request 2026-11-05): pin, the close family, reopen, and the session's own actions. */
  const tabMenuItems = (id: string): MenuItem[] => {
    const pinnedTab = strip.pinned.includes(id);
    const after = strip.order.slice(strip.order.indexOf(id) + 1);
    const run = (f: () => void) => () => (setOverlay(null), f());
    const items: MenuItem[] = [
      pinnedTab
        ? { id: "unpin", label: "Unpin tab", icon: <PinOff />, onClick: run(() => setStrip((s) => unpinTab(s, id))) }
        : { id: "pin", label: "Pin tab", icon: <Pin />, onClick: run(() => setStrip((s) => pinTab(s, id))) },
      { divider: true, label: "" },
      { id: "close", label: pinnedTab ? "Close pinned tab" : "Close tab", icon: <X />, onClick: run(() => changeStrip((s) => closeTab(s, id, true))) },
      { id: "close-others", label: "Close other tabs", disabled: !closable(strip, strip.order.filter((x) => x !== id)).length, onClick: run(() => changeStrip((s) => closeOthers(s, id))) },
      { id: "close-right", label: "Close tabs to the right", icon: <ArrowRightToLine />, disabled: !closable(strip, after).length, onClick: run(() => changeStrip((s) => closeToRight(s, id))) },
      { id: "close-unpinned", label: "Close all unpinned tabs", disabled: !closable(strip, strip.order).length, onClick: run(() => changeStrip(closeUnpinned)) },
      { divider: true, label: "" },
      { id: "reopen", label: "Reopen closed tab", icon: <RotateCcw />, kbd: keyLabel(keys.reopenTab, platform), disabled: !canReopen(strip), onClick: run(() => void reopenClosed()) },
    ];
    if (isPageTab(id)) return items;
    const offered = new Set<string>(data.menu ? data.menu(id) : SESSION_MENU);
    return [
      ...items,
      { divider: true, label: "" },
      { id: "copy-key", label: "Copy session key", icon: <Copy />, onClick: run(() => void navigator.clipboard?.writeText(id).catch(() => undefined)) },
      ...TAB_SESSION_ITEMS.filter((item) => offered.has(item)).map(
        (item): MenuItem => ({
          id: `session:${item}`,
          label: item,
          danger: item === "End…",
          onClick: run(() => (item === "Move to another account…" ? setOverlay({ decide: id }) : act({ type: "session-menu", key: id, item }))),
        }),
      ),
    ];
  };

  // The app opens a tab itself: a new chat, a Needs-you item that lives in a chat.
  useEffect(() => {
    if (focus) openSession(focus.key);
    // focus.n is the request; the key alone repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  // Tool updates join the queue (spec §10.4); limit items open the decision sheet.
  const needs = useMemo(() => [...data.needs, ...updateNeeds(data.tools, new Date(data.nowMs).toISOString())], [data.needs, data.tools, data.nowMs]);
  // A session at its limit opens its decision sheet by itself (once per item
  // version) and brings the window forward — the user still confirms the move.
  // agent-config's question opens it too (once per request), and a limit it
  // already answered stays closed: one question, one answer for both tools.
  const answered = data.link?.answered ?? [];
  useEffect(() => {
    if (!autoOpenLimits || overlay !== null) return;
    const hasSessions = (subject: string) => (data.decision(subject)?.sessions.length ?? 0) > 0;
    const opened = openedLimits();
    const n = limitToOpen(needs, opened, (subject) => !answered.includes(accountOfKey(subject)) && hasSessions(subject));
    const asked = n ? null : (data.link?.asked ?? []).find((r) => !wasOpened(opened, { id: "request", version: r.id }) && hasSessions(r.account));
    if (!n && !asked) return;
    markLimitOpened(n ?? { id: "request", version: asked!.id });
    setOverlay({ decide: n ? n.subject : asked!.account });
    act({ type: "reveal" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needs, overlay, autoOpenLimits, data.link]);
  // Answered in agent-config while the sheet is open: the sheet has nothing left to ask.
  useEffect(() => {
    if (typeof overlay === "object" && overlay !== null && "decide" in overlay && answered.includes(accountOfKey(overlay.decide))) setOverlay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.link, overlay]);

  const onVerb = (n: NeedItem) => {
    if (n.kind === "limit" || n.kind === "pace") setOverlay({ decide: n.subject });
    else if (n.kind === "update") openPage("tools");
    else if ((n.kind === "approval" || n.kind === "question") && data.bar(n.subject)?.hosted) openSession(n.subject);
    else act({ type: "need", item: n });
  };

  const activeSession = active && !active.startsWith("page:") ? active : null;
  const bar = activeSession ? data.bar(activeSession) : null;
  const next = activeSession && !dismissed.has(activeSession) ? data.next(activeSession) : null;
  const tabs: TabItem[] = strip.order.map((id): TabItem => {
    if (isPageTab(id)) {
      const p = id.slice(5) as Page;
      return {
        kind: "page" as const,
        id,
        ...(p.startsWith("review:")
          ? { label: `Review · ${data.sessions.find((x) => x.key === p.slice(7))?.title ?? p.slice(7)}`, icon: <FileCode className="size-3.5" /> }
          : PAGE_TAB[p as PageId | "sessions-table"]),
      };
    }
    const s = data.sessions.find((x) => x.key === id);
    return { kind: "session" as const, id, title: s?.title ?? id, state: s?.state ?? "idle" };
  });
  const batch = (keys: string[]): BatchActions => ({
    onClear: () => setSelection(null),
    onPin: () => act({ type: "batch", op: "onPin", keys }),
    onArchive: () => act({ type: "batch", op: "onArchive", keys }),
    onClean: () => act({ type: "batch", op: "onClean", keys }),
    onEnd: () => act({ type: "batch", op: "onEnd", keys }),
  });

  const page = (p: Page): ReactNode => {
    if (p.startsWith("review:")) return slots.review ? slots.review(p.slice(7)) : null;
    if (p === "accounts")
      return (
        <AccountsPage
          accounts={data.accounts}
          nowMs={data.nowMs}
          nextRefreshMs={null}
          view={accountsView}
          onView={setAccountsView}
          history={slots.usageHistory}
          pools={slots.pools}
          poolCount={slots.poolCount}
          mcp={slots.mcp}
          on={{ add: () => act({ type: "account", op: "add" }), refresh: () => act({ type: "account", op: "refresh" }), use: (key) => act({ type: "account", op: "use", key }), signIn: (key) => act({ type: "account", op: "sign-in", key }), terminal: (key) => act({ type: "account", op: "terminal", key }), more: (key) => act({ type: "account", op: "more", key }) }}
        />
      );
    if (p === "library")
      return (
        <LibraryPage
          rows={data.library}
          vaultBytes={data.vaultBytes}
          autoKeep={data.autoKeep}
          nowMs={data.nowMs}
          on={{ autoKeep: (value) => act({ type: "library", op: "auto-keep", value }), pin: (key, value) => act({ type: "library", op: "pin", key, value }), resume: (key) => act({ type: "library", op: "resume", key }), archive: (key, value) => act({ type: "library", op: "archive", key, value }) }}
        />
      );
    if (p === "sessions-table") return <AllSessionsPage sessions={data.table} nowMs={data.nowMs} onOpen={openSession} batch={batch} />;
    if (p === "tools") return slots.tools;
    return (
      <SettingsPage current={section} onSection={setSection}>
        {section === "Appearance" ? (
          <AppearanceSettings a={data.appearance} prefersDark={data.prefersDark} onChange={(value) => act({ type: "appearance", value })} />
        ) : section === "Open in" ? (
          <OpenInSettings {...data.openIn} on={{ setDefault: (target, repo) => act({ type: "open-default", target, repo }), setTerminal: (id) => act({ type: "open-terminal", id }), focusTerminal: (value) => act({ type: "focus-terminal-setting", value }) }} />
        ) : section === "Agents" ? (
          <AgentsSettings agents={data.agents.rows} suggestions={data.agents.suggestions} on={{ toggle: (id, value) => act({ type: "agent-enabled", id, value }), install: (id) => act({ type: "agent-install", id }) }} />
        ) : section === "Remote" ? (
          <RemoteSettings claudeAccounts={data.accounts.filter((a) => a.tool === "claude").map((a) => a.name)} remoteControl={data.remote.remoteControl} ssh={data.remote.ssh} on={{ rc: (account, value) => act({ type: "remote-rc", account, value }), ssh: (value) => act({ type: "remote-ssh", value }) }} />
        ) : (
          slots.settings(section)
        )}
      </SettingsPage>
    );
  };

  const openFacts = (key: string): OpenFacts => {
    const tool = key.split("/")[0];
    const app = data.openIn.agentApps.find((a) => a.tool === tool);
    const pr = data.summary(key)?.pr;
    return {
      targets: data.openIn.targets,
      defaultTarget: data.openIn.defaultTarget,
      lastUsed: data.openIn.lastUsed,
      agentApp: app ? { id: app.id, label: app.label } : null,
      pr: pr ? { number: pr.number, url: pr.url } : null,
      focusable: !data.bar(key)?.hosted,
    };
  };
  const openDefault = (key: string) => act({ type: "open-in", key, pick: { kind: "default" } });
  const defTarget = data.openIn.targets.find((t) => t.installed && t.target === data.openIn.defaultTarget) ?? null;
  // The v3 keyboard (spec §12): one listener; app keys never take a key the CLI
  // needs while the terminal has focus (keys.ts).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    const inTerminal = !!(document.activeElement as HTMLElement | null)?.closest?.("[data-terminal]");
    const typing = !inTerminal && /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement as HTMLElement | null)?.tagName ?? "");
    const focused = focusedNeed ? needs.find((n) => n.id === focusedNeed) : undefined;
    if (focused && !typing && !inTerminal && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // A focused Needs-you item answers to its own keys (spec §5.1).
      if (e.key === "Enter" && !e.shiftKey) return void (e.preventDefault(), setFocusedNeed(null), onVerb(focused));
      if (e.key.toLowerCase() === "l") return void (e.preventDefault(), setFocusedNeed(nextFocus(needs.filter((n) => n.id !== focused.id), focused.id)), act({ type: "need-later", id: focused.id }));
    }
    const a = actionFor(e, keys, platform, inTerminal);
    if (!a || (typing && a !== "close" && a !== "palette")) return;
    const recent = sessionTabs.length ? sessionTabs : liveOrder(data.sessions).map((s) => s.key);
    const handled = ((): boolean => {
      switch (a) {
        case "palette":
          return (setOverlay("palette"), true);
        case "newSession":
          return (setOverlay("new"), true);
        case "nextNeed": {
          const id = nextFocus(needs, focusedNeed);
          if (!id) return false;
          frame.setSessionsShown(true);
          return (setFocusedNeed(id), true);
        }
        case "toggleSessions":
          return (frame.selectLeft("sessions"), true);
        case "toggleSummary":
          return (frame.selectRight("summary"), true);
        case "openDefault":
          return activeSession ? (openDefault(activeSession), true) : false;
        case "moveSession":
          return activeSession ? (setOverlay({ decide: activeSession }), true) : false;
        case "switcher":
          return recent.length ? (setOverlay((o) => ({ switcher: o && typeof o === "object" && "switcher" in o ? (o.switcher + 1) % recent.length : Math.min(1, recent.length - 1) })), true) : false;
        case "settings":
          return (openPage("settings"), true);
        case "close":
          if (!overlay && !selection && !focusedNeed) return false;
          return (setOverlay(null), setSelection(null), setFocusedNeed(null), true);
        case "stopTurn":
          return false;
        case "reopenTab":
          return reopenClosed();
        default: {
          const key = sessionTabs[Number(a.slice(3)) - 1];
          return key ? (setActive(key), true) : false;
        }
      }
    })();
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    // Releasing ⌃ picks the session the switcher points at.
    const up = (e: KeyboardEvent) => {
      if (e.key === "Control") switcherUp.current();
    };
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", up);
    return () => (window.removeEventListener("keydown", on), window.removeEventListener("keyup", up));
  }, []);
  const switcherUp = useRef<() => void>(() => undefined);
  const recentKeys = sessionTabs.length ? sessionTabs : liveOrder(data.sessions).map((s) => s.key);
  switcherUp.current = () => {
    if (overlay && typeof overlay === "object" && "switcher" in overlay) {
      const key = recentKeys[overlay.switcher];
      setOverlay(null);
      if (key) openSession(key);
    }
  };

  const openMenuOf = overlay && typeof overlay === "object" && "openin" in overlay ? overlay.openin : null;

  // Under the session bar: it belongs to the body (gap §4e); its one action restarts the engine.
  const engineBanner = data.health.state === "down" && (
    <SystemBanner
      action={
        <Act kind="accent" onClick={() => act({ type: "restart-engine" })}>
          {data.health.elsewhere ? "Move service here" : "Restart engine"}
        </Act>
      }
    >
      {engineDownText(data.health.sinceMs, data.nowMs, data.health.hostedRunning, data.health.elsewhere)}
    </SystemBanner>
  );

  const centre = (
    <section className="flex min-w-0 flex-1 flex-col bg-ac-bg">
      <TabStrip
        tabs={tabs}
        activeId={active ?? ""}
        onSelect={setActive}
        // A session tab only leaves the strip; the session keeps running in the sidebar (spec §6.1).
        onClose={(id) => changeStrip((s) => closeTab(s, id))}
        pinned={new Set(strip.pinned)}
        onMenu={(id, at) => setOverlay({ tabMenu: id, ...shellPoint(at) })}
        onMove={(id, target, side) => setStrip((s) => moveTab(s, id, target, side))}
      />
      {!(activeSession && bar) && engineBanner}
      {active?.startsWith("page:") ? (
        page(active.slice(5) as Page)
      ) : activeSession && bar ? (
        <>
          <SessionBar
            s={bar}
            chipOpen={overlay && typeof overlay === "object" && "chip" in overlay ? overlay.chip : null}
            openIn={
              data.openIn.targets.length ? (
                <OpenInButton
                  def={defTarget && { label: defTarget.label, mono: monogram(defTarget.target, defTarget.label) }}
                  open={openMenuOf === activeSession}
                  onDefault={() => openDefault(activeSession)}
                  onMenu={() => setOverlay((o) => (o && typeof o === "object" && "openin" in o ? null : { openin: activeSession }))}
                />
              ) : null
            }
            on={{ view: (view) => act({ type: "view", key: activeSession, view }), account: () => setOverlay({ decide: activeSession }), model: (x) => setOverlay((o) => (o && typeof o === "object" && "chip" in o && o.chip === "model" ? null : { model: activeSession, x, chip: "model" })), thinking: (x) => setOverlay((o) => (o && typeof o === "object" && "chip" in o && o.chip === "thinking" ? null : { model: activeSession, x, chip: "thinking" })), menu: () => setOverlay({ menu: activeSession }) }}
          />
          {engineBanner}
          <HintStrip
            s={bar}
            dismissed={hintsDismissed}
            onDismiss={(k) => setHintsDismissed((d) => new Set([...d, k]))}
            onAction={(h) => (h.action?.kind === "switch" ? setOverlay({ decide: activeSession }) : act({ type: "session-menu", key: activeSession, item: "Compact" }))}
          />
          {next && <BlockerStrip text={next.text} action={next.action} summaryOpen={frame.right === "summary"} onAction={() => act({ type: "blocker", key: activeSession })} onDismiss={() => setDismissed((d) => new Set([...d, activeSession]))} />}
          {slots.body(activeSession)}
        </>
      ) : data.sessions.length === 0 && data.loading ? (
        // First read still running: an empty list is not "no sessions" yet.
        <div className="flex-1" aria-busy="true" />
      ) : data.sessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-[520px] max-w-full px-6 text-center">
            <h2 className="text-[16px] font-semibold text-ac-text">No sessions yet</h2>
            <p className="mt-1 text-[13px] text-ac-muted">
              Start one here, or run <span className="font-ac-mono">claude</span> in your terminal — it shows up on its own.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="primary" size="sm" onClick={() => setOverlay("new")}>
                <Plus className="size-3.5" /> Start session <Kbd className="border-transparent bg-transparent text-ac-on-color">⌘N</Kbd>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openPage("library")}>
                Open Library
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-ac-muted">Pick a session, or start one with ⌘N.</div>
      )}
    </section>
  );

  const rightWindow = (() => {
    if (!activeSession) return null;
    if (frame.right === "summary") {
      const f = data.summary(activeSession);
      return f && <SummaryWindow f={f} onNext={() => act({ type: "blocker", key: activeSession })} onCreatePr={() => act({ type: "create-pr", key: activeSession })} onOpenPr={() => act({ type: "open-pr", key: activeSession })} onHide={() => frame.setRight(null)} moreOpen={moreOpen} onToggleMore={() => setMoreOpen((v) => !v)} />;
    }
    if (frame.right === "changes") return <ChangesWindow files={data.changes(activeSession)} reviewAvailable={!!slots.review} commitAvailable={data.commitAvailable ?? true} onReview={() => (slots.review ? openPage(`review:${activeSession}`) : act({ type: "review", key: activeSession }))} onCommit={() => (slots.review ? openPage(`review:${activeSession}`) : act({ type: "commit", key: activeSession }))} onHide={() => frame.setRight(null)} />;
    const s = data.sessions.find((x) => x.key === activeSession);
    return s && <ChildrenWindow noun={childNoun(s)} children={s.children} onHide={() => frame.setRight(null)} />;
  })();

  const modelOf = overlay && typeof overlay === "object" && "model" in overlay ? overlay.model : null;
  const modelChoices = modelOf ? (data.models?.(modelOf) ?? null) : null;
  const limitsOpen = overlay && typeof overlay === "object" && "limits" in overlay ? overlay.limits : null;
  const limitsAccount = limitsOpen ? data.limits.find((a) => a.key === limitsOpen) : undefined;
  const peekFacts = (key: string) => {
    const s = data.sessions.find((x) => x.key === key);
    const t = data.table.find((x) => x.key === key);
    if (!s || !t) return null;
    return { title: s.title, state: s.state, lastActiveMs: t.lastActiveMs, tool: t.tool[0].toUpperCase() + t.tool.slice(1), account: t.account.name, color: t.account.color, model: t.model, thinking: t.thinking, branch: t.branch, pr: s.pr ? { number: s.pr.number, state: s.pr.ci === "FAILURE" ? "CI failing" : "open" } : null, children: s.children.reduce((n, c) => n + (c.count ?? 1), 0), lastLine: null };
  };
  const pinned = new Set(data.library.filter((l) => l.pinned).map((l) => l.key));
  const sessionsWindow = (
    <aside aria-label="Sessions window" data-loaded={data.loading ? "false" : "true"} aria-busy={data.loading || undefined} className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-ac-line bg-ac-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ac-line px-3">
        <span className="text-[12px] font-semibold text-ac-text">Sessions</span>
        <span className="ml-auto flex items-center">
          <IconButton label="New session  ⌘N" className="size-7" onClick={() => setOverlay("new")}>
            <Plus />
          </IconButton>
          <IconButton {...POPOVER_TRIGGER} label="Select · density · show pinned" aria-expanded={overlay === "sessions-menu"} className="size-7" onClick={() => setOverlay((o) => (o === "sessions-menu" ? null : "sessions-menu"))}>
            <Ellipsis />
          </IconButton>
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-2">
        <NeedsZone items={needs} away={data.away} focusedId={focusedNeed} onVerb={onVerb} onMore={() => setOverlay("inbox")} onAway={() => act({ type: "away" })} />
        <SessionsZone
          sessions={pinnedOnly ? data.sessions.filter((x) => pinned.has(x.key)) : data.sessions}
          activeKey={activeSession}
          comfortable={comfortable}
          sort={sortBy}
          group={groupBy}
          lastActiveOf={(k) => data.table.find((t) => t.key === k)?.lastActiveMs ?? null}
          groupOf={(k) => {
            const t = data.table.find((x) => x.key === k);
            if (!t) return null;
            return groupBy === "project" ? (t.project ?? null) : groupBy === "account" ? t.account.name : groupBy === "tool" ? t.tool[0].toUpperCase() + t.tool.slice(1) : null;
          }}
          onView={(y) => setOverlay((o) => (o && typeof o === "object" && "listView" in o ? null : { listView: y }))}
          viewOpen={!!overlay && typeof overlay === "object" && "listView" in overlay}
          onStart={() => setOverlay("new")}
          loading={data.loading}
          onPeek={onPeek}
          divider={needs.length > 0 || !!data.away}
          selection={selection}
          openKeys={openKids}
          onSelect={openSession}
          onToggleChildren={(k) => setOpenKids((c) => (c.has(k) ? new Set([...c].filter((x) => x !== k)) : new Set([...c, k])))}
          onCheck={(k) => setSelection((c) => { const n = new Set(c ?? []); n.has(k) ? n.delete(k) : n.add(k); return n; })}
          onCleanUp={() => act({ type: "clean-up" })}
          onDoneToday={() => openPage("sessions-table")}
          batch={batch([...(selection ?? [])])}
        />
      </div>
      <LimitsStrip accounts={data.limits} nowMs={data.nowMs} openKey={limitsOpen} onOpen={(key) => setOverlay((o) => (o && typeof o === "object" && "limits" in o && o.limits === key ? null : { limits: key }))} onSignIn={(key) => act({ type: "account", op: "sign-in", key })} />
    </aside>
  );

  const decision = overlay && typeof overlay === "object" && "decide" in overlay ? data.decision(overlay.decide) : null;
  const close = () => setOverlay(null);
  const overlayNode =
    overlay === "palette" ? (
      <Palette
        entries={[...data.palette, ...PAGE_COMMANDS]}
        onClose={close}
        onOpen={(entry, newTab) => {
          close();
          if (entry.id.startsWith("page:")) openPage(entry.id.slice(5) as Page);
          else if (entry.group === "sessions") openSession(entry.id);
          else if (entry.group === "branches" && entry.id.startsWith("pr:")) openSession(entry.id.slice(3));
          else act({ type: "palette", entry, newTab });
        }}
      />
    ) : overlay === "inbox" ? (
      <Anchored onClose={close} className="absolute right-3 top-11 z-10">
        <InboxPopover items={needs} history={data.history} focusedId={null} nowMs={data.nowMs} onVerb={(n) => (close(), onVerb(n))} onAllLater={() => (close(), act({ type: "needs-later-all" }))} />
      </Anchored>
    ) : overlay === "new" ? (
      <NewSessionDialog initial={data.newSession.initial} facts={data.newSession.facts} onClose={close} onChooseAccount={() => act({ type: "choose-account" })} onStart={(plan) => (close(), act({ type: "start", plan }))} />
    ) : decision ? (
      <DecisionSheet {...decision} room={<RoomLeft accounts={data.limits.filter((a) => a.tool === (decision.tool ?? data.limits.find((l) => l.name === decision.account)?.tool))} nowMs={data.nowMs} />} onClose={close} onKeep={() => (close(), act({ type: "keep-account", account: decision.account }))} onDecide={(how, moves) => (close(), act({ type: "move", how, moves }))} />
    ) : overlay && typeof overlay === "object" && "switcher" in overlay ? (
      <Switcher
        pick={overlay.switcher}
        onClose={close}
        recent={recentKeys.flatMap((k) => {
          const s = data.sessions.find((x) => x.key === k);
          const b = data.bar(k);
          return s ? [{ key: k, title: s.title, state: s.state, account: s.account.name, color: b?.account.color ?? "blue", branch: s.branch, needsYou: s.needsYou }] : [];
        })}
      />
    ) : modelOf && modelChoices ? (
      <Anchored
        onClose={close}
        className={cn("absolute z-10", overlay && typeof overlay === "object" && "at" in overlay ? "bottom-[40px]" : "top-[124px]")}
        style={{ left: overlay && typeof overlay === "object" && "x" in overlay ? overlay.x - 11 : 0 }}
      >
        <ModelPopover c={modelChoices} onModel={(model) => (close(), act({ type: "set-model", key: modelOf, model }))} onThinking={(level) => (close(), act({ type: "set-thinking", key: modelOf, level }))} />
      </Anchored>
    ) : limitsAccount ? (
      // Anchored beside the Limits strip; it never switches anything by itself (spec §7.5).
      <Anchored onClose={close} className="absolute bottom-[40px] left-[352px] z-10">
        <LimitsPopover
          a={limitsAccount}
          nowMs={data.nowMs}
          onMove={() => setOverlay({ decide: limitsAccount.key })}
          onAccounts={() => (close(), openPage("accounts"))}
          running={
            <RunningOn
              name={limitsAccount.name}
              sessions={runningOn(limitsAccount, data.sessions).map((row) => {
                const b = data.bar(row.key);
                return { row, model: b?.model ?? null, thinking: b?.thinking ?? null, hosted: !!b?.hosted };
              })}
              onOpen={(key) => (close(), openSession(key))}
              onShowChild={(key) => (close(), openSession(key), frame.selectRight("children"))}
              onModel={(key, chip) => setOverlay({ model: key, x: LIMITS_MODEL_X, chip, at: "limits" })}
            />
          }
        />
      </Anchored>
    ) : overlay && typeof overlay === "object" && "listView" in overlay ? (
      // Beside the list, level with its control, so the rows it reorders stay in view.
      <Anchored onClose={close} className="absolute left-[324px] z-10" style={{ top: overlay.listView }}>
        <Menu
          label="Sort and group"
          width={232}
          items={[
            { note: "Sort by", label: "" },
            ...(Object.keys(SORT_LABEL) as SortBy[]).map((k) => ({ id: `sort-${k}`, label: SORT_LABEL[k], checked: k === sortBy, hint: k === "activity" ? "default" : k === "status" ? "needs you first" : undefined, onClick: () => (close(), setSortBy(k)) })),
            { divider: true, label: "" },
            { note: "Group by", label: "" },
            ...(Object.keys(GROUP_LABEL) as GroupBy[]).map((k) => ({ id: `group-${k}`, label: GROUP_LABEL[k], checked: k === groupBy, onClick: () => (close(), setGroupBy(k)) })),
          ]}
        />
      </Anchored>
    ) : overlay === "sessions-menu" ? (
      <Anchored onClose={close} className="absolute left-[260px] top-[84px] z-10">
        <Menu
          label="Sessions view"
          width={240}
          items={[
            { id: "select", label: "Select", onClick: () => (close(), setSelection(new Set())) },
            { id: "density", label: "Density", hint: comfortable ? "Comfortable" : "Compact", onClick: () => (close(), setComfortable((v) => !v)) },
            { id: "pinned", label: "Show pinned only", checked: pinnedOnly, onClick: () => (close(), setPinnedOnly((v) => !v)) },
          ]}
        />
      </Anchored>
    ) : openMenuOf ? (
      // Outside the session bar, which clips at 40 px (spec §7.7); anchored under the caret.
      <Anchored onClose={close} className="absolute right-[81px] top-[122px] z-10">
        <OpenInMenu
          f={openFacts(openMenuOf)}
          onPick={(p) => {
            close();
            if (p.kind === "configure") return (setSection("Open in"), openPage("settings"));
            act({ type: "open-in", key: openMenuOf, pick: p });
          }}
        />
      </Anchored>
    ) : overlay && typeof overlay === "object" && "tabMenu" in overlay ? (
      <Anchored onClose={close} className="absolute z-20" style={{ left: overlay.x, top: overlay.y }}>
        <Menu label="Tab" width={260} items={tabMenuItems(overlay.tabMenu)} />
      </Anchored>
    ) : overlay && typeof overlay === "object" && "menu" in overlay ? (
      <Anchored onClose={close} className="absolute right-[54px] top-[122px] z-10">
      <div role="menu" aria-label="Session actions" className="w-[240px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
        {(data.menu ? data.menu(overlay.menu) : SESSION_MENU).map((item) => (
          <button
            key={item}
            type="button"
            role="menuitem"
            onClick={() => {
              const key = overlay.menu;
              close();
              if (item === "Move to another account…") setOverlay({ decide: key });
              else act({ type: "session-menu", key, item });
            }}
            className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] hover:bg-ac-raise ${item === "End…" ? "text-ac-alert-text" : "text-ac-soft"}`}
          >
            {item}
          </button>
        ))}
      </div>
      </Anchored>
    ) : null;

  return (
    <Shell
      frame={frame}
      health={data.health.state}
      inbox={{ count: needs.length, ciFailing: needs.some((n) => n.kind === "ci") }}
      inboxOpen={overlay === "inbox"}
      needsYou={needs.length > 0}
      blocker={!!next}
      sessionsWindow={sessionsWindow}
      centre={centre}
      rightWindow={rightWindow}
      overlay={
        overlayNode ??
        (peek && peekFacts(peek.key) && (
          <div className="pointer-events-none absolute left-[352px] z-10" style={{ top: peek.y }}>
            <PeekCard f={peekFacts(peek.key)!} nowMs={data.nowMs} />
          </div>
        ))
      }
      actions={{ onSearch: () => setOverlay("palette"), onStart: () => setOverlay("new"), onSettings: () => openPage("settings"), onInbox: () => setOverlay((o) => (o === "inbox" ? null : "inbox")), onRestart: () => act({ type: "restart-engine" }) }}
    />
  );
}
