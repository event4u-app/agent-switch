/**
 * The v3 Sessions window, assembled (spec §4–§10): frame, the three zones,
 * the workbench with page and session tabs, the right tool windows and the
 * overlays. Data comes in as `V3Data`, the 2.11 screens that v3 keeps come in
 * as `slots`, and every action leaves through one `act` callback, so the
 * window owns layout state only — never a session, an account or a file.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ellipsis, FileCode, Layers, Library, ListTree, Plus, Settings, Wrench } from "lucide-react";
import { Button, IconButton } from "../ui/Button.js";
import { Kbd } from "../ui/Typography.js";
import type { ToolEntry } from "../vm/types.js";
import { DecisionSheet, NewSessionDialog, type MoveHow, type NewSessionFacts, type NewSessionPlan, type SheetSession } from "./dialogs.js";
import { Shell, useFrame, type PageId } from "./frame.js";
import { LimitsStrip, type LimitAccount } from "./limits.js";
import { NeedsZone, type AwayDigest, type NeedItem } from "./needs.js";
import { InboxPopover, Palette, type DoneItem, type PaletteEntry } from "./overlays.js";
import { AccountsPage, AllSessionsPage, LibraryPage, type AccountsView, type LibraryRow, type PageAccount, type TableSession } from "./pages.js";
import { ChangesWindow, ChildrenWindow, SummaryWindow, type ChangedFile, type SummaryFacts } from "./panels.js";
import { SessionsZone, childNoun, type RowSession } from "./sessions.js";
import { AgentsSettings, AppearanceSettings, OpenInSettings, RemoteSettings, SettingsPage, type AgentRowView, type AgentSuggestionView, type OpenTarget, type SettingsSection } from "./settings.js";
import type { Appearance } from "./themes/resolve.js";
import { ToolsPage, updateNeeds } from "./tools.js";
import { BlockerStrip, SessionBar, SystemBanner, TabStrip, engineDownText, type BarSession, type TabItem } from "./workbench.js";
import type { BatchActions } from "./kit.js";
import { Menu, OpenInButton, OpenInMenu, monogram, type OpenFacts, type OpenPick } from "./menus.js";
import { startTabs, type LayoutStore } from "./layout.js";

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
  openIn: { targets: OpenTarget[]; defaultTarget: string | null; lastUsed: string | null; perRepo: Record<string, string>; focusTerminal: boolean; agentApps: { id: string; label: string; tool: string }[] };
  /** Settings › Agents (v3.2). */
  agents: { rows: AgentRowView[]; suggestions: AgentSuggestionView[] };
  /** Settings › Remote (v3.2): R1 accounts and the SSH stage. */
  remote: { remoteControl: string[]; ssh: boolean };
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
  | { type: "open-in"; key: string; pick: Exclude<OpenPick, { kind: "configure" }> | { kind: "default" } }
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

/** The palette's own commands: pages the window can open (spec §7.1). */
export const PAGE_COMMANDS: PaletteEntry[] = [
  { id: "page:sessions-table", group: "commands", title: "All sessions", meta: "every session, filter and batch" },
  { id: "page:accounts", group: "commands", title: "Accounts" },
  { id: "page:library", group: "commands", title: "Library" },
  { id: "page:tools", group: "commands", title: "Tools" },
  { id: "page:settings", group: "commands", title: "Settings", hint: "⌘," },
];

