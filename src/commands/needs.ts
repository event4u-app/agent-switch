/**
 * `agent-switch needs [--json]` and `agent-switch needs later <id>` — the
 * attention queue (src/attention.ts) from local state: hook events and
 * transcripts for approvals and questions, cached usage for limits, sign-in
 * state per account. Failing CI joins with the git/PR facts (Phase 3), tool
 * updates with the Tools page. Local reads only, no network.
 */

import * as path from "node:path";

import {
  afterRead,
  attentionFile,
  buildQueue,
  digest,
  itemId,
  readAttention,
  seen,
  snooze,
  writeAttention,
  type Candidate,
} from "../attention.js";
import { eventFile, readEvents, type HookEventRecord } from "../hooks.js";
import { configDir, die, identity, listProfiles, ROOT } from "../profiles.js";
import { readProtection } from "../protection.js";
import type { ProviderId } from "../providers.js";
import { listSessions, markLive, openQuestion } from "../sessions.js";
import { cachedUsage } from "./shared.js";
import { sessionsWithGit } from "./pr.js";
import { githubRepo, prCacheFile, prsForHead, readPrCache } from "../pr-facts.js";
import { TmuxHost } from "../host/tmux-host.js";
import { InputLeases } from "../host/lease.js";
import { typeIntoHosted } from "./continue.js";
import { readPending } from "../bridge/pending.js";

const HOST_WAIT = /^quota_auto_resume_(armed|fired|cancelled|setting)$/;

/** Everything that could wait for the user right now, unordered. */
export function gatherCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const profile of listProfiles("claude")) {
    const cfg = configDir("claude", profile);
    const rows = listSessions(cfg, 20);
    markLive(cfg, rows);
    const events = readEvents(eventFile(ROOT, "claude", profile));
    const last = new Map<string, HookEventRecord>();
    for (const e of events) if (e.sessionId) last.set(e.sessionId, e);
    for (const r of rows) {
      const key = `claude/${profile}/${r.sessionId}`;
      const who = r.summary ?? (r.cwd ? path.basename(r.cwd) : r.sessionId.slice(0, 8));
      const q = r.file ? openQuestion(r.file) : null;
      if (q) {
        // AS cannot answer into a terminal it does not host (D-approve): the verb says where to go.
        out.push({ kind: "question", subject: key, who, what: "asks you", since: new Date(r.mtimeMs).toISOString(), version: q, verb: "Focus terminal" });
        continue;
      }
      const e = last.get(r.sessionId);
      if (!e || Date.parse(e.at) + 2000 < r.mtimeMs) continue; // answered since: the transcript moved on
      if (e.event === "Notification" && !(e.notificationType && HOST_WAIT.test(e.notificationType))) {
        const approval = e.notificationType === "permission_prompt";
        out.push({ kind: approval ? "approval" : "question", subject: key, who, what: approval ? "wants your approval" : "waits for you", since: e.at, version: e.at, verb: "Focus terminal" });
      } else if (e.event === "StopFailure" && (e.error === "authentication_failed" || e.error === "oauth_org_not_allowed")) {
        out.push({ kind: "signin", subject: `claude/${profile}`, who: profile, what: "is signed out", since: e.at, version: e.at });
      } else if (e.event === "StopFailure" && e.error === "rate_limit") {
        out.push({ kind: "limit", subject: key, who, what: `stopped at the usage limit of ${profile}`, since: e.at, version: e.at });
      }
    }
  }
  for (const providerId of ["claude", "codex"] as ProviderId[]) {
    for (const profile of listProfiles(providerId)) {
      if (identity(providerId, profile) === null) {
        if (!out.some((c) => c.kind === "signin" && c.subject === `${providerId}/${profile}`)) {
          out.push({ kind: "signin", subject: `${providerId}/${profile}`, who: profile, what: "is not signed in", since: new Date(0).toISOString(), version: "none" });
        }
        continue;
      }
      const snap = cachedUsage(providerId, profile).snapshot;
      const protect = readProtection(providerId, profile).thresholdPct;
      const tight = snap?.windows.filter((w) => w.utilization !== null && w.utilization >= protect).sort((a, b) => b.utilization! - a.utilization!)[0];
      if (tight) {
        out.push({ kind: "limit", subject: `${providerId}/${profile}`, who: profile, what: `${tight.utilization}% of ${tight.label}`, since: snap!.capturedAt, version: `${tight.key}:${tight.resetsAt ?? ""}` });
      }
    }
  }
  out.push(...ciCandidates());
  out.push(...bridgeCandidates());
  return out;
}

/** Approvals and questions waiting in a chat the app runs (spec §13.5): one decision, wherever it is made. */
export function bridgeCandidates(files = readPending(ROOT)): Candidate[] {
  return files.flatMap((f) =>
    f.items.map((i): Candidate => {
      const question = i.tool === "AskUserQuestion";
      return {
        kind: question ? "question" : "approval",
        subject: f.key,
        who: i.summary ? `${i.tool} · ${i.summary}` : i.tool,
        what: question ? "asks you in the chat" : "wants your approval in the chat",
        since: i.since,
        version: i.id,
        verb: "Open chat",
      };
    }),
  );
}

/**
 * Failing CI and merge conflicts on the PRs of recent sessions, from the PR
 * cache (`pr status` and the background refresh fill it). For a hosted session
 * AS can send the fix request itself ("Fix"); elsewhere the verb says where to go.
 */
