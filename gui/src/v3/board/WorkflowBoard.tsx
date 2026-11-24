/**
 * A session's Workflow runs: one card per run, its phases as lanes, each
 * agent call a chip that says what it is doing and opens its transcript.
 */

import { CheckCircle2, CircleSlash, Loader2, RotateCcw, Workflow as WorkflowIcon, XCircle } from "lucide-react";

import { cn } from "../../lib/utils.js";
import type { WorkflowAgent, WorkflowRun } from "./types.js";
import "./board.css";

/** A one-line preview of what an agent call returned. Pure. */
export function resultPreview(r: unknown): string | null {
  if (r === undefined || r === null) return null;
  if (typeof r === "string") return r.split("\n")[0].slice(0, 140);
  if (typeof r === "object") {
    const o = r as Record<string, unknown>;
    if (o.truncated === true && typeof o.preview === "string") return o.preview.split("\n")[0].slice(0, 140);
    if (o.pick === "a" || o.pick === "b") return `pick ${o.pick}`;
    const first = Object.entries(o).find(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
    return first ? `${first[0]}: ${String(first[1]).slice(0, 120)}` : `${Object.keys(o).length} fields`;
  }
  return String(r).slice(0, 140);
}

const duration = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);

const STATUS: Record<WorkflowRun["status"], { label: string; className: string }> = {
  running: { label: "Running", className: "bg-ac-brand-tint text-ac-brand-text" },
  completed: { label: "Completed", className: "bg-ac-ok-tint text-ac-ok-text" },
  failed: { label: "Failed", className: "bg-ac-alert-tint text-ac-alert-text" },
  stopped: { label: "Stopped", className: "bg-ac-raise text-ac-muted" },
};

export function WorkflowBoard({ runs, onAgent }: { runs: WorkflowRun[]; onAgent?: (agentId: string, title: string) => void }) {
  if (!runs.length) return <p className="m-auto text-[12px] text-ac-muted">This session ran no workflow.</p>;
  const newest = [...runs].reverse();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
      <div className="flex flex-col gap-3">
        {newest.map((run) => (
          <RunCard key={run.runId} run={run} onAgent={onAgent} />
        ))}
      </div>
    </div>
  );
}

function RunCard({ run, onAgent }: { run: WorkflowRun; onAgent?: (agentId: string, title: string) => void }) {
  const phases = run.phases.length ? run.phases : [...new Set(run.agents.map((a) => a.phase ?? "—"))];
  const extra = [...new Set(run.agents.map((a) => a.phase ?? "—"))].filter((p) => !phases.includes(p));
  const lanes = [...phases, ...extra];
  const done = run.agents.filter((a) => a.state === "done").length;
  const s = STATUS[run.status];
  return (
    <section className={cn("overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel", run.status === "running" && "ab-ring")}>
      <header className="flex items-center gap-2 border-b border-ac-line px-3 py-2">
        <WorkflowIcon className="size-4 shrink-0 text-ac-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-ac-text">{run.name}</h3>
            <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium", s.className)}>{s.label}</span>
            {run.resumed && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-ac-muted" title="Resumed: calls that had finished came from the cache">
                <RotateCcw className="size-3" />
                resumed
              </span>
            )}
          </div>
          {run.description && <p className="truncate text-[11px] text-ac-muted">{run.description}</p>}
        </div>
        <div className="shrink-0 text-right text-[11px] tabular-nums text-ac-soft">
          <div>
            {done}/{run.agents.length} done
          </div>
          <div className="text-ac-muted">{[run.durationMs !== undefined ? duration(run.durationMs) : null, run.totalTokens !== undefined ? `${Math.round(run.totalTokens / 1000)}k tok` : null].filter(Boolean).join(" · ")}</div>
        </div>
      </header>
      <div className="h-1 bg-ac-raise">
        <div className="ab-bar h-full bg-ac-ok" style={{ width: `${run.agents.length ? (done / run.agents.length) * 100 : 0}%` }} />
      </div>
      <div className="flex flex-col gap-2 p-3">
        {lanes.map((phase) => {
          const agents = run.agents.filter((a) => (a.phase ?? "—") === phase);
          if (!agents.length) return null;
          return (
            <div key={phase} className="flex items-start gap-3">
              <span className="w-20 shrink-0 pt-1 text-[11px] font-medium text-ac-muted">{phase}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {agents.map((a) => (
                  <AgentChip key={a.agentId} a={a} onAgent={onAgent} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AgentChip({ a, onAgent }: { a: WorkflowAgent; onAgent?: (agentId: string, title: string) => void }) {
  const preview = resultPreview(a.result);
  const icon =
    a.state === "running" ? <Loader2 className="size-3 animate-spin text-ac-brand-text" /> : a.state === "done" ? <CheckCircle2 className="size-3 text-ac-ok-text" /> : a.state === "failed" ? <XCircle className="size-3 text-ac-alert-text" /> : <CircleSlash className="size-3 text-ac-muted" />;
  return (
    <button
      type="button"
      onClick={onAgent ? () => onAgent(a.agentId, a.label) : undefined}
      title={[a.label, a.state, a.doing, preview, a.error, a.attempts > 1 ? `${a.attempts} attempts` : null].filter(Boolean).join("\n")}
      className={cn("relative flex max-w-[260px] items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] outline-none hover:bg-ac-raise focus-visible:ring-2 focus-visible:ring-ac-brand", a.state === "running" ? "ab-ring border-ac-brand-line" : a.state === "failed" ? "border-ac-alert" : "border-ac-line")}
    >
      {icon}
      <span className="min-w-0">
        <span className="block truncate font-ac-mono text-ac-text">{a.label}</span>
        {(a.state === "running" ? a.doing : preview) && <span className="block truncate text-[10px] text-ac-muted">{a.state === "running" ? a.doing : preview}</span>}
      </span>
    </button>
  );
}
