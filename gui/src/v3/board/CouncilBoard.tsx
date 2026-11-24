/**
 * An agent-config council drawn as a round table. Up to fifteen seats sit
 * around it — a seat is a role on a provider's model — and, while the council
 * runs with a live table (agent-config `live.jsonl`), a sixteenth seat for the
 * human at the bottom: say something to the table, raise a hand (the table
 * waits before the next seat), or stop it. The table shows WHO speaks; the
 * line under it shows WHAT was said (the speaker area). A council without a
 * live table shows what its response file holds; a debate steps through its
 * rounds.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Armchair, Hand, Scale, Send, Square, User, Users, X } from "lucide-react";

import { cn } from "../../lib/utils.js";
import { Markdown } from "../markdown/Markdown.js";
import type { CouncilLive, CouncilMessage, CouncilSeat, CouncilView, LiveSeat, LiveStatus } from "./types.js";
import "./board.css";

/** Where seat `i` of `n` sits around the table, in % of the table's box: the first at the top, clockwise. Pure. */
export function seatPlace(i: number, n: number): { left: number; top: number } {
  return placeAt((2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2);
}

/** Where AI seat `i` of `n` sits when the human holds the bottom of the table: the rest of the circle, evenly. Pure. */
export function seatPlaceWithHuman(i: number, n: number): { left: number; top: number } {
  return placeAt(Math.PI / 2 + ((2 * Math.PI) / (n + 1)) * (i + 1));
}

/** The human's seat: the bottom of the table. */
export const HUMAN_PLACE = { left: 50, top: 92 };

function placeAt(a: number): { left: number; top: number } {
  const r = 42;
  return { left: Math.round((50 + r * Math.cos(a)) * 100) / 100, top: Math.round((50 + r * Math.sin(a)) * 100) / 100 };
}

/** How wide a seat card is, by how many sit: the table stays readable at fifteen. Pure. */
export function seatWidth(n: number): string {
  return n <= 6 ? "32%" : n <= 10 ? "25%" : "20%";
}

const PROVIDER_MONO: Record<string, string> = { anthropic: "A", openai: "O", google: "G", gemini: "G", mistral: "M", xai: "X", deepseek: "D", perplexity: "P" };
const mono = (provider: string) => PROVIDER_MONO[provider] ?? provider.slice(0, 1).toUpperCase();

const money = (n: number | undefined) => (n === undefined ? null : n === 0 ? "$0 (subscription)" : `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`);
const ms = (n: number | undefined) => (n === undefined ? null : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

const STATUS: Record<LiveStatus, { label: string; className: string; pulse: boolean }> = {
  running: { label: "in session", className: "bg-ac-brand-tint text-ac-brand-text", pulse: true },
  paused: { label: "hand raised — the table waits", className: "bg-ac-warn-tint text-ac-warn-text", pulse: true },
  stopping: { label: "stopping", className: "bg-ac-alert-tint text-ac-alert-text", pulse: true },
  completed: { label: "finished", className: "bg-ac-ok-tint text-ac-ok-text", pulse: false },
  stopped: { label: "stopped", className: "bg-ac-raise text-ac-muted", pulse: false },
  failed: { label: "ended without a result", className: "bg-ac-alert-tint text-ac-alert-text", pulse: false },
};

/** A seat as the table draws it: the live state when there is one, the answer when the file has it. */
interface TableSeat {
  id: string;
  provider: string;
  model: string;
  role?: string;
  state: LiveSeat["state"] | "answered";
  turn?: number;
  headline?: string;
  error?: string;
  absent?: string;
  answer?: CouncilSeat;
  live?: LiveSeat;
}

/** The seats to draw: the live table's, joined to the file's answers by seat id; else the file's seats and empty chairs. Pure. */
export function tableSeats(council: CouncilView, shown: readonly CouncilSeat[]): TableSeat[] {
  const live = council.live;
  if (live) {
    return live.seats.map((s) => {
      const answer = shown.find((a) => (a.seatId ?? a.provider) === s.id) ?? shown.find((a) => !a.seatId && a.provider === s.member);
      return { id: s.id, provider: s.member, model: s.model ?? answer?.model ?? "", role: s.role, state: s.state, turn: s.turn, headline: s.headline ?? answer?.headline, error: s.error ?? answer?.error, absent: s.absent, answer, live: s };
    });
  }
  const present = new Set(shown.map((s) => s.seatId ?? s.member));
  return [
    ...shown.map((a): TableSeat => ({ id: a.seatId ?? a.member, provider: a.provider, model: a.model, role: a.role, state: a.error ? "failed" : "answered", headline: a.headline, error: a.error, answer: a })),
    ...council.absent.filter((a) => !present.has(a.member)).map((a): TableSeat => ({ id: a.member, provider: a.member.split(/[/#]/)[0] ?? a.member, model: "", state: "absent", absent: a.reason ?? "absent" })),
  ];
}

export interface CouncilBoardProps {
  council: CouncilView | null;
  running?: { doing: string };
  /** Speak at a live table; absent: the human seat only watches. */
  speak?: (run: string, msg: CouncilMessage) => Promise<void>;
}

export function CouncilBoard({ council, running, speak }: CouncilBoardProps) {
  const [round, setRound] = useState<number | null>(null);
  const [open, setOpen] = useState<TableSeat | null>(null);
  useEffect(() => {
    setRound(null);
    setOpen(null);
  }, [council?.name]);

  if (!council)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="ct-table ct-live">
          <div className="ct-surface flex items-center justify-center">
            <div className="max-w-[60%] text-center">
              <span className="ab-pulse mx-auto mb-2 block size-2 rounded-full bg-ac-brand" />
              <p className="text-[13px] font-medium text-ac-text">The council is in session</p>
              {running && <p className="mt-1 truncate font-ac-mono text-[11px] text-ac-muted">{running.doing}</p>}
              <p className="mt-2 text-[11.5px] text-ac-muted">This council writes no live table; its answers appear when it ends.</p>
            </div>
          </div>
        </div>
      </div>
    );

  const live = council.live;
  const rounds = council.kind === "debate" ? council.rounds : [];
  const shown = council.kind === "debate" ? ((rounds.find((r) => r.round === round) ?? rounds[rounds.length - 1])?.seats ?? council.seats) : council.seats;
  const seats = tableSeats(council, shown);
  const human = !!live && (live.listening || live.said.length > 0);
  const speaking = seats.find((s) => s.state === "thinking");
  const status = live ? STATUS[live.status] : council.open ? STATUS.running : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
        <header className="rounded-[10px] border border-ac-line bg-ac-panel px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ac-violet-tint text-ac-violet-text">
              <Users className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[14px] font-semibold text-ac-text">{council.ask || council.artefact || council.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ac-soft">
                <span className="rounded-full bg-ac-raise px-2 py-0.5 font-ac-mono">{council.name}</span>
                {council.mode && <span className="rounded-full bg-ac-raise px-2 py-0.5">{council.mode}</span>}
                <span className="rounded-full bg-ac-raise px-2 py-0.5">{seats.filter((s) => s.state !== "absent").length} seats</span>
                {live && live.turn > 0 && <span className="rounded-full bg-ac-raise px-2 py-0.5">turn {live.turn}</span>}
                {council.quorum?.status && (
                  <span className={cn("rounded-full px-2 py-0.5", council.quorum.status === "concluded" ? "bg-ac-ok-tint text-ac-ok-text" : "bg-ac-warn-tint text-ac-warn-text")}>
                    quorum {council.quorum.status}
                    {council.quorum.present !== undefined && council.quorum.total !== undefined ? ` · ${council.quorum.present}/${council.quorum.total}` : ""}
                  </span>
                )}
                {money(council.costUsd) && <span className="rounded-full bg-ac-raise px-2 py-0.5">{money(council.costUsd)}</span>}
                {status && (
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5", status.className)}>
                    {status.pulse && <span className="ab-pulse inline-block size-1.5 rounded-full bg-current" />}
                    {status.label}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {rounds.length > 0 && (
          <div className="mt-4 flex items-center gap-1" role="tablist" aria-label="Debate rounds">
            {rounds.map((r) => {
              const on = (round ?? rounds[rounds.length - 1].round) === r.round;
              return (
                <button key={r.round} type="button" role="tab" aria-selected={on} onClick={() => setRound(r.round)} className={cn("h-7 rounded-md px-2.5 text-[11.5px]", on ? "bg-ac-brand-tint font-medium text-ac-brand-text" : "text-ac-soft hover:bg-ac-raise")}>
                  Round {r.round}
                  <span className="text-ac-muted"> / {r.total}</span>
                </button>
              );
            })}
            {council.open && (
              // agent-config writes a debate round only once it is complete: the next one is under way, its answers are not on disk yet.
              <span className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-ac-brand-line px-2.5 text-[11.5px] text-ac-brand-text" title="This round is being argued; its answers appear when agent-config writes the round">
                <span className="ab-pulse inline-block size-1.5 rounded-full bg-current" />
                Round {rounds[rounds.length - 1].round + 1}
                <span className="text-ac-muted"> / {rounds[rounds.length - 1].total} · in progress</span>
              </span>
            )}
          </div>
        )}

        <div className={cn("ct-table mb-10 mt-14", (live?.listening || council.open) && "ct-live")}>
          <div className="ct-surface flex items-center justify-center p-[6%]">
            <Centre council={council} speaking={speaking} live={live} />
          </div>
          {seats.map((s, i) => {
            const place = human ? seatPlaceWithHuman(i, seats.length) : seatPlace(i, seats.length);
            return <SeatCard key={s.id} seat={s} place={place} width={seatWidth(seats.length + (human ? 1 : 0))} selected={open?.id === s.id} onOpen={() => setOpen(s)} />;
          })}
          {human && live && <HumanSeat live={live} width={seatWidth(seats.length + 1)} />}
        </div>

        {live && <SpeakerArea live={live} speak={speak} />}
      </div>

      {open && (
        <aside className="flex w-[440px] shrink-0 flex-col border-l border-ac-line bg-ac-panel" aria-label="Seat">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ac-line px-3">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ac-text">{open.role ?? open.id}</span>
            <span className="truncate font-ac-mono text-[10.5px] text-ac-muted">{[open.provider, open.model].filter(Boolean).join(" · ")}</span>
            <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="inline-flex size-6 items-center justify-center rounded-md text-ac-muted hover:bg-ac-raise hover:text-ac-text">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {open.live?.brief && <p className="mb-2 rounded-md bg-ac-raise px-2 py-1.5 text-[12px] text-ac-soft">{open.live.brief}</p>}
            {open.error && <p className="mb-2 rounded-md bg-ac-alert-tint px-2 py-1.5 text-[11.5px] text-ac-alert-text">{open.error}</p>}
            {open.absent && <p className="mb-2 rounded-md bg-ac-raise px-2 py-1.5 text-[11.5px] text-ac-muted">Could not sit: {open.absent}</p>}
            {open.answer?.text ? (
              <Markdown source={open.answer.text} className="text-[12px]" />
            ) : (
              <p className="text-[12px] text-ac-muted">{open.state === "thinking" ? "Thinking — the answer appears when it is complete." : open.headline ? `${open.headline} — the full answer is in the council's response file once the run ends.` : "No answer yet."}</p>
            )}
            {open.answer?.truncated && <p className="mt-2 text-[11px] text-ac-muted">Cut for the view — the full answer is in agents/runtime/council/responses/{council.name}.</p>}
          </div>
        </aside>
      )}
    </div>
  );
}

function Centre({ council, speaking, live }: { council: CouncilView; speaking?: TableSeat; live?: CouncilLive }): ReactNode {
  if (live?.status === "paused")
    return (
      <div className="text-center">
        <Hand className="mx-auto mb-1.5 size-5 text-ac-warn-text" />
        <p className="text-[12.5px] font-medium text-ac-text">Your hand is up</p>
        <p className="mt-1 text-[11.5px] text-ac-muted">{speaking ? `The table waits once ${speaking.role ?? speaking.id} has answered.` : "The table waits before the next seat."}</p>
      </div>
    );
  if (live?.listening && speaking)
    return (
      <div className="max-h-full overflow-hidden text-center">
        <span className="ab-pulse mx-auto mb-2 block size-2 rounded-full bg-ac-brand" />
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ac-muted">Speaking</p>
        <p className="mt-1 text-[14px] font-semibold text-ac-text">{speaking.role ?? speaking.id}</p>
        <p className="mt-0.5 truncate font-ac-mono text-[10.5px] text-ac-muted">{[speaking.provider, speaking.model].filter(Boolean).join(" · ")}</p>
      </div>
    );
  return (
    <div className="max-h-full overflow-hidden text-center">
      <Scale className="mx-auto mb-1.5 size-5 text-ac-muted" />
      {council.decision ? (
        <>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ac-muted">Decision</p>
          <p className="mt-1 line-clamp-4 text-[12px] text-ac-text">{council.decision}</p>
        </>
      ) : council.chairman ? (
        <>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ac-muted">Chair{council.chairman.member ? ` · ${council.chairman.member}` : ""}</p>
          <p className="mt-1 line-clamp-4 text-[12px] text-ac-text">{council.chairman.text}</p>
        </>
      ) : (
        <p className="line-clamp-4 text-[12px] text-ac-soft">{council.ask || "The seats answered independently; the synthesis is the session's to write."}</p>
      )}
    </div>
  );
}

const SEAT_STATE: Record<TableSeat["state"], string> = { waiting: "waiting", thinking: "thinking", answered: "answered", failed: "failed", skipped: "skipped", absent: "absent" };

function SeatCard({ seat, place, width, selected, onOpen }: { seat: TableSeat; place: { left: number; top: number }; width: string; selected: boolean; onOpen: () => void }) {
  const style = { left: `${place.left}%`, top: `${place.top}%`, width };
  if (seat.state === "absent")
    return (
      <button type="button" onClick={onOpen} className="ct-seat ct-empty rounded-[10px] border border-ac-line bg-ac-panel p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ac-brand" style={style} title={seat.absent}>
        <Armchair className="mx-auto size-4 text-ac-muted" />
        <p className="mt-1 truncate text-[10.5px] text-ac-muted">{seat.role ?? seat.id}</p>
        <p className="truncate text-[10px] text-ac-muted">{seat.absent ?? "absent"}</p>
      </button>
    );
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${seat.role ?? seat.id}, ${SEAT_STATE[seat.state]}`}
      className={cn(
        "ct-seat rounded-[10px] border bg-ac-panel p-2 text-left shadow-sm outline-none transition-opacity hover:border-ac-brand-line focus-visible:ring-2 focus-visible:ring-ac-brand",
        seat.state === "failed" ? "border-ac-alert" : "border-ac-line",
        seat.state === "thinking" && "ab-ring",
        (seat.state === "waiting" || seat.state === "skipped") && "opacity-60",
        selected && "ring-2 ring-ac-brand",
      )}
      style={style}
    >
      <div className="flex items-center gap-1.5">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ac-raise text-[10px] font-bold text-ac-soft">{mono(seat.provider)}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ac-text">{seat.role ?? seat.model ?? seat.id}</span>
        {seat.answer?.blindLabel && <span className="shrink-0 rounded bg-ac-raise px-1 text-[9.5px] text-ac-muted">{seat.answer.blindLabel.replace("Response-", "")}</span>}
      </div>
      {seat.role && <p className="truncate font-ac-mono text-[9.5px] text-ac-muted">{seat.model}</p>}
      <p className={cn("mt-1 line-clamp-2 text-[11px] leading-snug", seat.state === "failed" ? "text-ac-alert-text" : seat.state === "thinking" ? "text-ac-brand-text" : "text-ac-text")}>
        {seat.state === "thinking" ? `thinking${seat.turn ? ` · turn ${seat.turn}` : ""}…` : seat.state === "failed" ? `Failed: ${seat.error ?? "no answer"}` : seat.state === "skipped" ? "skipped — the table stopped" : seat.state === "waiting" ? "waiting for the turn" : (seat.headline ?? "—")}
      </p>
      {(seat.answer || seat.live?.outputTokens !== undefined) && (
        <p className="mt-1 truncate text-[10px] text-ac-muted">
          {[seat.answer?.outputTokens ?? seat.live?.outputTokens, ms(seat.answer?.latencyMs ?? seat.live?.latencyMs), money(seat.answer?.costUsd)]
            .map((x, i) => (i === 0 && typeof x === "number" ? `${x} tok` : x))
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </button>
  );
}

function HumanSeat({ live, width }: { live: CouncilLive; width: string }) {
  const last = live.said[live.said.length - 1];
  return (
    <div className={cn("ct-seat rounded-[10px] border-2 border-ac-violet-line bg-ac-violet-tint p-2", live.status === "paused" && "ab-ring")} style={{ left: `${HUMAN_PLACE.left}%`, top: `${HUMAN_PLACE.top}%`, width }} aria-label="Your seat">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ac-violet text-ac-on-color">
          <User className="size-3" />
        </span>
        <span className="text-[11px] font-semibold text-ac-violet-text">You</span>
        {live.status === "paused" && <Hand className="ml-auto size-3.5 text-ac-warn-text" aria-label="hand raised" />}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ac-text">{last ? last.text : live.listening ? "Speak below — the next seat hears it." : "You said nothing."}</p>
    </div>
  );
}

/** Under the table: what was said, newest last, and — while the table listens — the human's controls. */
function SpeakerArea({ live, speak }: { live: CouncilLive; speak?: (run: string, msg: CouncilMessage) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const feedEnd = useRef<HTMLLIElement>(null);
  useEffect(() => feedEnd.current?.scrollIntoView?.({ block: "nearest" }), [live.feed.length]);
  const send = (msg: CouncilMessage) => {
    if (!speak) return;
    setBusy(true);
    setError(null);
    speak(live.stem, msg).then(
      () => {
        setBusy(false);
        if (msg.type === "say") setText("");
        if (msg.type === "stop") setConfirmStop(false);
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };
  const can = !!speak && live.listening && !busy;
  return (
    <section aria-label="Speaker area" className="mx-auto max-w-[760px]">
      <ol className="max-h-[220px] overflow-y-auto rounded-[10px] border border-ac-line bg-ac-panel">
        {live.feed.map((f, i) => (
          <li key={`${i}:${f.at}`} ref={i === live.feed.length - 1 ? feedEnd : undefined} className={cn("flex gap-2 border-b border-ac-line px-3 py-1.5 text-[11.5px] last:border-b-0", i === live.feed.length - 1 && "ab-enter", f.kind === "human" ? "bg-ac-violet-tint text-ac-violet-text" : f.kind === "table" ? "text-ac-muted" : "text-ac-text")}>
            <span className="shrink-0 font-ac-mono text-[10.5px] text-ac-muted">{f.at.slice(11, 19)}</span>
            <span className="min-w-0">{f.text}</span>
          </li>
        ))}
        {!live.feed.length && <li className="px-3 py-2 text-[11.5px] text-ac-muted">The table has not started yet.</li>}
      </ol>
      {live.listening && speak && (
        <div className="mt-3 rounded-[10px] border border-ac-line bg-ac-panel p-2.5">
          <label htmlFor="council-say" className="mb-1 block text-[11px] font-medium text-ac-soft">
            Say something to the table — every seat after this one hears it
          </label>
          <textarea
            id="council-say"
            value={text}
            maxLength={2000}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && can) send({ type: "say", text });
            }}
            className="w-full resize-none rounded-md border border-ac-line bg-ac-bg px-2 py-1.5 text-[12.5px] text-ac-text outline-none focus-visible:ring-2 focus-visible:ring-ac-brand"
            placeholder="e.g. Mind the upgrade path for existing installs."
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!can || !text.trim()} onClick={() => send({ type: "say", text })} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-ac-brand px-2.5 text-[11.5px] font-medium text-ac-on-color disabled:opacity-50">
              <Send className="size-3.5" />
              Say it
            </button>
            {live.status === "paused" ? (
              <button type="button" disabled={!can} onClick={() => send({ type: "resume" })} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ac-line px-2.5 text-[11.5px] text-ac-text hover:bg-ac-raise disabled:opacity-50">
                <Hand className="size-3.5" />
                Lower hand — go on
              </button>
            ) : (
              <button type="button" disabled={!can} onClick={() => send({ type: "pause" })} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ac-line px-2.5 text-[11.5px] text-ac-text hover:bg-ac-raise disabled:opacity-50" title="The table waits before the next seat">
                <Hand className="size-3.5" />
                Raise hand
              </button>
            )}
            <span className="ml-auto inline-flex items-center gap-2">
              {confirmStop ? (
                <>
                  <span className="text-[11px] text-ac-alert-text">Stop the table? Seats that have not answered are skipped.</span>
                  <button type="button" disabled={!can} onClick={() => send({ type: "stop" })} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-ac-alert px-2.5 text-[11.5px] font-medium text-ac-on-color disabled:opacity-50">
                    Stop now
                  </button>
                  <button type="button" onClick={() => setConfirmStop(false)} className="inline-flex h-7 items-center rounded-md px-2 text-[11.5px] text-ac-soft hover:bg-ac-raise">
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" disabled={!can} onClick={() => setConfirmStop(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ac-line px-2.5 text-[11.5px] text-ac-alert-text hover:bg-ac-raise disabled:opacity-50">
                  <Square className="size-3" />
                  Stop the table
                </button>
              )}
            </span>
          </div>
          {error && <p className="mt-2 text-[11.5px] text-ac-alert-text">{error}</p>}
          {live.refused > 0 && <p className="mt-2 text-[11px] text-ac-warn-text">{live.refused} remark{live.refused === 1 ? " was" : "s were"} refused by the council's secret check and never sent.</p>}
        </div>
      )}
    </section>
  );
}
