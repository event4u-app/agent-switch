/**
 * Arenas, Councils, Panels (owner, 2026-11-25): three buttons at the bottom of
 * the left stripe, each with an accent badge counting what runs now. Each opens
 * a page listing that kind of run across every session; a row opens the
 * session's board right at that run.
 *
 * A panel is a same-model fan-out (`/panel decide|review` in agent-config): a
 * Workflow run named after it, outside any arena.
 */
import { useState } from "react";
import { ChevronRight, Swords, Users, Gavel } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Segmented } from "../ui/Segmented.js";
import { Filter, PageBody, Table, matches } from "./pages.js";
import "./board/board.css";
import type { ChildModel } from "./sessions.js";

export type RunKind = "arena" | "council" | "panel";

export interface RunRow {
  /** The board row id (`board:<session>|<focus>`): opening it opens the board there. */
  id: string;
  kind: RunKind;
  label: string;
  sessionKey: string;
  sessionTitle: string;
  running: boolean;
}

export const RUN_PAGE: Record<RunKind, { title: string; one: string; sub: string; icon: typeof Swords }> = {
  arena: { title: "Arenas", one: "arena", sub: "Tournaments of competing lines, in every session.", icon: Swords },
  council: { title: "Councils", one: "council", sub: "Round tables of different models, in every session.", icon: Users },
  panel: { title: "Panels", one: "panel", sub: "Independent judges on one question or document, in every session.", icon: Gavel },
};

const kindOf = (c: ChildModel): RunKind | null => (c.kind === "arena-board" ? "arena" : c.kind === "council-board" ? "council" : c.kind === "workflow" && /panel/i.test(c.label) ? "panel" : null);

/** Every arena, council and panel the sessions orchestrate (top-level board rows only: an arena's own workflow runs stay the arena's). Pure. */
export function runRows(sessions: readonly { key: string; title: string; children?: ChildModel[] }[]): RunRow[] {
  const out: RunRow[] = [];
  for (const s of sessions)
    for (const c of s.children ?? []) {
      const kind = kindOf(c);
      if (kind) out.push({ id: c.id, kind, label: c.label, sessionKey: s.key, sessionTitle: s.title, running: c.state === "working" });
    }
  return out;
}

/** What runs now, per kind: the stripe badges. Pure. */
export function runningCounts(rows: readonly RunRow[]): Record<RunKind, number> {
  const n: Record<RunKind, number> = { arena: 0, council: 0, panel: 0 };
  for (const r of rows) if (r.running) n[r.kind] += 1;
  return n;
}

/** The row's name without the kind prefix the tree needs ("Arena · tcc-signing · …" → "tcc-signing · …"). Pure. */
export const runName = (r: RunRow) => r.label.replace(/^(Arena|Council|Panel)\s*·\s*/i, "") || RUN_PAGE[r.kind].title.slice(0, -1);

type Show = "running" | "finished" | "all";

export function RunsPage({ kind, rows, onOpen }: { kind: RunKind; rows: readonly RunRow[]; onOpen: (id: string) => void }) {
  const mine = rows.filter((r) => r.kind === kind);
  const live = mine.filter((r) => r.running).length;
  // Owner, 2026-11-25: a run page opens on what runs now, also when nothing does; finished is one click away.
  const [show, setShow] = useState<Show>("running");
  const [q, setQ] = useState("");
  const meta = RUN_PAGE[kind];
  const Icon = meta.icon;
  const visible = mine.filter((r) => (show === "all" ? true : show === "running" ? r.running : !r.running) && matches(q, r.label, r.sessionTitle)).sort((a, b) => Number(b.running) - Number(a.running));
  const cols = "grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1fr)_96px_16px]";
  return (
    <PageBody title={meta.title} sub={meta.sub}>
      <div className="mb-3 flex items-center gap-2">
        <Filter value={q} onChange={setQ} placeholder={`Name or session…`} width={340} />
        <Segmented size="sm" label="Show" value={show} onChange={setShow} options={[{ value: "running", label: `Running ${live}` }, { value: "finished", label: `Finished ${mine.length - live}` }, { value: "all", label: "All" }]} />
      </div>
      <Table cols={cols} heads={["", meta.title.slice(0, -1), "Session", "Status", ""]}>
        {visible.map((r) => (
          <button key={r.id} type="button" data-run-row="" onClick={() => onOpen(r.id)} title={`Open the ${meta.one} in its board`} className={cn("grid w-full items-center gap-3 border-b border-ac-line px-3 py-2.5 text-left last:border-b-0 hover:bg-ac-raise", cols)}>
            <Icon className={cn("size-3.5", r.running ? "text-ac-brand-text" : "text-ac-muted")} />
            <span className="truncate text-[12.5px] text-ac-text">{runName(r)}</span>
            <span className="truncate text-xs text-ac-soft">{r.sessionTitle}</span>
            <span className="inline-flex items-center gap-1.5 text-xs">
              {r.running ? (
                <>
                  <span className="ab-pulse inline-block size-1.5 rounded-full bg-ac-brand" />
                  <span className="text-ac-brand-text">Running</span>
                </>
              ) : (
                <span className="text-ac-muted">Finished</span>
              )}
            </span>
            <ChevronRight className="size-3.5 text-ac-faint" />
          </button>
        ))}
        {visible.length === 0 && <div className="px-3 py-8 text-center text-xs text-ac-muted">{show === "running" && !live && !q ? `No ${meta.one} runs right now.` : mine.length ? `No ${meta.one} matches.` : `No ${meta.one} has run yet.`}</div>}
      </Table>
    </PageBody>
  );
}
