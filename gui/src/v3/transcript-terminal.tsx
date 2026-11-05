/**
 * The terminal view of a session in the user's own terminal: the same
 * transcript the chat view reads, drawn the way the CLI draws it (prompt,
 * `●` tool lines, `⎿` results) on the terminal's colours. Read-only — the
 * user types in their own terminal. Nothing here is a real PTY.
 */
import { useEffect, useMemo, useRef } from "react";
import { fold, type AsEvent, type ChatRow } from "./timeline.js";

const ansi = (n: number) => ({ color: `var(--as-ansi-${n})` });
const DIM = ansi(8);

function Row({ r }: { r: ChatRow }) {
  switch (r.k) {
    case "user":
      return (
        <div className="whitespace-pre-wrap">
          <span style={DIM}>&gt; </span>
          {r.text}
          {r.images > 0 && <span style={DIM}>{` [${r.images} image${r.images === 1 ? "" : "s"}]`}</span>}
        </div>
      );
    case "assistant":
      return <div className="whitespace-pre-wrap">{r.text}</div>;
    case "tool": {
      const dot = r.state === "failed" ? ansi(1) : r.state === "running" ? ansi(3) : ansi(2);
      return (
        <div>
          <div className="whitespace-pre-wrap">
            <span style={dot}>● </span>
            <span className="font-semibold">{r.name}</span>
            <span style={DIM}>({r.summary})</span>
          </div>
          {r.diffs.map((d) => (
            <div key={d.path} className="whitespace-pre-wrap" style={DIM}>
              {"  ⎿  "}Updated {d.path} with <span style={ansi(2)}>+{d.added}</span> <span style={ansi(1)}>−{d.removed}</span>
            </div>
          ))}
          {r.result && (
            <div className="whitespace-pre-wrap" style={DIM}>
              {"  ⎿  "}
              {r.result}
            </div>
          )}
        </div>
      );
    }
    case "subagent":
      return (
        <div className="whitespace-pre-wrap">
          <span style={r.state === "failed" ? ansi(1) : r.state === "running" ? ansi(3) : ansi(6)}>● </span>
          <span className="font-semibold">Task</span>
          <span style={DIM}>
            ({r.type} · {r.description})
          </span>
        </div>
      );
    case "approval":
      return (
        <div className="whitespace-pre-wrap" style={ansi(3)}>
          {"  ⏵ "}wants to use {r.tool}: {r.summary}
          {r.resolved && <span style={DIM}>{` — ${r.resolved === "allow" ? "allowed" : "denied"}`}</span>}
        </div>
      );
    case "question":
      return (
        <div className="whitespace-pre-wrap" style={ansi(3)}>
          {r.questions.map((q) => `  ? ${q.question}`).join("\n")}
        </div>
      );
    case "plan":
      return (
        <div className="whitespace-pre-wrap">
          <span style={ansi(5)}>Plan </span>
          {r.text}
        </div>
      );
    case "error":
      return (
        <div className="whitespace-pre-wrap" style={ansi(1)}>
          {r.message}
        </div>
      );
  }
}

export function TranscriptTerminal({ events }: { events: readonly AsEvent[] }) {
  const rows = useMemo(() => fold(events).rows, [events]);
  const end = useRef<HTMLDivElement>(null);
  // Like a terminal: the newest output is in view.
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [rows.length]);
  return (
    <div
      data-terminal-transcript
      aria-label="Transcript in terminal style, read-only"
      className="min-h-0 flex-1 space-y-[0.75em] overflow-y-auto px-5 py-4 font-ac-mono text-[12.5px] leading-[1.5]"
      style={{ background: "var(--as-term-bg)", color: "var(--as-term-fg)" }}
    >
      {rows.length === 0 ? <div style={DIM}>Nothing in the transcript yet.</div> : rows.map((r) => <Row key={`${r.k}:${r.id}`} r={r} />)}
      <div ref={end} />
    </div>
  );
}
