/**
 * The v3 Sessions window, assembled (spec §4–§10): frame, the three zones,
 * the workbench with page and session tabs, the right tool windows and the
 * overlays. Data comes in as `V3Data`, the 2.11 screens that v3 keeps come in
 * as `slots`, and every action leaves through one `act` callback, so the
 * window owns layout state only — never a session, an account or a file.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Layers, Library, ListTree, Settings, Wrench } from "lucide-react";
import type { ToolEntry } from "../vm/types.js";
import { DecisionSheet, NewSessionDialog, type MoveHow, type NewSessionFacts, type NewSessionPlan, type SheetSession } from "./dialogs.js";
import { Shell, useFrame, type PageId } from "./frame.js";
import { LimitsStrip, type LimitAccount } from "./limits.js";
import { NeedsZone, type AwayDigest, type NeedItem } from "./needs.js";
import { InboxPopover, Palette, type DoneItem, type PaletteEntry } from "./overlays.js";
import { AccountsPage, AllSessionsPage, LibraryPage, type AccountsView, type LibraryRow, type PageAccount, type TableSession } from "./pages.js";
import { ChangesWindow, ChildrenWindow, SummaryWindow, type ChangedFile, type SummaryFacts } from "./panels.js";
import { SessionsZone, childNoun, type RowSession } from "./sessions.js";
import { AppearanceSettings, OpenInSettings, SettingsPage, type OpenTarget, type SettingsSection } from "./settings.js";
import type { Appearance } from "./themes/resolve.js";
import { ToolsPage, updateNeeds } from "./tools.js";
import { BlockerStrip, SessionBar, SystemBanner, TabStrip, engineDownText, type BarSession, type TabItem } from "./workbench.js";
import type { BatchActions } from "./kit.js";

export interface V3Data {
  nowMs: number;
  health: { state: "ready" } | { state: "down"; sinceMs: number; hostedRunning: number };
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
  openIn: { targets: OpenTarget[]; defaultTarget: string | null; perRepo: Record<string, string>; focusTerminal: boolean };
  newSession: { initial: NewSessionPlan; facts: NewSessionFacts };
  /** The near-limit decision, by account key ("claude/work") or by session key — a limit item's subject is either. */
  decision: (subject: string) => { account: string; pctUsed: number; window: string; resetsIn: string; sessions: SheetSession[]; suggestion: string } | null;
  bar: (key: string) => BarSession | null;
  summary: (key: string) => SummaryFacts | null;
  changes: (key: string) => ChangedFile[];
  next: (key: string) => { text: string; action: string } | null;
  /** The session-menu entries that do something for this session; all when absent. */
  menu?: (key: string) => readonly SessionMenuItem[];
  /** "Commit…" in the Changes window; disabled with its reason when false. */
  commitAvailable?: boolean;
}

export interface V3Slots {
  /** The session body: the hosted terminal or the user's-own-terminal view. */
  body: (key: string) => ReactNode;
  openIn: (key: string) => ReactNode;
  usageHistory: ReactNode;
  pools: ReactNode;
  poolCount: number;
  tools: ReactNode;
  /** The 2.11 settings screens v3 keeps, by section. */
  settings: (section: SettingsSection) => ReactNode;
}

export type V3Action =
  | { type: "need"; item: NeedItem }
  | { type: "need-more" }
  | { type: "away" }
  | { type: "needs-later-all" }
  | { type: "start"; plan: NewSessionPlan }
  | { type: "choose-account" }
  | { type: "move"; how: MoveHow; moves: { key: string; target: string }[] }
  | { type: "keep-account"; account: string }
  | { type: "session-menu"; key: string; item: SessionMenuItem }
  | { type: "batch"; op: keyof BatchActions; keys: string[] }
  | { type: "clean-up" }
  | { type: "view"; key: string; view: "terminal" | "chat" }
  | { type: "model" | "thinking"; key: string }
  | { type: "blocker"; key: string }
  | { type: "create-pr" | "open-pr" | "review" | "commit"; key: string }
  | { type: "account"; op: "add" | "refresh" | "use" | "sign-in" | "terminal" | "more"; key?: string }
  | { type: "library"; op: "auto-keep"; value: boolean }
  | { type: "library"; op: "pin" | "archive"; key: string; value: boolean }
  | { type: "library"; op: "resume"; key: string }
  | { type: "palette"; entry: PaletteEntry; newTab: boolean }
  | { type: "appearance"; value: Appearance }
  | { type: "open-default"; target: string; repo?: string }
  | { type: "focus-terminal-setting"; value: boolean }
  | { type: "restart-engine" };

