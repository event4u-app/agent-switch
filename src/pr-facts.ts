/**
 * Pull-request facts for sessions (road-to-agent-switch-v3-central Phase 3).
 *
 * A session's PR is found by what it is working on — head repository and head
 * commit — never by branch name alone, and a commit may belong to several PRs.
 * Lifecycle, mergeability, review and CI are separate axes, each with an
 * honest UNKNOWN. One `gh api graphql` call per repository and refresh fetches
 * every PR the repo's sessions could match; results are cached on disk with the
 * rate limit GitHub reported, so the cadence can back off. Agent Switch never
 * stores a GitHub token: `gh` holds the login.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type Lifecycle = "OPEN" | "DRAFT" | "MERGED" | "CLOSED";
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type Review = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "NONE" | "UNKNOWN";
export type Ci = "SUCCESS" | "FAILURE" | "PENDING" | "NONE" | "UNKNOWN";

export interface PullRequest {
  repo: string;
  number: number;
  url: string;
  headRepo: string;
  headSha: string;
  lifecycle: Lifecycle;
  mergeable: Mergeable;
  review: Review;
  ci: Ci;
  failingChecks: string[];
  updatedAt: string;
}

export interface RepoCache {
  fetchedAt: string;
  prs: PullRequest[];
  /** GitHub's own count: what is left of the hourly GraphQL budget. */
  rateRemaining: number | null;
  rateLimit: number | null;
}

export type Cache = Record<string, RepoCache>;