export function V3Window({ data, slots, act, focus, layout }: { data: V3Data; slots: V3Slots; act: (a: V3Action) => void; focus?: { key: string; n: number }; layout?: LayoutStore }) {
  const saved = useMemo(() => layout?.load() ?? null, [layout]);
  const [pages, setPages] = useState<Page[]>([]);
  const [sessionTabs, setSessionTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<null | "palette" | "inbox" | "new" | "sessions-menu" | { decide: string } | { menu: string } | { openin: string }>(null);
  const [accountsView, setAccountsView] = useState<AccountsView>("accounts");
  const [section, setSection] = useState<SettingsSection>("General");
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [openKids, setOpenKids] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [comfortable, setComfortable] = useState(saved?.comfortable ?? false);
  const [groupByProject, setGroupByProject] = useState(saved?.groupByProject ?? false);
  const [pinnedOnly, setPinnedOnly] = useState(saved?.pinnedOnly ?? false);

  const openPage = useCallback((p: Page) => {
    setPages((cur) => (cur.includes(p) ? cur : [...cur, p]));
    setActive(`page:${p}`);
  }, []);
  const frame = useFrame(openPage);
  const openSession = (key: string) => {
    setSessionTabs((cur) => (cur.includes(key) ? cur : [...cur, key]));
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
    setSessionTabs((cur) => [...new Set([...s.tabs, ...cur])]);
    setActive(s.active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.sessions]);
  useEffect(() => {
    if (started.current) layout?.save({ tabs: sessionTabs, active: active?.startsWith("page:") ? null : active, comfortable, groupByProject, pinnedOnly });
  }, [layout, sessionTabs, active, comfortable, groupByProject, pinnedOnly]);

  // The app opens a tab itself: a new chat, a Needs-you item that lives in a chat.
  useEffect(() => {
    if (focus) openSession(focus.key);
    // focus.n is the request; the key alone repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

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
    ...pages.map((p) => ({
      kind: "page" as const,
      id: `page:${p}`,
      ...(p.startsWith("review:")
        ? { label: `Review · ${data.sessions.find((x) => x.key === p.slice(7))?.title ?? p.slice(7)}`, icon: <FileCode className="size-3.5" /> }
        : PAGE_TAB[p as PageId | "sessions-table"]),
    })),
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
    if (p === "tools") return <ToolsPage>{slots.tools}</ToolsPage>;
    return (
      <SettingsPage current={section} onSection={setSection}>
        {section === "Appearance" ? (
          <AppearanceSettings a={data.appearance} prefersDark={data.prefersDark} onChange={(value) => act({ type: "appearance", value })} />
        ) : section === "Open in" ? (
          <OpenInSettings {...data.openIn} on={{ setDefault: (target, repo) => act({ type: "open-default", target, repo }), focusTerminal: (value) => act({ type: "focus-terminal-setting", value }) }} />
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
  const openMenuOf = overlay && typeof overlay === "object" && "openin" in overlay ? overlay.openin : null;

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
            on={{ view: (view) => act({ type: "view", key: activeSession, view }), account: () => setOverlay({ decide: activeSession }), model: () => act({ type: "model", key: activeSession }), thinking: () => act({ type: "thinking", key: activeSession }), menu: () => setOverlay({ menu: activeSession }) }}
          />
          {next && <BlockerStrip text={next.text} action={next.action} summaryOpen={frame.right === "summary"} onAction={() => act({ type: "blocker", key: activeSession })} onDismiss={() => setDismissed((d) => new Set([...d, activeSession]))} />}
          {slots.body(activeSession)}
        </>
      ) : data.sessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-[480px] max-w-full px-6 text-center">
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

  const pinned = new Set(data.library.filter((l) => l.pinned).map((l) => l.key));
  const sessionsWindow = (
    <aside aria-label="Sessions window" className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-ac-line bg-ac-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ac-line px-3">
        <span className="text-[12px] font-semibold text-ac-text">Sessions</span>
        <span className="ml-auto flex items-center">
          <IconButton label="New session  ⌘N" className="size-7" onClick={() => setOverlay("new")}>
            <Plus />
          </IconButton>
          <IconButton label="Select · group by project · density · show pinned" aria-expanded={overlay === "sessions-menu"} className="size-7" onClick={() => setOverlay((o) => (o === "sessions-menu" ? null : "sessions-menu"))}>
            <Ellipsis />
          </IconButton>
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-2">
        <NeedsZone items={needs} away={data.away} onVerb={onVerb} onMore={() => setOverlay("inbox")} onAway={() => act({ type: "away" })} />
        <SessionsZone
          sessions={pinnedOnly ? data.sessions.filter((x) => pinned.has(x.key)) : data.sessions}
          activeKey={activeSession}
          comfortable={comfortable}
          projectOf={groupByProject ? (k) => data.table.find((t) => t.key === k)?.project ?? null : undefined}
          onStart={() => setOverlay("new")}
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
    ) : overlay === "sessions-menu" ? (
      <div className="absolute left-[260px] top-[84px] z-10">
        <Menu
          label="Sessions view"
          width={240}
          items={[
            { id: "select", label: "Select", onClick: () => (close(), setSelection(new Set())) },
            { id: "group", label: "Group by project", checked: groupByProject, onClick: () => (close(), setGroupByProject((v) => !v)) },
            { id: "density", label: "Density", hint: comfortable ? "Comfortable" : "Compact", onClick: () => (close(), setComfortable((v) => !v)) },
            { id: "pinned", label: "Show pinned only", checked: pinnedOnly, onClick: () => (close(), setPinnedOnly((v) => !v)) },
          ]}
        />
      </div>
    ) : openMenuOf ? (
      // Outside the session bar, which clips at 40 px (spec §7.7); anchored under the caret.
      <div className="absolute right-[52px] top-[118px] z-10">
        <OpenInMenu
          f={openFacts(openMenuOf)}
          onPick={(p) => {
            close();
            if (p.kind === "configure") return (setSection("Open in"), openPage("settings"));
            act({ type: "open-in", key: openMenuOf, pick: p });
          }}
        />
      </div>
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
