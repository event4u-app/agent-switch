/**
 * An agent-config bracket ("arena", `/judge bracket`) drawn as a tournament:
 * the field — who is still in, who is out, by whom and why — the rounds with
 * their matches as the judges score them, and the engine's log. Hovering a
 * line traces its path through the rounds; clicking a line or a match opens
 * its detail beside the board. Everything shown comes from the bracket's own
 * files and the session's judge agents (see src/bracket.ts).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Crown, Eye, EyeOff, FileText, Gavel, Loader2, Pencil, Swords, X } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { duration } from "../kit.js";
import { Markdown } from "../markdown/Markdown.js";
import { arenaModel, arenaPace, changed, judgeOf, matchCard, matchPace, phaseLabel, type ArenaModel, type ArenaPace, type LineCard, type MatchCard, type Standing } from "./arena-model.js";
import { RUBRIC, total, type BracketMatch, type BracketView, type Criterion, type Verdict, type WorkflowAgent } from "./types.js";
import "./board.css";

export interface ArenaBoardProps {
  view: BracketView;
  /** Open an agent's transcript (a judge, a line writer, an appeal). */
  onAgent?: (agentId: string, title: string) => void;
  /** A line's full output file, for its detail. */
  readLine?: (line: string) => Promise<string>;
  /** The session's workflow agents: when each judge ran, for the match flyout's progress. */
  agents?: readonly WorkflowAgent[];
  /** One agent's transcript, live and read-only: a match's judge shows in its flyout. */
  transcript?: (agentId: string) => ReactNode;
  /** Name the run or its decision; empty text clears it. Absent: the names show, without a pencil. */
  rename?: (field: "name" | "decision", text: string) => Promise<void>;
}

/** A clock that ticks while `on`, for elapsed and remaining times. */
function useNow(on: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [on, everyMs]);
  return now;
}

type Selected = { kind: "line"; id: string } | { kind: "match"; id: string } | null;

const STANDING: Record<Standing, { label: string; className: string }> = {
  champion: { label: "Champion", className: "bg-ac-warn-tint text-ac-warn-text" },
  fighting: { label: "In the ring", className: "bg-ac-brand-tint text-ac-brand-text" },
  appealing: { label: "Appealing", className: "bg-ac-violet-tint text-ac-violet-text" },
  writing: { label: "Writing", className: "bg-ac-info-tint text-ac-info-text" },
  alive: { label: "In", className: "bg-ac-ok-tint text-ac-ok-text" },
  pending: { label: "Waiting", className: "bg-ac-raise text-ac-muted" },
  out: { label: "Out", className: "bg-ac-alert-tint text-ac-alert-text" },
  duplicate: { label: "Duplicate", className: "bg-ac-raise text-ac-muted" },
  "no-output": { label: "No output", className: "bg-ac-raise text-ac-muted" },
};

const CRITERION_LABEL: Record<Criterion, string> = { correctness: "Correctness", requirements: "Requirements", robustness: "Robustness", clarity: "Clarity", efficiency: "Efficiency" };