export const SESSION_MENU = ["Rename…", "Pin", "Move to another account…", "Take over here…", "Hand off…", "Compact", "Detach", "End…"] as const;
export type SessionMenuItem = (typeof SESSION_MENU)[number];

type Page = PageId | "sessions-table";
const PAGE_TAB: Record<Page, { label: string; icon: ReactNode }> = {
  accounts: { label: "Accounts", icon: <Layers className="size-3.5" /> },
  library: { label: "Library", icon: <Library className="size-3.5" /> },
  tools: { label: "Tools", icon: <Wrench className="size-3.5" /> },
  settings: { label: "Settings", icon: <Settings className="size-3.5" /> },
  "sessions-table": { label: "All sessions", icon: <ListTree className="size-3.5" /> },
};

/** The palette's own commands: pages the window can open (spec §7.1). */
export const PAGE_COMMANDS: PaletteEntry[] = [
  { id: "page:sessions-table", group: "commands", title: "All sessions", meta: "every session, filter and batch" },
  { id: "page:accounts", group: "commands", title: "Accounts" },
  { id: "page:library", group: "commands", title: "Library" },
  { id: "page:tools", group: "commands", title: "Tools" },
  { id: "page:settings", group: "commands", title: "Settings", hint: "⌘," },
];

export function V3Window({ data, slots, act }: { data: V3Data; slots: V3Slots; act: (a: V3Action) => void }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [sessionTabs, setSessionTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<null | "palette" | "inbox" | "new" | { decide: string } | { menu: string }>(null);
  const [accountsView, setAccountsView] = useState<AccountsView>("accounts");
  const [section, setSection] = useState<SettingsSection>("General");
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [openKids, setOpenKids] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);

  const openPage = useCallback((p: Page) => {
    setPages((cur) => (cur.includes(p) ? cur : [...cur, p]));
    setActive(`page:${p}`);
  }, []);
  const frame = useFrame(openPage);
  const openSession = (key: string) => {
    setSessionTabs((cur) => (cur.includes(key) ? cur : [...cur, key]));
    setActive(key);
  };

  // Tool updates join the queue (spec §10.4); limit items open the decision sheet.
  const needs = useMemo(() => [...data.needs, ...updateNeeds(data.tools, new Date(data.nowMs).toISOString())], [data.needs, data.tools, data.nowMs]);
  const onVerb = (n: NeedItem) => {
    if (n.kind === "limit") setOverlay({ decide: n.subject });
    else if (n.kind === "update") openPage("tools");
    else if ((n.kind === "approval" || n.kind === "question") && data.bar(n.subject)?.hosted) openSession(n.subject);
    else act({ type: "need", item: n });
  };

  const activeSession = active && !active.startsWith("page:") ? active : null;
  const bar = activeSession ? data.bar(activeSession) : null;
  const next = activeSession && !dismissed.has(activeSession) ? data.next(activeSession) : null;
  const tabs: TabItem[] = [
    ...pages.map((p) => ({ kind: "page" as const, id: `page:${p}`, ...PAGE_TAB[p] })),
    ...sessionTabs.map((k) => {
      const s = data.sessions.find((x) => x.key === k);
      return { kind: "session" as const, id: k, title: s?.title ?? k, state: s?.state ?? "idle" };
    }),
  ];
  const batch = (keys: string[]): BatchActions => ({
    onClear: () => setSelection(null),
    onPin: () => act({ type: "batch", op: "onPin", keys }),
    onArchive: () => act({ type: "batch", op: "onArchive", keys }),
    onClean: () => act({ type: "batch", op: "onClean", keys }),
    onEnd: () => act({ type: "batch", op: "onEnd", keys }),
  });

  const page = (p: Page): ReactNode => {
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
    if (p === "tools") return <ToolsPage>{slots.tools}</ToolsPage>;
    return (
      <SettingsPage current={section} onSection={setSection}>
        {section === "Appearance" ? (
          <AppearanceSettings a={data.appearance} prefersDark={data.prefersDark} onChange={(value) => act({ type: "appearance", value })} />
        ) : section === "Open in" ? (
          <OpenInSettings {...data.openIn} on={{ setDefault: (target, repo) => act({ type: "open-default", target, repo }), focusTerminal: (value) => act({ type: "focus-terminal-setting", value }) }} />
        ) : (
          slots.settings(section)
        )}
      </SettingsPage>
    );
  };

  const centre = (
    <section className="flex min-w-0 flex-1 flex-col bg-ac-bg">
      <TabStrip
        tabs={tabs}
        activeId={active ?? ""}
        onSelect={setActive}
        onClose={(id) => {
          setPages((cur) => cur.filter((p) => `page:${p}` !== id));
          if (active === id) setActive(sessionTabs[0] ?? null);
        }}
      />
      {data.health.state === "down" && (
        <SystemBanner action={null}>{engineDownText(data.health.sinceMs, data.nowMs, data.health.hostedRunning)}</SystemBanner>
      )}
      {active?.startsWith("page:") ? (
        page(active.slice(5) as Page)
      ) : activeSession && bar ? (
        <>
          <SessionBar
            s={bar}
            openIn={slots.openIn(activeSession)}
            on={{ view: (view) => act({ type: "view", key: activeSession, view }), account: () => setOverlay({ decide: activeSession }), model: () => act({ type: "model", key: activeSession }), thinking: () => act({ type: "thinking", key: activeSession }), menu: () => setOverlay({ menu: activeSession }) }}
          />
          {next && <BlockerStrip text={next.text} action={next.action} summaryOpen={frame.right === "summary"} onAction={() => act({ type: "blocker", key: activeSession })} onDismiss={() => setDismissed((d) => new Set([...d, activeSession]))} />}
          {slots.body(activeSession)}
        </>
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
    if (frame.right === "changes") return <ChangesWindow files={data.changes(activeSession)} reviewAvailable={false} commitAvailable={data.commitAvailable ?? true} onReview={() => act({ type: "review", key: activeSession })} onCommit={() => act({ type: "commit", key: activeSession })} onHide={() => frame.setRight(null)} />;
    const s = data.sessions.find((x) => x.key === activeSession);
    return s && <ChildrenWindow noun={childNoun(s)} children={s.children} onHide={() => frame.setRight(null)} />;
  })();

  const sessionsWindow = (
    <aside aria-label="Sessions window" className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-ac-line bg-ac-panel">
      <div className="min-h-0 flex-1 relative overflow-y-auto">
        <NeedsZone items={needs} away={data.away} onVerb={onVerb} onMore={() => setOverlay("inbox")} onAway={() => act({ type: "away" })} />
        <SessionsZone
          sessions={data.sessions}
          activeKey={activeSession}
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
      <LimitsStrip accounts={data.limits} nowMs={data.nowMs} openKey={null} onOpen={(key) => setOverlay({ decide: key })} onSignIn={(key) => act({ type: "account", op: "sign-in", key })} />
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
      <div className="absolute right-3 top-11 z-10">
        <InboxPopover items={needs} history={data.history} focusedId={null} nowMs={data.nowMs} onVerb={(n) => (close(), onVerb(n))} onAllLater={() => (close(), act({ type: "needs-later-all" }))} />
      </div>
    ) : overlay === "new" ? (
      <NewSessionDialog initial={data.newSession.initial} facts={data.newSession.facts} onClose={close} onChooseAccount={() => act({ type: "choose-account" })} onStart={(plan) => (close(), act({ type: "start", plan }))} />
    ) : decision ? (
      <DecisionSheet {...decision} room={null} onClose={close} onKeep={() => (close(), act({ type: "keep-account", account: decision.account }))} onDecide={(how, moves) => (close(), act({ type: "move", how, moves }))} />
    ) : overlay && typeof overlay === "object" && "menu" in overlay ? (
      <div role="menu" aria-label="Session actions" className="absolute right-3 top-[124px] z-10 w-[240px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
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
      overlay={overlayNode}
      actions={{ onSearch: () => setOverlay("palette"), onStart: () => setOverlay("new"), onSettings: () => openPage("settings"), onInbox: () => setOverlay((o) => (o === "inbox" ? null : "inbox")), onRestart: () => act({ type: "restart-engine" }) }}
    />
  );
}
