import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { prCreate, prPlan, PrRefused, type PrRunner } from "../src/commands/pr-create.js";

const git = (r: string, ...a: string[]) => execFileSync("git", ["-C", r, ...a], { encoding: "utf8" }).trim();

/** A repo on `feat` with one commit past main, an `origin` on GitHub that is never pushed to here. */
function repo(): string {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-prc-")));
  git(r, "init", "-q", "-b", "main");
  git(r, "config", "user.name", "t");
  git(r, "config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(r, "a.txt"), "a\n");
  git(r, "add", ".");
  git(r, "commit", "-qm", "base");
  git(r, "remote", "add", "origin", "https://github.com/o/r.git");
  git(r, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(r, "checkout", "-qb", "feat");
  fs.writeFileSync(path.join(r, "a.txt"), "b\n");
  git(r, "commit", "-qam", "feat: the change");
  fs.writeFileSync(path.join(r, "dirty.txt"), "x\n");
  return r;
}

type Gh = (args: string[]) => ReturnType<PrRunner>;
const okGh: Gh = (a) =>
  a[0] === "pr" && a[1] === "create" ? { ok: true, out: "https://github.com/o/r/pull/7\n", err: "" } : a[0] === "pr" && a[1] === "list" ? { ok: true, out: "[]\n", err: "" } : { ok: true, out: "", err: "" };

/** Real git for reads; push (unless `realPush`), ls-remote and every gh call are recorded and answered here, never run.
 *  The remote's branches are its tracking refs here, unless `remoteHeads` says what the remote has. */
function runner(gh: Gh = okGh, realPush = false, remoteHeads?: string[]) {
  const calls: string[][] = [];
  const run: PrRunner = (cmd, cwd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "gh") return gh(args);
    if (args[0] === "push" && !realPush) return { ok: true, out: "", err: "" };
    if (args[0] === "ls-remote") {
      const [remote, ref] = args.slice(-2);
      const name = ref.replace(/^refs\/heads\//, "");
      const has = remoteHeads ? remoteHeads.includes(name) : spawnSync("git", ["-C", cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${name}`]).status === 0;
      return { ok: true, out: has ? `0000000000000000000000000000000000000000\t${ref}\n` : "", err: "" };
    }
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
  };
  return { run, calls };
}
const pushed = (calls: string[][]) => calls.some((c) => c[0] === "git" && c[1] === "push");

test("the plan names branch, head, remote, destination ref, base, title, bases and what stays out", () => {
  const r = repo();
  git(r, "update-ref", "refs/remotes/origin/dev/v3", "main");
  const p = prPlan(r, runner().run);
  assert.deepEqual(
    { branch: p.branch, head: p.head, base: p.base, remote: p.remote, ref: p.ref, upstream: p.upstream, setsUpstream: p.setsUpstream, ahead: p.ahead, title: p.title, uncommitted: p.uncommitted, existing: p.existing, problem: p.problem },
    { branch: "feat", head: git(r, "rev-parse", "HEAD"), base: "main", remote: "origin", ref: "refs/heads/feat", upstream: null, setsUpstream: true, ahead: 1, title: "feat: the change", uncommitted: 1, existing: null, problem: null },
  );
  assert.deepEqual(p.bases, ["dev/v3", "main"]);
  assert.equal(prPlan(r, runner().run, { title: "Mine" }).title, "Mine");
  assert.equal(prPlan(r, runner().run, { base: "dev/v3" }).base, "dev/v3");
});

test("the title defaults to the first commit subject ahead of the base, not the last one", () => {
  const r = repo();
  git(r, "commit", "-q", "--allow-empty", "-m", "fix: a later tweak");
  const p = prPlan(r, runner().run);
  assert.equal(p.ahead, 2);
  assert.equal(p.title, "feat: the change");
});

test("no commits ahead of the base: refused before any push, with the fix", () => {
  const r = repo();
  git(r, "update-ref", "refs/remotes/origin/main", "feat");
  const { run, calls } = runner();
  const p = prPlan(r, run);
  assert.equal(p.ahead, 0);
  assert.match(p.problem!.message, /no commits ahead of main/);
  assert.match(p.problem!.fix, /commit/);
  assert.throws(() => prCreate(r, run, {}), (e: unknown) => e instanceof PrRefused && /no commits ahead of main/.test(e.message));
  assert.ok(!pushed(calls));
});

test("a base the remote does not have is refused with the fix", () => {
  const r = repo();
  const p = prPlan(r, runner().run, { base: "nope" });
  assert.match(p.problem!.message, /nope/);
  assert.match(p.problem!.fix, /fetch|another base/);
});

test("a PR already open for the head: refused before any push, its URL returned", () => {
  const r = repo();
  const gh: Gh = (a) => (a[0] === "pr" && a[1] === "list" ? { ok: true, out: '[{"number":142,"url":"https://github.com/o/r/pull/142"}]', err: "" } : okGh(a));
  const { run, calls } = runner(gh);
  const p = prPlan(r, run);
  assert.deepEqual(p.existing, { number: 142, url: "https://github.com/o/r/pull/142" });
  assert.match(p.problem!.message, /#142 is already open/);
  assert.throws(() => prCreate(r, run, {}), (e: unknown) => e instanceof PrRefused && e.url === "https://github.com/o/r/pull/142");
  assert.ok(!pushed(calls));
  const list = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "list")!;
  assert.deepEqual(list.slice(list.indexOf("--head"), list.indexOf("--head") + 2), ["--head", "feat"]);
});

test("a remote that is not on GitHub is refused before any push", () => {
  const r = repo();
  git(r, "remote", "set-url", "origin", "git@gitlab.com:o/r.git");
  const gh: Gh = (a) => (a[0] === "auth" && a.includes("gitlab.com") ? { ok: false, out: "", err: "not logged in to gitlab.com" } : okGh(a));
  const { run, calls } = runner(gh);
  assert.match(prPlan(r, run).problem!.message, /gitlab\.com.*not a GitHub host/);
  assert.throws(() => prCreate(r, run, {}), PrRefused);
  assert.ok(!pushed(calls));
  git(r, "remote", "set-url", "origin", "/srv/git/r.git");
  assert.match(prPlan(r, runner().run).problem!.message, /not on GitHub/);
});

test("create pushes the confirmed commit to the full destination ref, sets the upstream, then gh pr create with argv", () => {
  const r = repo();
  const { run, calls } = runner();
  const head = git(r, "rev-parse", "HEAD");
  const res = prCreate(r, run, { expect: { branch: "feat", head, remote: "origin", ref: "refs/heads/feat" } });
  assert.equal(res.url, "https://github.com/o/r/pull/7");
  const push = calls.find((c) => c[1] === "push");
  assert.deepEqual(push, ["git", "push", "https://github.com/o/r.git", `${head}:refs/heads/feat`]);
  assert.equal(git(r, "config", "branch.feat.remote"), "origin");
  assert.equal(git(r, "config", "branch.feat.merge"), "refs/heads/feat");
  const create = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create");
  assert.deepEqual(create, ["gh", "pr", "create", "--repo", "o/r", "--fill", "--head", "feat", "--base", "main", "--title", "feat: the change"]);
  assert.ok(calls.indexOf(push!) < calls.indexOf(create!), "pushed before the PR");
});

test("what changed since the preview is refused before any push: branch, head, remote, destination", () => {
  const r = repo();
  const head = git(r, "rev-parse", "HEAD");
  const confirmed = { branch: "feat", head, remote: "origin", ref: "refs/heads/feat" };
  git(r, "commit", "-q", "--allow-empty", "-m", "a commit after the preview");
  const moved = runner();
  assert.throws(() => prCreate(r, moved.run, { expect: confirmed }), (e: unknown) => e instanceof PrRefused && /HEAD changed since the preview/.test(e.message));
  assert.ok(!pushed(moved.calls));
  git(r, "checkout", "-qb", "other");
  const switched = runner();
  assert.throws(() => prCreate(r, switched.run, { expect: confirmed }), /branch changed since the preview: was feat, now other/);
  assert.ok(!pushed(switched.calls));
  git(r, "checkout", "-q", "feat");
  git(r, "reset", "-q", "--hard", head);
  git(r, "config", "branch.feat.pushRemote", "fork");
  git(r, "remote", "add", "fork", "https://github.com/me/r.git");
  const remote = runner();
  assert.throws(() => prCreate(r, remote.run, { expect: confirmed }), /remote changed since the preview: was origin, now fork/);
  assert.ok(!pushed(remote.calls));
});

test("an upstream under another name is the merge target, not the push destination (push.default simple)", () => {
  const r = repo();
  git(r, "update-ref", "refs/remotes/origin/release-fix", "main");
  git(r, "config", "branch.feat.remote", "origin");
  git(r, "config", "branch.feat.merge", "refs/heads/release-fix");
  const { run, calls } = runner();
  const p = prPlan(r, run);
  assert.deepEqual({ ref: p.ref, base: p.base, setsUpstream: p.setsUpstream }, { ref: "refs/heads/feat", base: "release-fix", setsUpstream: false });
  prCreate(r, run, {});
  assert.deepEqual(calls.find((c) => c[1] === "push"), ["git", "push", "https://github.com/o/r.git", `${git(r, "rev-parse", "HEAD")}:refs/heads/feat`]);
  assert.equal(git(r, "config", "branch.feat.merge"), "refs/heads/release-fix", "the configured upstream is left alone");
});

test("push.default upstream pushes to the upstream's ref and the PR head is that branch", () => {
  const r = repo();
  git(r, "update-ref", "refs/remotes/origin/release-fix", "main");
  git(r, "config", "branch.feat.remote", "origin");
  git(r, "config", "branch.feat.merge", "refs/heads/release-fix");
  git(r, "config", "push.default", "upstream");
  const { run, calls } = runner();
  const p = prPlan(r, run);
  assert.deepEqual({ ref: p.ref, base: p.base }, { ref: "refs/heads/release-fix", base: "main" });
  prCreate(r, run, {});
  assert.deepEqual(calls.find((c) => c[1] === "push"), ["git", "push", "https://github.com/o/r.git", `${git(r, "rev-parse", "HEAD")}:refs/heads/release-fix`]);
  const create = calls.find((c) => c[0] === "gh" && c[2] === "create")!;
  assert.equal(create[create.indexOf("--head") + 1], "release-fix");
});

test("a push remote on a fork opens the PR from owner:branch into the base repository", () => {
  const r = repo();
  git(r, "remote", "add", "fork", "git@github.com:me/r.git");
  git(r, "config", "remote.pushDefault", "fork");
  const { run, calls } = runner();
  const p = prPlan(r, run);
  assert.equal(p.remote, "fork");
  prCreate(r, run, {});
  assert.equal(calls.find((c) => c[1] === "push")![2], "git@github.com:me/r.git");
  const create = calls.find((c) => c[0] === "gh" && c[2] === "create")!;
  assert.deepEqual(create.slice(3, 5), ["--repo", "o/r"]);
  assert.equal(create[create.indexOf("--head") + 1], "me:feat");
});

test("end to end against a local bare remote: the confirmed commit lands under the shown ref; gh stubbed", () => {
  const r = repo();
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-prc-bare-")));
  execFileSync("git", ["init", "-q", "--bare", bare]);
  // origin still reads as github.com/o/r; git itself sends to the bare repository.
  git(r, "config", `url.${bare}.insteadOf`, "https://github.com/o/r.git");
  const { run } = runner(okGh, true);
  const p = prPlan(r, run);
  prCreate(r, run, { expect: { branch: p.branch!, head: p.head!, remote: p.remote, ref: p.ref! } });
  assert.equal(execFileSync("git", ["-C", bare, "rev-parse", "refs/heads/feat"], { encoding: "utf8" }).trim(), p.head);
});

test("gh missing or signed out: said with the fix, nothing pushed", () => {
  const r = repo();
  const missing = runner(() => ({ ok: false, out: "", err: "ENOENT", missing: true }));
  assert.match(prPlan(r, missing.run).problem!.message, /not installed/);
  assert.throws(() => prCreate(r, missing.run, {}), (e: unknown) => e instanceof PrRefused && /not installed.*cli\.github\.com/.test(e.message));
  assert.ok(!pushed(missing.calls));
  const out = runner((a) => (a[0] === "auth" ? { ok: false, out: "", err: "You are not logged into any GitHub hosts. Run gh auth login" } : okGh(a)));
  assert.throws(() => prCreate(r, out.run, {}), (e: unknown) => e instanceof PrRefused && /not signed in.*gh auth login/.test(e.message));
  assert.ok(!pushed(out.calls));
});

test("refused on the base branch, detached, or when the push fails; gh's own refusal keeps its URL", () => {
  const r = repo();
  git(r, "checkout", "-q", "main");
  assert.match(prPlan(r, runner().run).problem!.message, /on main/);
  git(r, "checkout", "-q", "--detach", "feat");
  assert.match(prPlan(r, runner().run).problem!.message, /no branch/);
  git(r, "checkout", "-q", "feat");
  const failPush: PrRunner = (cmd, cwd, args) => (cmd === "git" && args[0] === "push" ? { ok: false, out: "", err: "rejected" } : runner().run(cmd, cwd, args));
  assert.throws(() => prCreate(r, failPush, {}), /git push failed: rejected/);
  const exists = runner((a) => (a[0] === "pr" && a[1] === "create" ? { ok: false, out: "", err: 'a pull request for branch "feat" into branch "main" already exists:\nhttps://github.com/o/r/pull/9' } : okGh(a)));
  assert.throws(() => prCreate(r, exists.run, {}), (e: unknown) => e instanceof PrRefused && /already exists/.test(e.message) && e.url === "https://github.com/o/r/pull/9");
});

test("a base that exists only locally, or that the remote no longer has, is refused before any push", () => {
  const r = repo();
  git(r, "branch", "localonly", "main");
  const local = runner();
  const p = prPlan(r, local.run, { base: "localonly" });
  assert.match(p.problem!.message, /localonly is not a branch on origin/);
  assert.throws(() => prCreate(r, local.run, { base: "localonly" }), PrRefused);
  assert.ok(!pushed(local.calls));
  // origin/main is still tracked here, but the remote itself no longer has main.
  const gone = runner(okGh, false, ["other"]);
  assert.match(prPlan(r, gone.run).problem!.message, /origin no longer has main/);
  assert.throws(() => prCreate(r, gone.run, {}), PrRefused);
  assert.ok(!pushed(gone.calls));
  const unreachable: PrRunner = (cmd, cwd, args) => (cmd === "git" && args[0] === "ls-remote" ? { ok: false, out: "", err: "Could not resolve host" } : runner().run(cmd, cwd, args));
  assert.match(prPlan(r, unreachable).problem!.message, /could not check origin.*Could not resolve host/);
});

test("the plan names the push URL and the PR repository; a confirm refuses when either changed, and the push goes to that URL", () => {
  const r = repo();
  const p = prPlan(r, runner().run);
  assert.deepEqual({ pushUrl: p.pushUrl, repo: p.repo }, { pushUrl: "https://github.com/o/r.git", repo: "o/r" });
  const confirmed = { branch: p.branch!, head: p.head!, remote: p.remote, ref: p.ref!, pushUrl: p.pushUrl!, repo: p.repo! };
  git(r, "config", "remote.origin.pushurl", "https://github.com/evil/r.git");
  const moved = runner();
  assert.throws(() => prCreate(r, moved.run, { expect: confirmed }), /the push URL changed since the preview: was https:\/\/github\.com\/o\/r\.git, now https:\/\/github\.com\/evil\/r\.git/);
  assert.ok(!pushed(moved.calls));
  git(r, "config", "--unset", "remote.origin.pushurl");
  git(r, "remote", "set-url", "origin", "https://github.com/other/r.git");
  const repoMoved = runner();
  assert.throws(() => prCreate(r, repoMoved.run, { expect: { ...confirmed, pushUrl: "https://github.com/other/r.git" } }), /the PR repository changed since the preview: was o\/r, now other\/r/);
  assert.ok(!pushed(repoMoved.calls));
  git(r, "remote", "set-url", "origin", "https://github.com/o/r.git");
  const ok = runner();
  prCreate(r, ok.run, { expect: confirmed });
  assert.equal(ok.calls.find((c) => c[1] === "push")![2], "https://github.com/o/r.git");
  const create = ok.calls.find((c) => c[0] === "gh" && c[2] === "create")!;
  assert.equal(create[create.indexOf("--repo") + 1], "o/r");
  assert.equal(git(r, "rev-parse", "refs/remotes/origin/feat"), p.head, "the tracking ref follows the push");
});

test("a push URL that differs from the fetch URL is where the push goes, and the PR head is named from it", () => {
  const r = repo();
  git(r, "config", "remote.origin.pushurl", "git@github.com:me/r.git");
  const { run, calls } = runner();
  const p = prPlan(r, run);
  assert.equal(p.pushUrl, "git@github.com:me/r.git");
  prCreate(r, run, {});
  assert.equal(calls.find((c) => c[1] === "push")![2], "git@github.com:me/r.git");
  const create = calls.find((c) => c[0] === "gh" && c[2] === "create")!;
  assert.deepEqual([create[create.indexOf("--repo") + 1], create[create.indexOf("--head") + 1]], ["o/r", "me:feat"]);
});