export function ciCandidates(rows = sessionsWithGit(), cache = readPrCache(prCacheFile(ROOT)), hosted: ReadonlySet<string> = hostedKeys()): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const repo = githubRepo(r.git?.remote ?? null);
    if (!repo) continue;
    for (const pr of prsForHead(cache, repo, r.git?.headSha ?? null)) {
      if (pr.lifecycle !== "OPEN" && pr.lifecycle !== "DRAFT") continue;
      const subject = `${repo}#${pr.number}`;
      if (seen.has(subject)) continue;
      const who = r.row.summary ?? `#${pr.number}`;
      const verb = hosted.has(r.key) ? undefined : "Focus terminal";
      if (pr.ci === "FAILURE") {
        seen.add(subject);
        out.push({ kind: "ci", subject, who, what: `CI failing on #${pr.number}`, detail: pr.failingChecks.join(", ") || undefined, since: pr.updatedAt, version: `${pr.headSha}:ci`, ...(verb ? { verb } : {}) });
      } else if (pr.mergeable === "CONFLICTING") {
        seen.add(subject);
        out.push({ kind: "ci", subject, who, what: `#${pr.number} has a merge conflict`, since: pr.updatedAt, version: `${pr.headSha}:conflict`, ...(verb ? { verb } : {}) });
      }
    }
  }
  return out;
}

function hostedKeys(): Set<string> {
  return TmuxHost.available() ? new Set(new TmuxHost(ROOT).list().filter((s) => s.alive).map((s) => s.key)) : new Set();
}

export function cmdNeeds(sub: string | undefined, arg: string | undefined, flags: Record<string, string | boolean>): void {
  const file = attentionFile(ROOT);
  const state = readAttention(file);
  const candidates = gatherCandidates();
  if (sub === "later") {
    const c = candidates.find((x) => itemId(x.kind, x.subject) === arg);
    if (!c) die(`nothing waits under ${arg ?? "(no id)"}; see agent-switch needs`);
    writeAttention(file, snooze(state, { id: arg!, version: c.version }));
    console.log(`Later: ${c.who} ${c.what}. It comes back when it changes.`);
    return;
  }
  if (sub === "fix") return fixCi(arg, candidates);
  if (sub === "seen") {
    writeAttention(file, seen(state, new Date().toISOString()));
    if (flags.json) console.log(JSON.stringify({ ok: true }));
    else console.log("The away summary is cleared.");
    return;
  }
  if (sub !== undefined) die("usage: agent-switch needs [--json] | needs later <id> | needs fix <id> | needs seen | needs allow|deny <session> <approval>");
  const now = new Date().toISOString();
  const items = buildQueue(candidates, state);
  const away = digest(state, now, listProfiles("claude").flatMap((p) => readEvents(eventFile(ROOT, "claude", p))), Object.values(readPrCache(prCacheFile(ROOT))).flatMap((r) => r.prs));
  // The digest stays until `needs seen`: a read alone (a hidden window's poll) is not a look.
  const next = { ...afterRead(state, items, new Set(candidates.map((c) => itemId(c.kind, c.subject))), now), awaySince: away?.since ?? null };
  writeAttention(file, next);
  if (flags.json) {
    console.log(JSON.stringify({ items, away, history: next.history.slice(-20).reverse() }, null, 2));
    return;
  }
  if (away) console.log(`While you were away: ${away.finishedTurns} finished turns, ${away.stoppedOnError} stopped on an error, ${away.resolved} resolved, ${away.mergedPrs} PRs merged, ${away.ciBreaks} CI breaks.`);
  if (items.length === 0) {
    console.log("Nothing needs you.");
    return;
  }
  for (const i of items) console.log(`${i.id}  ${i.who} ${i.what}  → ${i.verb}${i.detail ? `\n    ${i.detail}` : ""}`);
  console.log("\nHide one until it changes: agent-switch needs later <id>");
}

/**
 * "Fix" on a failing-CI item of a hosted session: type one request into it —
 * the PR, the failing checks and where their logs are — through the input
 * lease, so it is refused while someone else types there. Never into a session
 * AS does not host.
 */
function fixCi(id: string | undefined, candidates: Candidate[]): void {
  const c = candidates.find((x) => x.kind === "ci" && itemId(x.kind, x.subject) === id);
  if (!c) die(`no CI item ${id ?? "(no id)"}; see agent-switch needs`);
  if (c.verb === "Focus terminal") die(`${c.who} runs in your own terminal; Agent Switch only types into sessions it hosts. Ask there: ${c.what}${c.detail ? ` (${c.detail})` : ""}.`);
  const [repo, num] = c.subject.split("#");
  const session = sessionsWithGit().find((r) => {
    const rr = githubRepo(r.git?.remote ?? null);
    return rr === repo && prsForHead(readPrCache(prCacheFile(ROOT)), repo, r.git?.headSha ?? null).some((p) => String(p.number) === num);
  });
  if (!session) die("the session for this PR is gone");
  const text = `${c.what}${c.detail ? `: ${c.detail}` : ""}. Logs: https://github.com/${repo}/pull/${num}/checks — please find the cause and fix it.`;
  try {
    typeIntoHosted(new TmuxHost(ROOT), new InputLeases(ROOT), session.key, { id: `cli-${process.pid}`, pid: process.pid, kind: "cli" }, text);
  } catch (err) {
    die(`${(err as Error).message}.`);
  }
  console.log(`Sent to ${session.key}: ${text}`);
}
