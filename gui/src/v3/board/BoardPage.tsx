/**
 * The board of one session: what it orchestrates, drawn per kind — an arena
 * (agent-config bracket) as a tournament, a council as a round table, any
 * other Workflow run as lanes of agent calls. Polls `workflows --json` while
 * it is open; an agent's transcript opens beside the board.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Swords, Users, Workflow as WorkflowIcon, X } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { ArenaBoard } from "./ArenaBoard.js";
import { CouncilBoard } from "./CouncilBoard.js";
import { WorkflowBoard } from "./WorkflowBoard.js";
import type { CouncilMessage, Orchestration } from "./types.js";

/** How often an open board reads again. */
export const BOARD_POLL_MS = 3000;

export type BoardTab = `arena:${string}` | `council:${string}` | "council:live" | "workflows";

/** The board's tabs, in the order they are drawn. Pure. */
export function boardTabs(o: Orchestration): { id: BoardTab; label: string; icon: "arena" | "council" | "workflows"; live: boolean }[] {
  const tabs: { id: BoardTab; label: string; icon: "arena" | "council" | "workflows"; live: boolean }[] = [];
  for (const b of o.brackets) tabs.push({ id: `arena:${b.run}`, label: `Arena · ${b.run}`, icon: "arena", live: b.phase !== "done" && o.live });
  for (const c of [...o.councils].reverse()) tabs.push({ id: `council:${c.name}`, label: `Council · ${c.name}`, icon: "council", live: (c.open || !!c.live?.listening) && o.live });
  if (o.councilRunning) tabs.unshift({ id: "council:live", label: "Council · now", icon: "council", live: true });
  if (o.workflows.length) tabs.push({ id: "workflows", label: `Workflows (${o.workflows.length})`, icon: "workflows", live: o.workflows.some((w) => w.status === "running") });
  return tabs;
}

/** The tab to show: the asked one when it exists, else the first. Pure. */
export function pickTab(tabs: readonly { id: BoardTab }[], want: string | undefined): BoardTab | null {
  if (want && tabs.some((t) => t.id === want)) return want as BoardTab;
  if (want?.startsWith("workflow:") && tabs.some((t) => t.id === "workflows")) return "workflows";
  return tabs[0]?.id ?? null;
}

const ICON = { arena: Swords, council: Users, workflows: WorkflowIcon };

export interface BoardPageProps {
  sessionKey: string;
  title: string;
  live: boolean;
  /** `arena:<run>`, `council:<name>`, `workflow:<runId>`: the tab to open on. */
  focus?: string;
  read: (key: string, live: boolean) => Promise<Orchestration>;
  readLine?: (key: string, run: string, line: string) => Promise<string>;
  /** One agent's transcript, read-only. */
  transcript?: (agentId: string) => ReactNode;
  /** Speak at a live council table. */
  speak?: (key: string, run: string, msg: CouncilMessage) => Promise<void>;
}

export function BoardPage({ sessionKey, title, live, focus, read, readLine, transcript, speak }: BoardPageProps) {
  const [data, setData] = useState<Orchestration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<BoardTab | null>(null);
  const [agent, setAgent] = useState<{ id: string; title: string } | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      read(sessionKey, liveRef.current).then(
        (o) => {
          if (!alive) return;
          setData(o);
          setError(null);
        },
        (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
      );
      // Hidden window: read four times less often.
      timer = setTimeout(tick, typeof document !== "undefined" && document.hidden ? BOARD_POLL_MS * 4 : BOARD_POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionKey, read]);

  const tabs = data ? boardTabs(data) : [];
  useEffect(() => {
    if (!data) return;
    setTab((cur) => (cur && tabs.some((t) => t.id === cur) ? cur : pickTab(tabs, focus)));
    // tabs derive from data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, focus]);
  useEffect(() => {
    if (focus && data) setTab(pickTab(boardTabs(data), focus));
    // a new focus from the tree re-targets the open board
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const onAgent = useCallback((id: string, t: string) => setAgent({ id, title: t }), []);
  const bracket = tab?.startsWith("arena:") ? data?.brackets.find((b) => `arena:${b.run}` === tab) : undefined;
  const council = tab?.startsWith("council:") && tab !== "council:live" ? (data?.councils.find((c) => `council:${c.name}` === tab) ?? null) : null;

  let body: ReactNode;
  if (!data) body = <p className="m-auto text-[13px] text-ac-muted">{error ? `The board could not be read: ${error}` : "Reading what this session orchestrates…"}</p>;
  else if (!tabs.length) body = <p className="m-auto max-w-sm text-center text-[13px] text-ac-muted">This session runs no workflow, arena or council that Agent Switch can find.</p>;
  else if (bracket) body = <ArenaBoard view={bracket} onAgent={transcript ? onAgent : undefined} readLine={readLine ? (line) => readLine(sessionKey, bracket.run, line) : undefined} />;
  else if (tab === "council:live" || council) body = <CouncilBoard council={council} running={tab === "council:live" ? data.councilRunning : undefined} speak={speak ? (run, msg) => speak(sessionKey, run, msg).then(() => void read(sessionKey, liveRef.current).then(setData, () => undefined)) : undefined} />;
  else body = <WorkflowBoard runs={data.workflows} onAgent={transcript ? onAgent : undefined} />;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-ac-bg">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-ac-line px-3" role="tablist" aria-label={`Board of ${title}`}>
        <span className="mr-2 max-w-[220px] truncate text-[12px] text-ac-muted">{title}</span>
        {tabs.map((t) => {
          const Icon = ICON[t.icon];
          return (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md px-2.5 text-[12px]", tab === t.id ? "bg-ac-raise font-medium text-ac-text" : "text-ac-soft hover:bg-ac-raise")}>
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{t.label}</span>
              {t.live && <span className="ab-pulse inline-block size-1.5 shrink-0 rounded-full bg-ac-brand" aria-label="live" />}
            </button>
          );
        })}
        {error && data && <span className="ml-auto text-[11px] text-ac-warn-text">last read failed — showing the previous state</span>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1">{body}</div>
        {agent && transcript && (
          <aside className="flex w-[46%] min-w-[360px] shrink-0 flex-col border-l border-ac-line bg-ac-bg" aria-label="Agent transcript">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ac-line px-3">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ac-text">{agent.title}</span>
              <span className="font-ac-mono text-[10.5px] text-ac-muted">{agent.id}</span>
              <button type="button" aria-label="Close transcript" onClick={() => setAgent(null)} className="inline-flex size-6 items-center justify-center rounded-md text-ac-muted hover:bg-ac-raise hover:text-ac-text">
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{transcript(agent.id)}</div>
          </aside>
        )}
      </div>
    </div>
  );
}
