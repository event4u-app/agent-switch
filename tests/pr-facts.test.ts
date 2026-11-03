import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { githubRepo, parsePrResponse, prsForHead, refreshRepos, refreshIntervalMs, due, readPrCache, writePrCache, prCacheFile, type GhRunner } from "../src/pr-facts.js";

const node = (over: Record<string, unknown> = {}) => ({
  number: 311,
  url: "https://github.com/o/r/pull/311",
  state: "OPEN",
  isDraft: false,
  mergeable: "CONFLICTING",
  reviewDecision: "REVIEW_REQUIRED",
  updatedAt: "2026-11-02T10:00:00Z",
  headRefOid: "aaa111",
  headRepository: { nameWithOwner: "o/r" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE", contexts: { nodes: [
    { __typename: "CheckRun", name: "test", conclusion: "FAILURE", status: "COMPLETED" },
    { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS", status: "COMPLETED" },
    { __typename: "StatusContext", context: "deploy", state: "ERROR" },
  ] } } } }] },
  ...over,
});
const body = (nodes: unknown[], rate = { remaining: 4900, limit: 5000 }) => ({ data: { rateLimit: rate, repository: { pullRequests: { nodes } } } });

test("githubRepo reads https, ssh and scp-style remotes; anything else is not GitHub", () => {
  assert.equal(githubRepo("https://github.com/event4u-app/agent-switch.git"), "event4u-app/agent-switch");
  assert.equal(githubRepo("git@github.com:o/r.git"), "o/r");
  assert.equal(githubRepo("ssh://git@github.com/o/r"), "o/r");
  assert.equal(githubRepo("https://gitlab.com/o/r.git"), null);
  assert.equal(githubRepo(null), null);
});

test("parsePrResponse keeps lifecycle, mergeability, review and CI apart, and names failing checks", () => {
  const { prs, rateRemaining } = parsePrResponse("o/r", body([
    node(),
    node({ number: 2, state: "MERGED", mergeable: "UNKNOWN", reviewDecision: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }),
    node({ number: 3, isDraft: true, reviewDecision: "SOMETHING_NEW", commits: { nodes: [{ commit: { statusCheckRollup: { state: "WEIRD", contexts: { nodes: [] } } } }] } }),
  ]));
  assert.deepEqual(prs.map((p) => [p.number, p.lifecycle, p.mergeable, p.review, p.ci]), [
    [311, "OPEN", "CONFLICTING", "REVIEW_REQUIRED", "FAILURE"],
    [2, "MERGED", "UNKNOWN", "NONE", "NONE"],
    [3, "DRAFT", "CONFLICTING", "UNKNOWN", "UNKNOWN"],
  ]);
  assert.deepEqual(prs[0].failingChecks, ["test", "deploy"]);
  assert.equal(rateRemaining, 4900);
});

test("a session's PR is found by its head commit; several PRs on one commit are all listed", () => {
  const cache = { "o/r": { fetchedAt: "t", rateRemaining: null, rateLimit: null, prs: parsePrResponse("o/r", body([node(), node({ number: 9, updatedAt: "2026-11-02T11:00:00Z" }), node({ number: 4, headRefOid: "bbb" })])).prs } };
  assert.deepEqual(prsForHead(cache, "o/r", "aaa111").map((p) => p.number), [9, 311]);
  assert.deepEqual(prsForHead(cache, "o/r", null), []);
  assert.deepEqual(prsForHead(cache, "x/y", "aaa111"), []);
});

test("cadence: 60 s with a live session, 5 min idle, doubled when the rate limit runs low", () => {
  assert.equal(refreshIntervalMs(undefined, true), 60_000);
  assert.equal(refreshIntervalMs(undefined, false), 300_000);
  assert.equal(refreshIntervalMs({ fetchedAt: "t", prs: [], rateRemaining: 500, rateLimit: 5000 }, true), 120_000);
  const fresh = { fetchedAt: new Date(1_000_000).toISOString(), prs: [], rateRemaining: null, rateLimit: null };
  assert.equal(due(fresh, true, 1_000_000 + 59_000), false);
  assert.equal(due(fresh, true, 1_000_000 + 60_000), true);
});

test("refreshRepos: one gh call per due repo; MERGED stays; a missing gh stops with a fix, never a token", () => {
  const calls: string[][] = [];
  const gh: GhRunner = (args) => (calls.push(args), { ok: true, out: JSON.stringify(body([node({ state: "MERGED" })])), err: "" });
  const repos = new Map([["o/r", { anyLive: true }], ["o/s", { anyLive: false }]]);
  const now = new Date("2026-11-02T10:00:00Z");
  const first = refreshRepos({}, repos, { gh, now });
  assert.equal(first.calls, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("graphql"));
  assert.equal(first.cache["o/r"].prs[0].lifecycle, "MERGED");
  assert.equal(refreshRepos(first.cache, repos, { gh, now: new Date(now.getTime() + 30_000) }).calls, 0, "not due yet");
  assert.equal(refreshRepos(first.cache, repos, { gh, now: new Date(now.getTime() + 61_000) }).calls, 1, "only the live repo is due");

  const missing = refreshRepos({}, repos, { gh: () => ({ ok: false, out: "", err: "ENOENT", missing: true }), now });
  assert.match(missing.problem!.message, /not installed/);
  assert.equal(missing.calls, 1, "stops after the first: no per-repo retries");
  const signedOut = refreshRepos({}, repos, { gh: () => ({ ok: false, out: "", err: "To get started with GitHub CLI, please run:  gh auth login" }), now });
  assert.equal(signedOut.problem!.fix, "gh auth login");
});

test("the PR cache file is private and tolerates damage", () => {
  const f = prCacheFile(fs.mkdtempSync(path.join(os.tmpdir(), "asw-pr-")));
  writePrCache(f, { "o/r": { fetchedAt: "t", prs: [], rateRemaining: 1, rateLimit: 2 } });
  assert.equal(readPrCache(f)["o/r"].rateLimit, 2);
  if (process.platform !== "win32") assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  fs.writeFileSync(f, "{");
  assert.deepEqual(readPrCache(f), {});
});