export function ArenaBoard({ view, onAgent, readLine, agents, transcript, rename }: ArenaBoardProps) {
  const model = useMemo(() => arenaModel(view), [view]);
  const prev = useRef<ArenaModel | null>(null);
  const [fx, setFx] = useState<{ knockedOut: Set<string>; decided: Set<string> }>({ knockedOut: new Set(), decided: new Set() });
  useEffect(() => {
    const c = changed(prev.current, model);
    prev.current = model;
    if (!c.knockedOut.size && !c.decided.size) return;
    setFx(c);
    const t = setTimeout(() => setFx({ knockedOut: new Set(), decided: new Set() }), 2200);
    return () => clearTimeout(t);
  }, [model]);
  const [selected, setSelected] = useState<Selected>(null);
  const selectedMatch = selected?.kind === "match" ? view.matches.find((m) => m.id === selected.id) : undefined;
  const liveJudge = selectedMatch && transcript ? judgeOf(selectedMatch) : undefined;
  // One flyout (owner, 2026-11-26): an agent's transcript — a writer's, a judge's, an appeal's — opens in a
  // dark box in its lower part, never as a second column beside it. A match's judge opens there by itself.
  const [opened, setOpened] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => setOpened(null), [selected?.kind, selected?.id]);
  const box = opened ?? (liveJudge && selectedMatch ? { id: liveJudge, title: `Judge · ${selectedMatch.id}` } : null);
  const boxLive = !!box && (agents ?? []).some((a) => a.agentId === box.id && a.state === "running");
  const openAgent = transcript ? (id: string, title: string) => setOpened({ id, title }) : onAgent;
  const now = useNow(!!selectedMatch && view.phase !== "done");
  const pace = useMemo(() => arenaPace(view, agents ?? [], now), [view, agents, now]);
  const [showOut, setShowOut] = useState(true);
  const [trace, setTrace] = useState<string | null>(null);
  const field = showOut ? model.lines : model.lines.filter((l) => l.standing !== "out" && l.standing !== "duplicate" && l.standing !== "no-output");
  const hidden = model.lines.length - field.length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
        <Header view={view} model={model} rename={rename} />

        <section aria-label="The field" className="mt-5">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ac-muted">The field</h3>
            <span className="text-[11.5px] text-ac-soft">
              {model.alive} in · {model.out} out
            </span>
            <button type="button" onClick={() => setShowOut((v) => !v)} className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-ac-soft hover:bg-ac-raise hover:text-ac-text" aria-pressed={!showOut}>
              {showOut ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {showOut ? "Hide the ones out" : `Show the ones out (${hidden})`}
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-2.5">
            {field.map((c) => (
              <LineToken
                key={c.line.id}
                card={c}
                knocked={fx.knockedOut.has(c.line.id)}
                dim={!!trace && trace !== c.line.id}
                selected={selected?.kind === "line" && selected.id === c.line.id}
                onHover={setTrace}
                onOpen={() => setSelected({ kind: "line", id: c.line.id })}
              />
            ))}
          </div>
        </section>

        <section aria-label="Rounds" className="mt-7">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ac-muted">Rounds</h3>
          {/* Room on every side: the ring around a picked match (a 1.5px shadow) is not cut by the scroll box. */}
          <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2 pt-0.5">
            {model.rounds.map((r) => (
              <div key={r.round} className="w-[232px] shrink-0">
                <div className={cn("mb-2 flex items-center gap-1.5 text-[11.5px] font-medium", r.current ? "text-ac-brand-text" : "text-ac-soft")}>
                  {r.current && view.phase !== "done" && <span className="ab-pulse inline-block size-1.5 rounded-full bg-ac-brand" />}
                  Round {r.round}
                  <span className="text-ac-muted">· {r.matches.filter((m) => m.state === "decided" || m.state === "bye").length}/{r.matches.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {r.matches.map((m) => (
                    <MatchTile
                      key={m.match.id}
                      card={m}
                      flash={fx.decided.has(m.match.id)}
                      trace={trace}
                      selected={selected?.kind === "match" && selected.id === m.match.id}
                      onHover={setTrace}
                      onOpen={() => setSelected({ kind: "match", id: m.match.id })}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!model.rounds.length && <p className="text-[12px] text-ac-muted">No matches yet — the lines are still being written.</p>}
          </div>
        </section>

        {!!view.log.length && (
          <section aria-label="Log" className="mt-7">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ac-muted">What happened</h3>
            <ol className="overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
              {[...view.log]
                .reverse()
                .slice(0, 14)
                .map((l, i) => (
                  <li key={`${view.log.length - i}:${l}`} className={cn("border-b border-ac-line px-3 py-1.5 font-ac-mono text-[11px] text-ac-soft last:border-b-0", i === 0 && "ab-enter text-ac-text")}>
                    {l}
                  </li>
                ))}
            </ol>
          </section>
        )}
      </div>

      {selected && (
        // A match with a judge, or any agent opened from the detail, makes the flyout wide (owner, 2026-11-26): the
        // facts on top, how far it is, and the agent's chat live in a dark box below — without leaving the board.
        <aside className={cn("flex shrink-0 flex-col border-l border-ac-line bg-ac-panel", box ? "w-[46%] min-w-[420px] max-w-[760px]" : "w-[400px]")} aria-label="Detail">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ac-line px-3">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ac-text">{selected.kind === "line" ? `Line ${selected.id}` : `Match ${selected.id}`}</span>
            <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="inline-flex size-6 items-center justify-center rounded-md text-ac-muted hover:bg-ac-raise hover:text-ac-text">
              <X className="size-3.5" />
            </button>
          </div>
          {selectedMatch && <MatchProgress match={selectedMatch} pace={pace} agents={agents ?? []} nowMs={now} />}
          <div className={cn("overflow-y-auto p-3", box ? "max-h-[40%] shrink-0" : "min-h-0 flex-1")}>
            {selected.kind === "match" ? (
              <MatchDetail view={view} id={selected.id} onLine={(id) => setSelected({ kind: "line", id })} onAgent={liveJudge ? undefined : openAgent} />
            ) : (
              <LineDetail view={view} model={model} id={selected.id} onMatch={(id) => setSelected({ kind: "match", id })} onAgent={openAgent} readLine={readLine} />
            )}
          </div>
          {box && transcript && (
            <section aria-label={`${box.title} · chat`} data-agent-box="" className="mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-ac-line bg-ac-bg">
              <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-ac-line px-3 text-[11px] text-ac-muted">
                <Gavel className="size-3.5" aria-hidden />
                <span className="truncate font-medium text-ac-soft">{box.title}</span>
                {boxLive && <span className="ab-pulse inline-block size-1.5 shrink-0 rounded-full bg-ac-brand" aria-label="live" />}
                <span className="ml-auto shrink-0 font-ac-mono text-[10.5px]">{box.id}</span>
                {opened && (
                  <button type="button" aria-label="Close chat" onClick={() => setOpened(null)} className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ac-muted hover:bg-ac-raise hover:text-ac-text">
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <div className="flex min-h-0 flex-1 flex-col">{transcript(box.id)}</div>
            </section>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * A name you can change in place (owner, 2026-11-26): the text, a pencil beside it; Enter saves, Escape leaves
 * it. Plain text only — an agent may have written it.
 */
function EditableText({ value, label, max, rename, className, children }: { value: string; label: string; max: number; rename?: (text: string) => Promise<void>; className?: string; children?: ReactNode }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (draft === null)
    return (
      <span className={cn("group/edit inline-flex min-w-0 max-w-full items-center gap-1", className)}>
        <span className="truncate" title={value}>
          {children ?? value}
        </span>
        {rename && (
          <button type="button" aria-label={`Rename ${label}`} onClick={() => (setDraft(value), setError(null))} className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ac-muted opacity-0 hover:bg-ac-raise hover:text-ac-text focus-visible:opacity-100 group-hover/edit:opacity-100">
            <Pencil className="size-3" />
          </button>
        )}
      </span>
    );
  const save = () => {
    if (!rename) return;
    rename(draft.trim()).then(
      () => setDraft(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <input
        aria-label={label}
        autoFocus
        value={draft}
        maxLength={max}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setDraft(null);
        }}
        onBlur={() => setDraft(null)}
        placeholder="Empty: back to the task's title"
        className="h-7 w-full min-w-0 rounded-md border border-ac-line2 bg-ac-bg px-2 text-[13px] text-ac-text outline-none focus:border-ac-brand"
      />
      {error && <span className="text-[11px] text-ac-alert-text">{error}</span>}
    </span>
  );
}

function Header({ view, model, rename }: { view: BracketView; model: ArenaModel; rename?: ArenaBoardProps["rename"] }) {
  const name = view.name ?? view.taskTitle ?? view.run;
  return (
    <header className={cn("relative overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel px-4 py-3", view.phase === "done" && view.champion && "ab-champion")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full", view.phase === "done" ? "bg-ac-warn-tint text-ac-warn-text" : "bg-ac-brand-tint text-ac-brand-text")}>
          {view.phase === "done" ? <Crown className="size-4" /> : <Swords className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex min-w-0 text-[14px] font-semibold text-ac-text">
            <EditableText value={name} label="arena name" max={120} rename={rename && ((t) => rename("name", t))} />
          </h2>
          {view.taskTitle && view.taskTitle !== name && <p className="truncate text-[11.5px] text-ac-muted" title={view.taskTitle}>{view.taskTitle}</p>}
          {view.champion && view.decision && (
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ac-soft">
              <span className="shrink-0 font-medium text-ac-warn-text">Decided:</span>
              <EditableText value={view.decision} label="decision" max={160} rename={rename && ((t) => rename("decision", t))} />
              <span className="shrink-0 rounded-full bg-ac-warn-tint px-1.5 font-ac-mono text-[10.5px] text-ac-warn-text">{view.champion}</span>
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ac-soft">
            <span className="rounded-full bg-ac-raise px-2 py-0.5 font-ac-mono">{view.run}</span>
            {view.tier && <span className="rounded-full bg-ac-raise px-2 py-0.5">tier {view.tier}</span>}
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5", view.phase === "done" ? "bg-ac-warn-tint text-ac-warn-text" : "bg-ac-brand-tint text-ac-brand-text")}>
              {view.phase !== "done" && <span className="ab-pulse inline-block size-1.5 rounded-full bg-current" />}
              {phaseLabel(view)}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[22px] font-semibold leading-none tabular-nums text-ac-text">
            {model.alive}
            <span className="text-[13px] font-normal text-ac-muted"> / {model.total}</span>
          </div>
          <div className="mt-1 text-[11px] text-ac-muted">still in</div>
        </div>
      </div>
      {/* One segment per line, in the field's order: who is left at a glance. */}
      <div className="mt-3 flex h-1.5 gap-0.5" aria-hidden>
        {model.lines.map((c) => (
          <span
            key={c.line.id}
            className={cn(
              "flex-1 rounded-full",
              c.standing === "champion" ? "bg-ac-warn" : c.standing === "out" || c.standing === "duplicate" || c.standing === "no-output" ? "bg-ac-line" : c.standing === "fighting" ? "ab-pulse bg-ac-brand" : c.standing === "appealing" ? "bg-ac-violet" : "bg-ac-ok",
            )}
          />
        ))}
      </div>
    </header>
  );
}

function Cards({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center" title={`${n} appeal card${n === 1 ? "" : "s"} played`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="ab-card" />
      ))}
    </span>
  );
}

function LineToken({ card, knocked, dim, selected, onHover, onOpen }: { card: LineCard; knocked: boolean; dim: boolean; selected: boolean; onHover: (id: string | null) => void; onOpen: () => void }) {
  const { line, standing } = card;
  const out = standing === "out" || standing === "duplicate" || standing === "no-output";
  const s = STANDING[standing];
  const doing = line.appealing?.doing ?? line.writing?.doing;
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => onHover(line.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(line.id)}
      onBlur={() => onHover(null)}
      className={cn(
        "relative flex min-h-[104px] flex-col rounded-[10px] border border-ac-line bg-ac-panel p-2.5 text-left outline-none transition-[opacity,transform] hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ac-brand",
        standing === "alive" && "ab-alive",
        (standing === "fighting" || standing === "appealing" || standing === "writing") && "ab-ring",
        standing === "champion" && "ab-champion",
        out && !knocked && "ab-out",
        knocked && "ab-knockout",
        dim && "ab-dim",
        selected && "ring-2 ring-ac-brand",
        standing === "no-output" && "border-dashed",
      )}
    >
      <div className="flex items-center gap-1.5">
        {standing === "champion" && <Crown className="size-3.5 text-ac-warn-text" />}
        <span className="font-ac-mono text-[13px] font-semibold text-ac-text">{line.id}</span>
        <Cards n={line.cards} />
        {card.out ? (
          <span className="ab-stamp ml-auto rounded px-1 text-[9px] font-bold uppercase">out · R{card.out.round}</span>
        ) : (
          <span className={cn("ml-auto rounded-full px-1.5 py-px text-[10px] font-medium", s.className)}>{s.label}</span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ac-muted">{line.approach ?? (line.hasOutput ? "No approach named" : "No output yet")}</p>
      <div className="mt-auto pt-1.5">
        {card.out ? (
          <p className="truncate text-[10.5px] text-ac-alert-text">
            lost to {card.out.by ?? "?"} · {card.out.reason}
            {card.out.score ? ` · ${card.out.score}` : ""}
          </p>
        ) : card.copyOf ? (
          <p className="truncate text-[10.5px] text-ac-muted">copy of {card.copyOf}</p>
        ) : doing ? (
          <p className="truncate text-[10.5px] text-ac-soft">{doing}</p>
        ) : (
          <Record card={card} />
        )}
      </div>
      {card.out && <span className="ab-strike" />}
    </button>
  );
}

function Record({ card }: { card: LineCard }) {
  if (!card.record.length) return <p className="text-[10.5px] text-ac-muted">no match yet</p>;
  return (
    <div className="flex items-center gap-1" title={card.record.map((r) => `${r.match}: ${r.won === null ? "open" : r.won ? "won" : "lost"} vs ${r.vs ?? "bye"}`).join("\n")}>
      {card.record.map((r) => (
        <span key={r.match} className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9.5px] font-bold", r.won === null ? "bg-ac-raise text-ac-muted" : r.won ? "bg-ac-ok-tint text-ac-ok-text" : "bg-ac-alert-tint text-ac-alert-text")}>
          {r.won === null ? "·" : r.won ? "W" : "L"}
        </span>
      ))}
      <span className="ml-1 text-[10.5px] tabular-nums text-ac-muted">
        {card.wins}–{card.losses}
      </span>
    </div>
  );
}

const STATE_CHIP: Record<MatchCard["state"], { label: string; className: string }> = {
  waiting: { label: "Waiting", className: "bg-ac-raise text-ac-muted" },
  judging: { label: "Judging", className: "bg-ac-brand-tint text-ac-brand-text" },
  provisional: { label: "Provisional", className: "bg-ac-violet-tint text-ac-violet-text" },
  decided: { label: "Decided", className: "bg-ac-ok-tint text-ac-ok-text" },
  bye: { label: "Bye", className: "bg-ac-raise text-ac-muted" },
};

const APPEAL: Record<string, string> = { open: "appeal open", card: "card played", declined: "appeal declined", corrected: "corrected" };

function MatchTile({ card, flash, trace, selected, onHover, onOpen }: { card: MatchCard; flash: boolean; trace: string | null; selected: boolean; onHover: (id: string | null) => void; onOpen: () => void }) {
  const m = card.match;
  const involved = !trace || m.a === trace || m.b === trace;
  const chip = STATE_CHIP[card.state];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "relative w-full rounded-[10px] border border-ac-line bg-ac-panel p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ac-brand",
        card.state === "judging" && "ab-ring",
        card.state === "provisional" && "ab-provisional",
        card.state === "waiting" && "border-dashed",
        flash && "ab-flash",
        !involved && "ab-dim",
        trace && involved && "ab-trace",
        selected && "ring-2 ring-ac-brand",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-ac-mono text-[11px] text-ac-muted">{m.id}</span>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium", chip.className)}>
          {card.state === "judging" && <Loader2 className="size-2.5 animate-spin" />}
          {chip.label}
        </span>
        {m.appeal && <span className="ml-auto truncate text-[10px] text-ac-violet-text">{APPEAL[m.appeal] ?? m.appeal}</span>}
      </div>
      <Side id={m.a} total={card.totals?.a} winner={card.winner} fatal={card.verdict?.fatal.a} onHover={onHover} />
      <Side id={m.b} total={card.totals?.b} winner={card.winner} fatal={card.verdict?.fatal.b} onHover={onHover} />
      {card.state === "judging" && m.judging?.doing && <p className="mt-1 truncate text-[10.5px] text-ac-soft">{m.judging.doing}</p>}
      {!!m.signals.length && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {m.signals.map((s) => (
            <span key={s} className="rounded-full bg-ac-warn-tint px-1.5 py-px text-[9.5px] text-ac-warn-text">
              {s}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function Side({ id, total: points, winner, fatal, onHover }: { id: string | null; total?: number; winner: string | null; fatal?: string; onHover: (id: string | null) => void }) {
  if (!id) return <div className="flex h-6 items-center text-[11px] italic text-ac-muted">bye</div>;
  const won = winner === id;
  const lost = !!winner && !won;
  return (
    <div className={cn("relative flex h-6 items-center gap-2 rounded-md pl-2 pr-1", won && "bg-ac-ok-tint")} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}>
      {won && <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-ac-ok" />}
      <span className={cn("w-10 shrink-0 font-ac-mono text-[11.5px] font-semibold", lost ? "text-ac-muted line-through decoration-ac-alert/60" : "text-ac-text")}>{id}</span>
      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ac-raise">
        {points !== undefined && <span className={cn("ab-bar absolute inset-y-0 left-0 rounded-full", won ? "bg-ac-ok" : "bg-ac-muted")} style={{ width: `${points}%` }} />}
      </span>
      <span className={cn("w-9 shrink-0 text-right text-[11px] tabular-nums", won ? "font-semibold text-ac-ok-text" : "text-ac-soft")}>{points ?? "–"}</span>
      {fatal === "upheld" && <span className="rounded bg-ac-alert px-1 text-[9px] font-bold text-ac-on-color">FATAL</span>}
      {fatal === "rebutted" && <span className="rounded border border-ac-line px-1 text-[9px] text-ac-muted line-through">FATAL</span>}
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ac-muted">{k}</dt>
          <dd className="min-w-0 text-ac-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Rubric({ v, a, b }: { v: Verdict; a: string; b: string }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-ac-line">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 border-b border-ac-line bg-ac-raise px-2.5 py-1.5 text-[10.5px] font-medium text-ac-muted">
        <span>Criterion (weight)</span>
        <span className="w-[86px] font-ac-mono">{a}</span>
        <span className="w-[86px] font-ac-mono">{b}</span>
      </div>
      {(Object.keys(RUBRIC) as Criterion[]).map((k) => (
        <div key={k} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 border-b border-ac-line px-2.5 py-1.5 last:border-b-0">
          <span className="text-[11.5px] text-ac-soft">
            {CRITERION_LABEL[k]} <span className="text-ac-muted">({RUBRIC[k]})</span>
          </span>
          <Mini value={v.a[k]} better={v.a[k] > v.b[k]} />
          <Mini value={v.b[k]} better={v.b[k] > v.a[k]} />
        </div>
      ))}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 bg-ac-raise px-2.5 py-1.5 text-[11.5px] font-semibold">
        <span className="text-ac-text">Points</span>
        <span className="w-[86px] tabular-nums">{total(v.a)}</span>
        <span className="w-[86px] tabular-nums">{total(v.b)}</span>
      </div>
    </div>
  );
}

function Mini({ value, better }: { value: number; better: boolean }) {
  return (
    <span className="flex w-[86px] items-center gap-1.5">
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-ac-raise">
        <span className={cn("ab-bar absolute inset-y-0 left-0 rounded-full", better ? "bg-ac-ok" : "bg-ac-muted")} style={{ width: `${value * 10}%` }} />
      </span>
      <span className={cn("w-6 text-right text-[11px] tabular-nums", better ? "text-ac-ok-text" : "text-ac-soft")}>{value}</span>
    </span>
  );
}

function AgentButton({ id, title, onAgent, children }: { id?: string; title: string; onAgent?: (agentId: string, title: string) => void; children: ReactNode }) {
  if (!id || !onAgent) return null;
  return (
    <button type="button" onClick={() => onAgent(id, title)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ac-line px-2 text-[11.5px] text-ac-soft hover:bg-ac-raise hover:text-ac-text">
      {children}
    </button>
  );
}

function MatchDetail({ view, id, onLine, onAgent }: { view: BracketView; id: string; onLine: (id: string) => void; onAgent?: (agentId: string, title: string) => void }) {
  const m = view.matches.find((x) => x.id === id);
  if (!m) return <p className="text-[12px] text-ac-muted">This match is gone from the bracket.</p>;
  const c = matchCard(m);
  const judge = m.report?.agentId ?? m.provisional?.agentId ?? m.judging?.agentId;
  const critique = m.report?.critique ?? c.verdict?.critique;
  const checks = m.report?.checks ?? c.verdict?.checks;
  const lineChip = (l: string | null) =>
    l ? (
      <button type="button" onClick={() => onLine(l)} className={cn("rounded-md px-1.5 font-ac-mono font-semibold hover:bg-ac-raise", c.winner === l ? "text-ac-ok-text" : "text-ac-text")}>
        {l}
      </button>
    ) : (
      <span className="italic text-ac-muted">bye</span>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13px]">
        {lineChip(m.a)}
        <span className="text-ac-muted">vs</span>
        {lineChip(m.b)}
        <span className={cn("ml-auto rounded-full px-1.5 py-px text-[10px] font-medium", STATE_CHIP[c.state].className)}>{STATE_CHIP[c.state].label}</span>
      </div>
      {c.provisional && <p className="rounded-md bg-ac-violet-tint px-2 py-1.5 text-[11.5px] text-ac-violet-text">A judge returned this verdict; the bracket has not recorded it yet. The winner shown follows agent-config's rule.</p>}
      {c.verdict && m.a && m.b ? <Rubric v={c.verdict} a={m.a} b={m.b} /> : <p className="text-[12px] text-ac-muted">{c.state === "judging" ? `Being judged${m.judging?.doing ? ` — ${m.judging.doing}` : ""}.` : "Not judged yet."}</p>}
      <Facts
        rows={[
          ...(c.winner ? ([["Winner", <span className="font-ac-mono font-semibold text-ac-ok-text">{c.winner}</span>]] as [string, ReactNode][]) : []),
          ...(c.margin !== null ? ([["Margin", `${c.margin} points`]] as [string, ReactNode][]) : []),
          ...(c.verdict ? ([["FATAL", `${m.a}: ${c.verdict.fatal.a} · ${m.b}: ${c.verdict.fatal.b}`], ["Judge's pick", c.verdict.pick === "a" ? m.a : m.b]] as [string, ReactNode][]) : []),
          ...(c.verdict?.seat?.family ? ([["Seat", [c.verdict.seat.family, c.verdict.seat.billing].filter(Boolean).join(" · ")]] as [string, ReactNode][]) : []),
          ...(m.appeal ? ([["Appeal", APPEAL[m.appeal] ?? m.appeal]] as [string, ReactNode][]) : []),
          ...(m.jury?.outcome ? ([["Jury", `${m.jury.outcome}${m.jury.reason ? ` — ${m.jury.reason}` : ""}`]] as [string, ReactNode][]) : []),
        ]}
      />
      {!![...m.notes, ...(m.provisional?.notes ?? [])].length && (
        <ul className="flex flex-col gap-1">
          {[...m.notes, ...(m.provisional?.notes ?? [])].map((n) => (
            <li key={n} className="rounded-md bg-ac-raise px-2 py-1 text-[11px] text-ac-soft">
              {n}
            </li>
          ))}
        </ul>
      )}
      {!!m.signals.length && (
        <div className="flex flex-wrap gap-1">
          {m.signals.map((s) => (
            <span key={s} className="rounded-full bg-ac-warn-tint px-2 py-0.5 text-[10.5px] text-ac-warn-text">
              {s}
            </span>
          ))}
        </div>
      )}
      {checks && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ac-muted">Checks the judge ran</h4>
          <p className="whitespace-pre-wrap rounded-md bg-ac-raise px-2 py-1.5 font-ac-mono text-[10.5px] text-ac-soft">{checks}</p>
        </div>
      )}
      {critique && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ac-muted">Critique</h4>
          <Markdown source={critique} className="text-[12px]" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <AgentButton id={judge} title={`Judge · ${m.id}`} onAgent={onAgent}>
          <Gavel className="size-3.5" />
          Judge's transcript
        </AgentButton>
      </div>
    </div>
  );
}

function LineDetail({ view, model, id, onMatch, onAgent, readLine }: { view: BracketView; model: ArenaModel; id: string; onMatch: (id: string) => void; onAgent?: (agentId: string, title: string) => void; readLine?: (line: string) => Promise<string> }) {
  const card = model.lines.find((l) => l.line.id === id);
  const [output, setOutput] = useState<{ text?: string; error?: string; loading?: boolean } | null>(null);
  useEffect(() => setOutput(null), [id]);
  if (!card) return <p className="text-[12px] text-ac-muted">This line is gone from the bracket.</p>;
  const { line } = card;
  const s = STANDING[card.standing];
  const load = () => {
    if (!readLine) return;
    setOutput({ loading: true });
    readLine(line.id).then(
      (text) => setOutput({ text }),
      (e: unknown) => setOutput({ error: e instanceof Error ? e.message : String(e) }),
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-ac-mono text-[15px] font-semibold text-ac-text">{line.id}</span>
        <Cards n={line.cards} />
        <span className={cn("ml-auto rounded-full px-1.5 py-px text-[10px] font-medium", s.className)}>{s.label}</span>
      </div>
      {line.approach && <p className="rounded-md bg-ac-raise px-2 py-1.5 text-[12px] text-ac-soft">{line.approach}</p>}
      {card.out && (
        <p className="rounded-md bg-ac-alert-tint px-2 py-1.5 text-[11.5px] text-ac-alert-text">
          Out in round {card.out.round} ({card.out.match}): lost to {card.out.by ?? "?"} {card.out.reason}
          {card.out.score ? `, ${card.out.score}` : ""}.
        </p>
      )}
      <Facts
        rows={[
          ["Record", `${card.wins} won · ${card.losses} lost`],
          ["Appeal cards", String(line.cards)],
          ...(line.lostTo.length ? ([["Lost to", line.lostTo.join(", ")]] as [string, ReactNode][]) : []),
          ...(line.lineage !== line.id ? ([["Lineage", line.lineage]] as [string, ReactNode][]) : []),
        ]}
      />
      {!!card.record.length && (
        <div className="flex flex-col gap-1">
          {card.record.map((r) => (
            <button key={r.match} type="button" onClick={() => onMatch(r.match)} className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[11.5px] hover:bg-ac-raise">
              <span className="font-ac-mono text-ac-muted">{r.match}</span>
              <span className={cn("rounded px-1 text-[10px] font-bold", r.won === null ? "bg-ac-raise text-ac-muted" : r.won ? "bg-ac-ok-tint text-ac-ok-text" : "bg-ac-alert-tint text-ac-alert-text")}>{r.won === null ? "open" : r.won ? "won" : "lost"}</span>
              <span className="text-ac-soft">vs {r.vs ?? "bye"}</span>
            </button>
          ))}
        </div>
      )}
      {line.rationale && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ac-muted">Its case</h4>
          <Markdown source={line.rationale} className="text-[12px]" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {line.hasOutput && readLine && (
          <button type="button" onClick={load} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ac-line px-2 text-[11.5px] text-ac-soft hover:bg-ac-raise hover:text-ac-text">
            <FileText className="size-3.5" />
            Full output and diff
          </button>
        )}
        <AgentButton id={line.writing?.agentId} title={`Writing · ${line.id}`} onAgent={onAgent}>
          Writer's transcript
        </AgentButton>
        <AgentButton id={line.appealing?.agentId} title={`Appeal · ${line.id}`} onAgent={onAgent}>
          Appeal's transcript
        </AgentButton>
      </div>
      {output?.loading && <p className="text-[12px] text-ac-muted">Reading {view.dir}/lines/{line.id}.md…</p>}
      {output?.error && <p className="text-[12px] text-ac-alert-text">{output.error}</p>}
      {output?.text && <Markdown source={output.text} className="text-[12px]" />}
    </div>
  );
}

/** A thin progress bar; `null` draws an indeterminate one (running, no pace known yet). */
function Bar({ ratio, tone, label }: { ratio: number | null; tone: "brand" | "ok" | "muted"; label: string }) {
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)} className="relative block h-1.5 w-full overflow-hidden rounded-full bg-ac-raise">
      {ratio === null ? (
        <span className="ab-pulse absolute inset-y-0 left-0 w-1/3 rounded-full bg-ac-brand opacity-60" />
      ) : (
        <span className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", tone === "ok" ? "bg-ac-ok" : tone === "brand" ? "bg-ac-brand" : "bg-ac-muted")} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
      )}
    </span>
  );
}

/**
 * How far the open match and the whole arena are (owner, 2026-11-26): the match's judge against the arena's typical
 * judge run, and the matches decided against the ones still to come, with a rough end time. Before any judge is
 * done there is no pace to go by, so no time is guessed.
 */
function MatchProgress({ match, pace, agents, nowMs }: { match: BracketMatch; pace: ArenaPace; agents: readonly WorkflowAgent[]; nowMs: number }) {
  const card = matchCard(match);
  const mp = matchPace(match, agents, pace.typicalMs, nowMs);
  const total = pace.decided + pace.left;
  const arenaRatio = total ? pace.decided / total : 1;
  const matchLine =
    card.state === "bye"
      ? "Bye — no judge needed"
      : card.state === "waiting"
        ? "Waiting for a judge"
        : mp.running
          ? [mp.elapsedMs !== null && `running ${duration(mp.elapsedMs)}`, mp.leftMs !== null ? (mp.leftMs > 0 ? `ca. ${duration(mp.leftMs)} left` : "taking longer than usual") : pace.typicalMs === null && "no judge done yet to go by"].filter(Boolean).join(" · ")
          : [card.provisional ? "Verdict in, not recorded yet" : "Decided", mp.elapsedMs !== null && `judged in ${duration(mp.elapsedMs)}`].filter(Boolean).join(" · ");
  return (
    <div data-match-progress="" className="flex shrink-0 flex-col gap-2.5 border-b border-ac-line px-3 py-2.5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-medium text-ac-soft">This match</span>
          <span className="ml-auto truncate text-ac-muted">{matchLine}</span>
        </div>
        <Bar label={`Match ${match.id}`} ratio={card.state === "bye" || card.state === "waiting" ? 0 : mp.ratio} tone={mp.running ? "brand" : "ok"} />
        {mp.running && mp.doing && (
          <span className="truncate font-ac-mono text-[10.5px] text-ac-soft" title={`Now: ${mp.doing}`}>
            {mp.doing}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-medium text-ac-soft">Arena</span>
          <span className="text-ac-muted">
            {pace.decided} of {pace.left ? "at least " : ""}
            {total} matches decided
          </span>
          <span className="ml-auto text-ac-muted">{pace.left === 0 ? "done" : pace.etaMs !== null ? `ca. ${duration(pace.etaMs)} to go` : "time unknown until a judge is done"}</span>
        </div>
        <Bar label="Arena progress" ratio={arenaRatio} tone={pace.left === 0 ? "ok" : "brand"} />
      </div>
    </div>
  );
}
