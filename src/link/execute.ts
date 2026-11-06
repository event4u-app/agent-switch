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
 *
 * The moves match the app's (gui/src/v3/adapter/actions.ts `moveOne`), so one
 * answer does the same thing whichever side carries it out: a Claude session
 * bound for an account that runs a session of its own moves by takeover (a
 * rebind there would take that account's login away), a hosted session moves in
 * its own window, and a hosted session switched now is told to carry on.
 */

import { CONTINUE_TEXT } from "../commands/continue.js";
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
  /** Moved in its own hosted window: runs already under this key, nothing to resume. */
  movedTo?: string;
  /** Type the continuation into this hosted session once the move succeeded. */
  continueKey?: string;
}

/** What the executor needs to know about the live sessions, as the app does. */
export interface MoveContext {
  /** The account (`provider/name`) runs a session of its own. */
  busy(account: string): boolean;
  /** Agent Switch hosts this session (`provider/account/id`) in a window. */
  hosted(key: string): boolean;
}

const NO_SESSIONS: MoveContext = { busy: () => false, hosted: () => false };

/** Types the continuation into a hosted session: true, or why it could not. */
export type Continuer = (key: string) => true | string;

function split(id: string): { provider: string; name: string } {
  const [provider, name] = id.split("/");
  return { provider, name };
}

export function planMove(r: SwitchRequest, ctx: MoveContext = NO_SESSIONS): Plan {
  const d = r.decision;
  if (!d || d.kind !== "approve" || !d.target || !d.how) return { argv: null, error: "the request carries no approval" };
  const src = split(r.account);
  const tgt = split(d.target);
  const sid = r.session ? r.session.split("/")[2] : undefined;
  // The id becomes one argv element: one that reads as a flag would change the command.
  if (sid?.startsWith("-")) return { argv: null, error: `not a session id: "${sid}"` };
  const needSession = (): Plan => ({ argv: null, error: `"${d.how}" needs the session id, and the request names none` });

  if (d.how === "handoff") {
    if (!sid) return needSession();
    return { argv: ["handoff", "extract", sid, "--from", src.name, "--to", tgt.provider, "--provider", src.provider, "--json"] };
  }
  if (src.provider !== tgt.provider) return { argv: null, error: `"${d.how}" cannot cross from ${src.provider} to ${tgt.provider}; only a handoff can` };
  // Move the conversation itself: in its hosted window when there is one,
  // else with a resume command for the user (the service opens no terminal).
  const takeover = (key: string, sid: string, extra: string[]): Plan =>
    ctx.hosted(key)
      ? { argv: ["takeover", sid, "--to", tgt.name, "--provider", src.provider, "--in-place", "--hosted", key, "--prompt", CONTINUE_TEXT], movedTo: `${tgt.provider}/${tgt.name}/${sid}` }
      : { argv: ["takeover", sid, "--to", tgt.name, "--provider", src.provider, ...extra, "--json"] };
  if (src.provider === "claude") {
    if (ctx.busy(d.target)) {
      if (!sid || !r.session) return { argv: null, error: `${d.target} runs a session of its own; switching the whole account would sign it out — move one session instead` };
      return takeover(r.session, sid, ["--stop-source", "--prompt", CONTINUE_TEXT]);
    }
    const argv = ["rebind", tgt.name, ...(d.how === "after-turn" ? ["--when-idle"] : []), "--profile", src.name];
    if (d.how === "after-turn" && sid) argv.push("--session", sid);
    // After the turn the arm watcher continues the session; now, the executor does.
    const continueKey = d.how === "now" && r.session && ctx.hosted(r.session) ? r.session : undefined;
    return continueKey ? { argv, continueKey } : { argv };
  }
  // Codex has no live login switch: both switch modes move the session.
  if (src.provider === "codex" && (d.how === "now" || d.how === "after-turn")) {
    if (!sid || !r.session) return needSession();
    return takeover(r.session, sid, ["--from", src.name]);
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

export function executeApproved(store: RequestStore, run: Runner, ctx: MoveContext = NO_SESSIONS, carryOn?: Continuer): SwitchRequest[] {
  const finished: SwitchRequest[] = [];
  for (const pending of store.list().filter((r) => r.state === "approved")) {
    const r = store.claim(pending.id);
    if (!r) continue;
    const plan = planMove(r, ctx);
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
        if (plan.movedTo) {
          outcome = { ok: true, detail: `moved to ${r.decision!.target} in its window; it carries on by itself`, newSession: plan.movedTo };
        } else if (r.decision!.how === "handoff" && typeof o.briefPath === "string") {
          outcome = { ok: true, detail: `brief written for ${r.decision!.target}`, resume: `agent-switch handoff seed --to ${tgt.name} --provider ${tgt.provider} --brief ${o.briefPath}` };
        } else if (typeof o.resumeCommand === "string") {
          const sid = r.session!.split("/")[2];
          outcome = { ok: true, detail: `moved to ${r.decision!.target}`, resume: o.resumeCommand, newSession: `${tgt.provider}/${tgt.name}/${sid}` };
        } else {
          const moved = lastLine(res.stdout) || `moved to ${r.decision!.target}`;
          const sent = plan.continueKey && carryOn ? carryOn(plan.continueKey) : undefined;
          const next = sent === undefined ? "" : sent === true ? "; it carries on by itself" : `; type one message in its terminal to continue (${sent})`;
          outcome = { ok: true, detail: moved + next };
        }
      }
    }
    const done = store.finish(r.id, outcome);
    if (done) finished.push(done);
  }
  return finished;
}
