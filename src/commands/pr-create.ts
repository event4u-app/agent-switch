/**
 * `agent-switch pr create <session> [--base B] [--title T] [--yes] [--json]` —
 * push a session's branch and open its pull request with the GitHub CLI. Without
 * --yes it only says what it would do: branch, base, title, whether a push is
 * needed and what stays out. Every git and gh argument is passed as argv.
 */

import { spawnSync } from "node:child_process";

import { die } from "../profiles.js";
import { target } from "./bridge.js";

export type PrRunner = (cmd: "git" | "gh", cwd: string, args: string[]) => { ok: boolean; out: string; err: string; missing?: boolean };

export const runPr: PrRunner = (cmd, cwd, args) => {
  const r =
    cmd === "git"
      ? spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 60_000 })
      : spawnSync("gh", args, { cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } });
  if (r.error) return { ok: false, out: "", err: String((r.error as NodeJS.ErrnoException).code ?? r.error.message), missing: (r.error as NodeJS.ErrnoException).code === "ENOENT" };
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
};

export class PrRefused extends Error {}

export interface PrPlan {
  branch: string | null;
  base: string | null;
  remote: string;
  /** The branch's upstream (`origin/feat`), null when the push sets it. */
  upstream: string | null;
  /** Commits the push sends (against the upstream, else the remote's base); null when unknown. */
  ahead: number | null;
  title: string;
  /** Files with changes that are not committed and so not in the PR. */
  uncommitted: number;
  /** Why it cannot go ahead, with the fix. */
  problem: { message: string; fix: string } | null;
}

const line = (s: string) => s.trim().split("\n")[0] ?? "";

/** The main line on `remote`, as a branch name: its HEAD, else main or master. */
function baseBranch(cwd: string, run: PrRunner, remote: string): string | null {
  const head = run("git", cwd, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
  if (head.ok && line(head.out)) return line(head.out).replace(`${remote}/`, "");
  for (const b of ["main", "master"]) for (const ref of [`refs/remotes/${remote}/${b}`, `refs/heads/${b}`]) if (run("git", cwd, ["rev-parse", "--verify", "--quiet", ref]).ok) return b;
  return null;
}

/** What `pr create` would do in `cwd`. */
export function prPlan(cwd: string, run: PrRunner = runPr, opts: { base?: string; title?: string } = {}): PrPlan {
  const b = run("git", cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = b.ok && line(b.out) ? line(b.out) : null;
  const remote = (branch && line(run("git", cwd, ["config", `branch.${branch}.remote`]).out)) || "origin";
  const base = opts.base || baseBranch(cwd, run, remote);
  const u = run("git", cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const upstream = u.ok && line(u.out) ? line(u.out) : null;
  const against = upstream ?? (base ? `${remote}/${base}` : null);
  const count = against ? run("git", cwd, ["rev-list", "--count", `${against}..HEAD`]) : null;
  const ahead = count?.ok ? Number(line(count.out)) : null;
  const title = opts.title?.trim() || line(run("git", cwd, ["log", "-1", "--format=%s"]).out);
  const uncommitted = run("git", cwd, ["status", "--porcelain=v1"]).out.split("\n").filter(Boolean).length;
  const plan: PrPlan = { branch, base, remote, upstream, ahead, title, uncommitted, problem: null };
  const problem = (message: string, fix: string) => ({ ...plan, problem: { message, fix } });
  if (!branch) return problem("HEAD is on no branch", "check out a branch first");
  if (!base) return problem(`no main line was found on ${remote}`, "pass --base <branch>");
  if (branch === base) return problem(`the session is on ${base}, the branch a PR would go into`, "start a branch for the change first");
  if (!run("git", cwd, ["remote", "get-url", remote]).ok) return problem(`the repository has no remote ${remote}`, `git remote add ${remote} <url>`);
  const gh = run("gh", cwd, ["--version"]);
  if (gh.missing || !gh.ok) return problem("the GitHub CLI (gh) is not installed", "install gh: https://cli.github.com");
  const auth = run("gh", cwd, ["auth", "status"]);
  if (!auth.ok) return problem("gh is not signed in", "gh auth login");
  return plan;
}

/** Push the branch (setting its upstream when it has none), then `gh pr create --fill`. Returns the PR's URL. */
export function prCreate(cwd: string, run: PrRunner = runPr, opts: { base?: string; title?: string } = {}): { url: string; plan: PrPlan } {
  const plan = prPlan(cwd, run, opts);
  if (plan.problem) throw new PrRefused(`${plan.problem.message} — ${plan.problem.fix}`);
  const branch = plan.branch!;
  const push = run("git", cwd, plan.upstream ? ["push", plan.remote, branch] : ["push", "--set-upstream", plan.remote, branch]);
  if (!push.ok) throw new PrRefused(`git push failed: ${line(push.err) || "no reason given"}`);
  const pr = run("gh", cwd, ["pr", "create", "--fill", "--head", branch, "--base", plan.base!, "--title", plan.title]);
  if (!pr.ok) throw new PrRefused(`gh pr create failed: ${line(pr.err) || "no reason given"}`);
  const url = pr.out.trim().split("\n").reverse().find((l) => /^https?:\/\//.test(l.trim()))?.trim() ?? pr.out.trim();
  return { url, plan };
}

export function cmdPrCreate(arg: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg) die("usage: agent-switch pr create <session> [--base B] [--title T] [--yes] [--json]");
  const cwd = target(arg).cwd;
  const opts = { base: typeof flags.base === "string" ? flags.base : undefined, title: typeof flags.title === "string" ? flags.title : undefined };
  const json = !!flags.json;
  if (!flags.yes) {
    const p = prPlan(cwd, runPr, opts);
    if (json) return void console.log(JSON.stringify(p));
    if (p.problem) die(`${p.problem.message}. Fix: ${p.problem.fix}`);
    console.log(`Would push ${p.branch} to ${p.remote}${p.upstream ? "" : " (setting its upstream)"} and open a PR into ${p.base}: "${p.title}".`);
    if (p.uncommitted) console.log(`${p.uncommitted} uncommitted ${p.uncommitted === 1 ? "file stays" : "files stay"} out of it.`);
    return void console.log("Run again with --yes to do it.");
  }
  try {
    const r = prCreate(cwd, runPr, opts);
    console.log(json ? JSON.stringify({ ok: true, url: r.url, done: `opened ${r.url}` }) : `Opened ${r.url}`);
  } catch (err) {
    if (!(err instanceof PrRefused)) throw err;
    if (json) {
      console.log(JSON.stringify({ ok: false, error: err.message }));
      process.exitCode = 2;
      return;
    }
    die(err.message);
  }
}
