/**
 * Carry out approved switch requests — agent-switch is the only executor.
 *
 * Each approved request is claimed (approved → executing) before anything runs,
 * so two executors never run one request, and is finished with what happened.
 * A failure is recorded, never retried: the user decided on a state that may
 * no longer hold, so a blind retry is a decision nobody made.
 *
 * Every move is an ordinary agent-switch command with all its own guards. The
 * parts that would open an interactive session (a Codex takeover's resume, a
 * handoff's seed) cannot run from the background service; their command is
 * recorded as `outcome.resume` for the app or agent-config to offer.
 */

import type { RequestStore, SwitchRequest } from "./requests.js";

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type Runner = (argv: string[]) => RunResult;

export interface Plan {
  argv: string[] | null;
  error?: string;
}

function split(id: string): { provider: string; name: string } {
  const [provider, name] = id.split("/");
  return { provider, name };
}

export function planMove(r: SwitchRequest): Plan {
  const d = r.decision;
  if (!d || d.kind !== "approve" || !d.target || !d.how) return { argv: null, error: "the request carries no approval" };
  const src = split(r.account);
  const tgt = split(d.target);
  const sid = r.session ? r.session.split("/")[2] : undefined;
  const needSession = (): Plan => ({ argv: null, error: `"${d.how}" needs the session id, and the request names none` });

  if (d.how === "handoff") {
    if (!sid) return needSession();
    return { argv: ["handoff", "extract", sid, "--from", src.name, "--to", tgt.provider, "--provider", src.provider, "--json"] };
  }
  if (src.provider !== tgt.provider) return { argv: null, error: `"${d.how}" cannot cross from ${src.provider} to ${tgt.provider}; only a handoff can` };
  if (src.provider === "claude") {
    const argv = ["rebind", tgt.name, ...(d.how === "after-turn" ? ["--when-idle"] : []), "--profile", src.name];
    if (d.how === "after-turn" && sid) argv.push("--session", sid);
    return { argv };
  }
  if (src.provider === "codex" && d.how === "now") {
    if (!sid) return needSession();
    return { argv: ["takeover", sid, "--to", tgt.name, "--provider", "codex", "--from", src.name, "--json"] };
  }
  return { argv: null, error: `no "${d.how}" move for ${src.provider}` };
}

function json(stdout: string): Record<string, unknown> {
  try {
    const o = JSON.parse(stdout);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function lastLine(s: string): string {
  return s.trim().split("\n").pop()?.replace(/^(error|agent-switch):\s*/, "") ?? "";
}

export function executeApproved(store: RequestStore, run: Runner): SwitchRequest[] {
  const finished: SwitchRequest[] = [];
  for (const pending of store.list().filter((r) => r.state === "approved")) {
    const r = store.claim(pending.id);
    if (!r) continue;
    const plan = planMove(r);
    let outcome: Parameters<RequestStore["finish"]>[1];
    if (!plan.argv) {
      outcome = { ok: false, detail: plan.error ?? "no plan" };
    } else {
      const res = run(plan.argv);
      if (res.status !== 0) {
        outcome = { ok: false, detail: lastLine(res.stderr) || lastLine(res.stdout) || `exit ${String(res.status)}` };
      } else {
        const tgt = split(r.decision!.target!);
        const o = json(res.stdout);
        if (r.decision!.how === "handoff" && typeof o.briefPath === "string") {
          outcome = { ok: true, detail: `brief written for ${r.decision!.target}`, resume: `agent-switch handoff seed --to ${tgt.name} --provider ${tgt.provider} --brief ${o.briefPath}` };
        } else if (typeof o.resumeCommand === "string") {
          const sid = r.session!.split("/")[2];
          outcome = { ok: true, detail: `moved to ${r.decision!.target}`, resume: o.resumeCommand, newSession: `${tgt.provider}/${tgt.name}/${sid}` };
        } else {
          outcome = { ok: true, detail: lastLine(res.stdout) || `moved to ${r.decision!.target}` };
        }
      }
    }
    const done = store.finish(r.id, outcome);
    if (done) finished.push(done);
  }
  return finished;
}
