import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { prCreate, prPlan, PrRefused, type PrRunner } from "../src/commands/pr-create.js";

/** A repo on `feat` with one commit past main, an `origin` that is never pushed to. */
function repo(): string {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-prc-")));
  const g = (...a: string[]) => execFileSync("git", ["-C", r, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(r, "a.txt"), "a\n");
  g("add", ".");
  g("commit", "-qm", "base");
  g("remote", "add", "origin", "https://github.com/o/r.git");
  g("checkout", "-qb", "feat");
  fs.writeFileSync(path.join(r, "a.txt"), "b\n");
  g("commit", "-qam", "feat: the change");
  fs.writeFileSync(path.join(r, "dirty.txt"), "x\n");
  return r;
}

/** Real git for reads; push and every gh call are recorded and answered here, never run. */
function runner(gh: (args: string[]) => ReturnType<PrRunner> = (a) => (a[0] === "pr" ? { ok: true, out: "https://github.com/o/r/pull/7\n", err: "" } : { ok: true, out: "", err: "" })) {
  const calls: string[][] = [];
  const run: PrRunner = (cmd, cwd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "gh") return gh(args);
    if (args[0] === "push") return { ok: true, out: "", err: "" };
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
  };
  return { run, calls };
}

test("the plan names branch, base, title, upstream and what stays out", () => {
  const r = repo();
  const p = prPlan(r, runner().run);
  assert.deepEqual(
    { branch: p.branch, base: p.base, remote: p.remote, upstream: p.upstream, title: p.title, uncommitted: p.uncommitted, problem: p.problem },
    { branch: "feat", base: "main", remote: "origin", upstream: null, title: "feat: the change", uncommitted: 1, problem: null },
  );
  assert.equal(prPlan(r, runner().run, { title: "Mine", base: "dev" }).title, "Mine");
  assert.equal(prPlan(r, runner().run, { base: "dev" }).base, "dev");
});

test("create pushes with an upstream, then gh pr create --fill with branch, base and title as argv", () => {
  const r = repo();
  const { run, calls } = runner();
  const res = prCreate(r, run, {});
  assert.equal(res.url, "https://github.com/o/r/pull/7");
  const push = calls.find((c) => c[1] === "push");
  assert.deepEqual(push, ["git", "push", "--set-upstream", "origin", "feat"]);
  const create = calls.find((c) => c[0] === "gh" && c[1] === "pr");
  assert.deepEqual(create, ["gh", "pr", "create", "--fill", "--head", "feat", "--base", "main", "--title", "feat: the change"]);
  assert.ok(calls.indexOf(push!) < calls.indexOf(create!), "pushed before the PR");
});

test("an existing upstream is pushed to as is", () => {
  const r = repo();
  execFileSync("git", ["-C", r, "config", "branch.feat.remote", "origin"]);
  execFileSync("git", ["-C", r, "config", "branch.feat.merge", "refs/heads/feat"]);
  execFileSync("git", ["-C", r, "update-ref", "refs/remotes/origin/feat", "HEAD~1"]);
  const { run, calls } = runner();
  assert.equal(prPlan(r, run).upstream, "origin/feat");
  prCreate(r, run, {});
  assert.deepEqual(calls.find((c) => c[1] === "push"), ["git", "push", "origin", "feat"]);
});

test("gh missing or signed out: said with the fix, nothing pushed", () => {
  const r = repo();
  const missing = runner(() => ({ ok: false, out: "", err: "ENOENT", missing: true }));
  assert.match(prPlan(r, missing.run).problem!.message, /not installed/);
  assert.throws(() => prCreate(r, missing.run, {}), (e: unknown) => e instanceof PrRefused && /not installed.*cli\.github\.com/.test(e.message));
  assert.ok(!missing.calls.some((c) => c[1] === "push"));
  const out = runner((a) => (a[0] === "auth" ? { ok: false, out: "", err: "You are not logged into any GitHub hosts. Run gh auth login" } : { ok: true, out: "", err: "" }));
  assert.throws(() => prCreate(r, out.run, {}), (e: unknown) => e instanceof PrRefused && /not signed in.*gh auth login/.test(e.message));
  assert.ok(!out.calls.some((c) => c[1] === "push"));
});

test("refused on the base branch, detached, or when the push fails; gh's own refusal is passed on", () => {
  const r = repo();
  execFileSync("git", ["-C", r, "checkout", "-q", "main"]);
  assert.match(prPlan(r, runner().run).problem!.message, /on main/);
  execFileSync("git", ["-C", r, "checkout", "-q", "--detach", "feat"]);
  assert.match(prPlan(r, runner().run).problem!.message, /no branch/);
  execFileSync("git", ["-C", r, "checkout", "-q", "feat"]);
  const failPush: PrRunner = (cmd, cwd, args) => (cmd === "git" && args[0] === "push" ? { ok: false, out: "", err: "rejected" } : runner().run(cmd, cwd, args));
  assert.throws(() => prCreate(r, failPush, {}), /git push failed: rejected/);
  const exists = runner((a) => (a[0] === "pr" ? { ok: false, out: "", err: "a pull request for branch \"feat\" into branch \"main\" already exists:\nhttps://x" } : { ok: true, out: "", err: "" }));
  assert.throws(() => prCreate(r, exists.run, {}), /already exists/);
});