/** `owner/name` from a GitHub remote URL, or null for anything else. Pure. */
export function githubRepo(remote: string | null): string | null {
  if (!remote) return null;
  const m = /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export const PR_QUERY = `query($owner: String!, $name: String!) {
  rateLimit { remaining limit }
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number url state isDraft mergeable reviewDecision updatedAt headRefOid
        headRepository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 50) {
          nodes { __typename ... on CheckRun { name conclusion status } ... on StatusContext { context state } }
        } } } } }
      }
    }
  }
}`;

const CI_MAP: Record<string, Ci> = { SUCCESS: "SUCCESS", FAILURE: "FAILURE", ERROR: "FAILURE", PENDING: "PENDING", EXPECTED: "PENDING" };
const FAILED_RUN = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** GraphQL answer → PRs with separate axes. Pure. */
export function parsePrResponse(repo: string, body: any): { prs: PullRequest[]; rateRemaining: number | null; rateLimit: number | null } {
  const nodes: any[] = body?.data?.repository?.pullRequests?.nodes ?? [];
  const prs = nodes.map((n): PullRequest => {
    const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
    const contexts: any[] = rollup?.contexts?.nodes ?? [];
    const failingChecks = contexts
      .filter((c) => (c.__typename === "CheckRun" ? FAILED_RUN.has(c.conclusion) : c.state === "FAILURE" || c.state === "ERROR"))
      .map((c) => String(c.name ?? c.context))
      .slice(0, 20);
    return {
      repo,
      number: n.number,
      url: n.url,
      headRepo: n.headRepository?.nameWithOwner ?? repo,
      headSha: n.headRefOid,
      lifecycle: n.state === "MERGED" ? "MERGED" : n.state === "CLOSED" ? "CLOSED" : n.isDraft ? "DRAFT" : "OPEN",
      mergeable: n.mergeable === "MERGEABLE" || n.mergeable === "CONFLICTING" ? n.mergeable : "UNKNOWN",
      review: n.reviewDecision === "APPROVED" || n.reviewDecision === "CHANGES_REQUESTED" || n.reviewDecision === "REVIEW_REQUIRED" ? n.reviewDecision : n.reviewDecision === null ? "NONE" : "UNKNOWN",
      ci: rollup === null ? "NONE" : (CI_MAP[rollup.state] ?? "UNKNOWN"),
      failingChecks,
      updatedAt: n.updatedAt,
    };
  });
  const rl = body?.data?.rateLimit;
  return { prs, rateRemaining: typeof rl?.remaining === "number" ? rl.remaining : null, rateLimit: typeof rl?.limit === "number" ? rl.limit : null };
}

/** The PRs whose head is exactly this commit (several are allowed), newest first. Pure. */
export function prsForHead(cache: Cache, repo: string, headSha: string | null): PullRequest[] {
  if (!headSha) return [];
  return (cache[repo]?.prs ?? []).filter((p) => p.headSha === headSha).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type GhRunner = (args: string[]) => { ok: boolean; out: string; err: string; missing?: boolean };

export const runGh: GhRunner = (args) => {
  const r = spawnSync("gh", args, { encoding: "utf8", timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } });
  if (r.error) return { ok: false, out: "", err: String((r.error as NodeJS.ErrnoException).code ?? r.error.message), missing: (r.error as NodeJS.ErrnoException).code === "ENOENT" };
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
};

export class GhUnavailable extends Error {
  constructor(message: string, readonly fix: string) {
    super(message);
  }
}

/** One GraphQL call for one repository. Throws GhUnavailable with a fix when gh is missing or signed out. */
export function fetchRepo(repo: string, gh: GhRunner = runGh, now = new Date()): RepoCache {
  const [owner, name] = repo.split("/");
  const r = gh(["api", "graphql", "-f", `query=${PR_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`]);
  if (r.missing) throw new GhUnavailable("the GitHub CLI (gh) is not installed", "install gh: https://cli.github.com");
  if (!r.ok) {
    if (/auth login|not logged|authentication/i.test(r.err)) throw new GhUnavailable("gh is not signed in", "gh auth login");
    throw new Error(`gh could not read ${repo}: ${r.err.split("\n")[0].slice(0, 200)}`);
  }
  const parsed = parsePrResponse(repo, JSON.parse(r.out));
  return { fetchedAt: now.toISOString(), prs: parsed.prs, rateRemaining: parsed.rateRemaining, rateLimit: parsed.rateLimit };
}

/**
 * How long until a repo should be read again: 60 s while one of its sessions
 * runs, 5 min otherwise, doubled under rate-limit pressure (less than 20 % of
 * the budget left). Pure.
 */
export function refreshIntervalMs(entry: RepoCache | undefined, anyLive: boolean): number {
  const base = anyLive ? 60_000 : 300_000;
  if (entry?.rateRemaining != null && entry.rateLimit && entry.rateRemaining < entry.rateLimit * 0.2) return base * 2;
  return base;
}

export function due(entry: RepoCache | undefined, anyLive: boolean, nowMs: number): boolean {
  return !entry || nowMs - Date.parse(entry.fetchedAt) >= refreshIntervalMs(entry, anyLive);
}

export function prCacheFile(root: string): string {
  return path.join(root, "pr-cache.json");
}

export function readPrCache(file: string): Cache {
  try {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export function writePrCache(file: string, cache: Cache): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Refresh every repo in `repos` that is due (all of them with `force`), one call
 * each. MERGED and CLOSED PRs stay in the cache. Returns the updated cache and
 * the first gh problem, if any — a missing gh stops the round, it is not retried
 * per repo.
 */
export function refreshRepos(cache: Cache, repos: ReadonlyMap<string, { anyLive: boolean }>, opts: { force?: boolean; gh?: GhRunner; now?: Date } = {}): { cache: Cache; calls: number; problem: GhUnavailable | null; errors: string[] } {
  const now = opts.now ?? new Date();
  const next: Cache = { ...cache };
  let calls = 0;
  const errors: string[] = [];
  for (const [repo, { anyLive }] of repos) {
    if (!opts.force && !due(next[repo], anyLive, now.getTime())) continue;
    calls++;
    try {
      next[repo] = fetchRepo(repo, opts.gh, now);
    } catch (err) {
      if (err instanceof GhUnavailable) return { cache: next, calls, problem: err, errors };
      errors.push((err as Error).message);
    }
  }
  return { cache: next, calls, problem: null, errors };
}
