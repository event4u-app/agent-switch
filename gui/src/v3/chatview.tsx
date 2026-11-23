/** The chat view of one session (spec §10.8): its timeline over the bridge, the
 *  composer, and a one-line header with model, mode and what the last turn cost. */

import { useMemo } from "react";

import { ChatTimeline, CopyConversation } from "./chat.js";
import { Composer, MODE_LABEL } from "./composer.js";
import { fold } from "./timeline.js";
import type { BridgeActions, BridgeState } from "./adapter/useBridge.js";
import { modelLabel } from "./model-label.js";

const secs = (ms: number | null) => (ms === null ? null : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** What the agent is told when the user skips its question. */
export const SKIPPED = "The user skipped this question in Agent Switch; go on without an answer or ask in the chat.";

export function ChatView({ b, sessionKey, findFiles, worktreeOf }: { b: BridgeState & BridgeActions; /** The chat's key before the agent names its own; says which agent asks. */ sessionKey?: string; findFiles?: (query: string) => Promise<string[]>; worktreeOf?: (agentId: string) => string | null }) {
  const agent = (b.session?.key ?? sessionKey ?? "").startsWith("codex/") ? "Codex" : "Claude";
  const f = useMemo(() => fold(b.events), [b.events]);
  const cost = useMemo(() => b.events.reduce((n, e) => (e.t === "turn.end" && e.costUsd ? n + e.costUsd : n), 0), [b.events]);
  const running = b.status === "ready" && f.running;
  const notice =
    b.status === "error" ? (
      <p role="alert" className="shrink-0 border-b border-ac-line bg-ac-alert-tint px-4 py-1.5 text-xs text-ac-alert-text">
        The chat could not start: {b.error}
      </p>
    ) : b.status === "closed" ? (
      <p role="status" className="shrink-0 border-b border-ac-line bg-ac-raise px-4 py-1.5 text-xs text-ac-muted">
        The chat ended. The session stays; open it again to continue.
      </p>
    ) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-ac-line px-4 text-[11px] text-ac-muted">
        <span className="font-ac-mono" title={b.session?.model ?? undefined}>{modelLabel(b.session?.model) ?? "…"}</span>
        <span>·</span>
        <span>{MODE_LABEL[b.mode]}</span>
        {f.lastTurn && (
          <>
            <span>·</span>
            <span>last turn {secs(f.lastTurn.durationMs) ?? "—"}</span>
          </>
        )}
        {cost > 0 && (
          <>
            <span>·</span>
            <span title="What the turns in this window cost, as Claude reports it">${cost.toFixed(cost < 1 ? 3 : 2)}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {b.status === "starting" && <span>Connecting…</span>}
          {f.rows.length > 0 && <CopyConversation rows={f.rows} full={b.earlier ? () => b.allEvents().then((all) => fold(all).rows) : undefined} />}
        </span>
      </div>
      <ChatTimeline
        copyBar={false}
        events={b.events}
        notice={notice}
        agent={agent}
        earlier={b.earlier ? { prompts: b.earlier.prompts, load: b.loadEarlier, all: b.allEvents } : null}
        on={b.status === "ready" ? { approve: b.approve, deny: b.deny, answer: b.answer, skip: (id) => b.deny(id, SKIPPED), worktreeOf, stale: b.stale } : { worktreeOf, stale: b.stale, unanswerable: b.status === "starting" ? "Connecting…" : "This chat is not connected; open it again to answer." }}
      />
      <Composer
        running={running}
        queued={b.queued}
        mode={b.mode}
        onMode={b.setMode}
        onSend={(text, attachments) => b.send(text, attachments)}
        onSteer={agent === "Codex" ? b.steer : undefined}
        onStop={b.interrupt}
        commands={b.session?.commands}
        findFiles={findFiles}
        disabled={b.status !== "ready"}
      />
    </div>
  );
}
