/** The chat view of one session (spec §10.8): its timeline over the bridge, the
 *  composer, and a one-line header with model, mode and what the last turn cost. */

import { useMemo } from "react";

import { ChatTimeline } from "./chat.js";
import { Composer, MODE_LABEL } from "./composer.js";
import { fold } from "./timeline.js";
import type { BridgeActions, BridgeState } from "./adapter/useBridge.js";
import { modelLabel } from "./model-label.js";

const secs = (ms: number | null) => (ms === null ? null : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

export function ChatView({ b, findFiles, worktreeOf }: { b: BridgeState & BridgeActions; findFiles?: (query: string) => Promise<string[]>; worktreeOf?: (agentId: string) => string | null }) {
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
        {b.status === "starting" && <span className="ml-auto">Connecting…</span>}
      </div>
      <ChatTimeline events={b.events} notice={notice} on={b.status === "ready" ? { approve: b.approve, deny: b.deny, answer: b.answer, worktreeOf } : { worktreeOf }} />
      <Composer
        running={running}
        queued={b.queued}
        mode={b.mode}
        onMode={b.setMode}
        onSend={(text, attachments) => b.send(text, attachments)}
        onSteer={b.session?.key.startsWith("codex/") ? b.steer : undefined}
        onStop={b.interrupt}
        commands={b.session?.commands}
        findFiles={findFiles}
        disabled={b.status !== "ready"}
      />
    </div>
  );
}
