/**
 * `agent-switch pr status [--json] [--refresh]` and `agent-switch worktrees
 * [--json]` — the PR and worktree side of the sessions (road-to-agent-switch-v3-
 * central Phase 3). `pr status` refreshes what is due (all of it with
 * `--refresh`) through `gh`, one GraphQL call per repository; `sessions --json`
 * and the queue read the cache it leaves. Without gh, or signed out, it says so
 * in one line with the fix — Agent Switch never asks for or stores a token.
 */

import { spawnSync } from "node:child_process";

import { eventFile, readEvents } from "../hooks.js";
import { configDir, die, listProfiles, ROOT } from "../profiles.js";
import { listCodexSessions, listSessions, markLive, type SessionRow } from "../sessions.js";
import { githubRepo, prCacheFile, prsForHead, readPrCache, refreshRepos, writePrCache, type PullRequest } from "../pr-facts.js";
import type { ProviderId } from "../providers.js";
import { gitFor } from "./sessions.js";
import type { GitFacts } from "../git-facts.js";

export interface SessionGitRow {
  key: string;
  row: SessionRow;
  git: (GitFacts & { cwd: string; cwdSource: string }) | null;
}

/** Recent sessions of every Claude and Codex account, with their git facts. */
export function sessionsWithGit(limit = 10): SessionGitRow[] {
  const out: SessionGitRow[] = [];
  for (const providerId of ["claude", "codex"] as ProviderId[]) {
    for (const p of listProfiles(providerId)) {
      const cfg = configDir(providerId, p);
      const rows = providerId === "codex" ? listCodexSessions(cfg, limit) : listSessions(cfg, limit);
      if (providerId === "claude") markLive(cfg, rows);
      const events = providerId === "claude" ? readEvents(eventFile(ROOT, providerId, p)) : [];
      for (const r of rows) out.push({ key: `${providerId}/${p}/${r.sessionId}`, row: r, git: gitFor(r, events) });
    }
  }
  return out;
}

/** Refresh the PR cache for the repositories these sessions work in. */
export function refreshForSessions(rows: readonly SessionGitRow[], force: boolean) {
  const repos = new Map<string, { anyLive: boolean }>();
  for (const r of rows) {
    const repo = githubRepo(r.git?.remote ?? null);
    if (!repo) continue;
    repos.set(repo, { anyLive: (repos.get(repo)?.anyLive ?? false) || r.row.live });
  }
  const file = prCacheFile(ROOT);
  const res = refreshRepos(readPrCache(file), repos, { force });
  if (res.calls > 0) writePrCache(file, res.cache);
  return { ...res, repos: repos.size };
}

export function cmdPr(sub: string | undefined, flags: Record<string, string | boolean>): void {
  if ((sub ?? "status") !== "status") die("usage: agent-switch pr status [--json] [--refresh]");
  const rows = sessionsWithGit();
  const { cache, problem, errors, calls, repos } = refreshForSessions(rows, !!flags.refresh);
  const withPr = rows
    .map((r) => {
      const repo = githubRepo(r.git?.remote ?? null);
      return { key: r.key, branch: r.git?.branch ?? null, repo, prs: repo ? prsForHead(cache, repo, r.git?.headSha ?? null) : [] };
    })
    .filter((r) => r.repo);
  if (flags.json) {
    console.log(JSON.stringify({ problem: problem ? { message: problem.message, fix: problem.fix } : null, errors, calls, repos, sessions: withPr }, null, 2));
    return;
  }
  if (problem) console.log(`PRs unavailable: ${problem.message}. Fix: ${problem.fix}`);
  for (const e of errors) console.log(`  ${e}`);
  if (withPr.length === 0) {
    console.log("No session works in a GitHub repository.");
    return;
  }
  for (const r of withPr) {
    const pr = r.prs[0];
    console.log(`${r.key}  ${r.branch ?? "(detached)"}  ${pr ? describe(pr) + (r.prs.length > 1 ? ` (+${r.prs.length - 1} more on this commit)` : "") : "no PR"}`);
  }
}

function describe(p: PullRequest): string {
  const ci = p.ci === "FAILURE" ? `CI failing: ${p.failingChecks.join(", ") || "checks"}` : `CI ${p.ci.toLowerCase()}`;
  return `#${p.number} ${p.lifecycle.toLowerCase()} · ${p.mergeable === "CONFLICTING" ? "conflict" : p.mergeable.toLowerCase()} · review ${p.review.toLowerCase().replace(/_/g, " ")} · ${ci}`;
}

/** `git worktree list --porcelain` for one repository. Pure parse. */
export function parseWorktrees(out: string): { path: string; head: string | null; branch: string | null }[] {
  return out
    .split("\n\n")
    .map((block) => {
      const get = (k: string) => block.split("\n").find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? null;
      const branch = get("branch");
      return { path: get("worktree")!, head: get("HEAD"), branch: branch ? branch.replace(/^refs\/heads\//, "") : null };
    })
    .filter((w) => w.path);
}

export function cmdWorktrees(flags: Record<string, string | boolean>): void {
  const rows = sessionsWithGit();
  const byRepo = new Map<string, SessionGitRow[]>();
  for (const r of rows) {
    if (!r.git) continue;
    // Linked worktrees share one repository: group by the main checkout.
    const main = spawnSync("git", ["-C", r.git.toplevel, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 1000 }).stdout?.trim();
    const key = main || r.git.toplevel;
    byRepo.set(key, [...(byRepo.get(key) ?? []), r]);
  }
  const result = [...byRepo.entries()].map(([common, sessions]) => {
    const out = spawnSync("git", ["-C", sessions[0].git!.toplevel, "worktree", "list", "--porcelain"], { encoding: "utf8", timeout: 1000 }).stdout ?? "";
    return {
      repository: common.replace(/\/\.git$/, ""),
      worktrees: parseWorktrees(out).map((w) => ({ ...w, sessions: sessions.filter((s) => s.git!.toplevel === w.path).map((s) => s.key) })),
    };
  });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.length === 0) console.log("No session works in a git repository.");
  for (const r of result) {
    console.log(r.repository);
    for (const w of r.worktrees) console.log(`  ${w.path}  ${w.branch ?? "(detached)"}${w.sessions.length ? `  ← ${w.sessions.join(", ")}` : ""}`);
  }
}
