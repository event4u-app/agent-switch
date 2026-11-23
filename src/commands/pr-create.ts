/**
 * `agent-switch pr create <session> [--base B] [--title T] [--yes] [--json]
 * [--expect-branch B --expect-head SHA --expect-remote R --expect-ref REF]` —
 * push a session's branch and open its pull request with the GitHub CLI.
 * Without --yes it only says what it would do: the commit, where it goes (the
 * full destination ref, as `git push` would send it), the base, the title and
 * what stays out. With the --expect-* values of that preview, --yes refuses when
 * any of them changed, so what runs is what was confirmed. Everything it can
 * know before a push is checked before the push. Every git and gh argument is
 * passed as argv.
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

export class PrRefused extends Error {
  /** The PR that already exists, when that is why. */
  constructor(
    message: string,
    readonly url?: string,
  ) {
    super(message);
  }
}

/** What a preview showed and a confirm binds: the push and its target. */
export interface PrConfirmed {
  branch: string;
  head: string;
  remote: string;
  ref: string;
}

export interface PrPlan {
  branch: string | null;
  /** The commit that is pushed (HEAD's sha). */
  head: string | null;
  base: string | null;
  /** The remote the base lives on; the PR opens in its repository. */
  baseRemote: string;
  /** Branches on the base remote a PR could go into (the head's own excluded). */
  bases: string[];
  /** The remote the push goes to: the branch's pushRemote, remote.pushDefault, else its upstream's remote. */
  remote: string;
  /** The full ref the push writes on `remote` (`refs/heads/…`), as push.default resolves it. */
  ref: string | null;
  /** The branch's configured upstream (`origin/feat`), null when it has none. */
  upstream: string | null;
  /** True when the branch has no upstream and the push sets it to `remote`/`ref`. */
  setsUpstream: boolean;
  /** Commits on HEAD that are not on the base: what the PR holds; null when unknown. */
  ahead: number | null;
  title: string;
  /** Files with changes that are not committed and so not in the PR. */
  uncommitted: number;
  /** The open PR for this head, when there is one. */
  existing: { number: number; url: string } | null;
  /** Why it cannot go ahead, with the fix. */
  problem: { message: string; fix: string } | null;
}

const line = (s: string) => s.trim().split("\n")[0] ?? "";
const short = (ref: string) => ref.replace(/^refs\/heads\//, "");

/** `host`, `owner` and `name` of a GitHub-shaped remote URL (https, ssh or scp-like); null for anything else (a path, a nested group). */
export function remoteRepo(url: string): { host: string; owner: string; name: string } | null {
  const m = url.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ?? url.match(/^(?:[^@/:]+@)?([^/:]{2,}):([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { host: m[1].toLowerCase(), owner: m[2], name: m[3] } : null;
}
const slug = (r: { host: string; owner: string; name: string }) => (r.host === "github.com" ? `${r.owner}/${r.name}` : `${r.host}/${r.owner}/${r.name}`);

/** The main line on `remote`, as a branch name: its HEAD, else main or master. */
function defaultBranch(cwd: string, run: PrRunner, remote: string): string | null {
  const head = run("git", cwd, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
  if (head.ok && line(head.out)) return line(head.out).replace(`${remote}/`, "");
  for (const b of ["main", "master"]) for (const ref of [`refs/remotes/${remote}/${b}`, `refs/heads/${b}`]) if (run("git", cwd, ["rev-parse", "--verify", "--quiet", ref]).ok) return b;
  return null;
}

/** What `pr create` would do in `cwd`. */
export function prPlan(cwd: string, run: PrRunner = runPr, opts: { base?: string; title?: string } = {}): PrPlan & { repo: string | null; prHead: string | null } {
  const cfg = (key: string) => line(run("git", cwd, ["config", "--get", key]).out);
  const b = run("git", cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = b.ok && line(b.out) ? line(b.out) : null;
  const h = run("git", cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const head = h.ok && line(h.out) ? line(h.out) : null;
  const upRemote = branch ? cfg(`branch.${branch}.remote`) : "";
  const upMerge = branch ? cfg(`branch.${branch}.merge`) : "";
  const baseRemote = upRemote && upRemote !== "." ? upRemote : "origin";
  const remote = (branch && cfg(`branch.${branch}.pushRemote`)) || cfg("remote.pushDefault") || baseRemote;
  const mode = cfg("push.default") || "simple";
  // Like `git push`: "upstream" sends the branch to the ref it tracks; every other mode to its own name.
  const ref = !branch ? null : (mode === "upstream" || mode === "tracking") && upMerge && remote === upRemote ? upMerge : `refs/heads/${branch}`;
  const name = ref ? short(ref) : null;
  const upstream = upRemote && upMerge ? `${upRemote}/${short(upMerge)}` : null;
  const bases = run("git", cwd, ["for-each-ref", "--format=%(refname)", `refs/remotes/${baseRemote}/`])
    .out.split("\n")
    .map((r) => r.trim().replace(`refs/remotes/${baseRemote}/`, ""))
    .filter((r) => r && r !== "HEAD" && !(remote === baseRemote && r === name))
    .sort();
  // A tracked branch under another name is where this one merges; otherwise the remote's main line.
  const base = opts.base || (upMerge && upRemote === baseRemote && short(upMerge) !== name ? short(upMerge) : defaultBranch(cwd, run, baseRemote));
  const baseRef = base ? [`refs/remotes/${baseRemote}/${base}`, `refs/heads/${base}`].find((r) => run("git", cwd, ["rev-parse", "--verify", "--quiet", r]).ok) ?? null : null;
  const count = baseRef && head ? run("git", cwd, ["rev-list", "--count", `${baseRef}..${head}`]) : null;
  const ahead = count?.ok ? Number(line(count.out)) : null;
  const first = baseRef && head && ahead ? line(run("git", cwd, ["log", "--reverse", "--format=%s", `${baseRef}..${head}`]).out) : "";
  const title = opts.title?.trim() || first;
  const uncommitted = run("git", cwd, ["status", "--porcelain=v1"]).out.split("\n").filter(Boolean).length;
  const baseRepo = remoteRepo(cfg(`remote.${baseRemote}.url`));
  const pushRepo = remoteRepo(cfg(`remote.${remote}.url`));
  const repo = baseRepo ? slug(baseRepo) : null;
  const prHead = name && pushRepo && baseRepo ? (pushRepo.owner !== baseRepo.owner || pushRepo.host !== baseRepo.host ? `${pushRepo.owner}:${name}` : name) : name;
  const plan = { branch, head, base, baseRemote, bases, remote, ref, upstream, setsUpstream: !upMerge, ahead, title, uncommitted, existing: null as PrPlan["existing"], problem: null as PrPlan["problem"], repo, prHead };
  const problem = (message: string, fix: string) => ({ ...plan, problem: { message, fix } });
  if (!branch) return problem("HEAD is on no branch", "check out a branch first");
  if (!head) return problem(`${branch} has no commits`, "commit the changes first");
  for (const r of new Set([baseRemote, remote])) if (!run("git", cwd, ["remote", "get-url", r]).ok) return problem(`the repository has no remote ${r}`, `git remote add ${r} <url>`);
  if (!base) return problem(`no main line was found on ${baseRemote}`, "pass --base <branch>");
  if (name === base && remote === baseRemote) return problem(`the session is on ${base}, the branch a PR would go into`, "start a branch for the change first");
  if (!baseRef) return problem(`${base} is not a branch on ${baseRemote}`, `git fetch ${baseRemote}, or pick another base`);
  if (ahead === 0) return problem(`there are no commits ahead of ${base}`, "commit the changes first, then create the PR");
  for (const [r, parsed] of [[baseRemote, baseRepo], [remote, pushRepo]] as const) if (!parsed) return problem(`the remote ${r} is not on GitHub (${cfg(`remote.${r}.url`) || "no URL"})`, "Create PR works with GitHub remotes; open the PR on your host's site");
  const gh = run("gh", cwd, ["--version"]);
  if (gh.missing || !gh.ok) return problem("the GitHub CLI (gh) is not installed", "install gh: https://cli.github.com");
  for (const host of new Set([baseRepo!.host, pushRepo!.host])) {
    if (run("gh", cwd, ["auth", "status", "--hostname", host]).ok) continue;
    return host === "github.com" ? problem("gh is not signed in", "gh auth login") : problem(`${host} is not a GitHub host gh is signed in to`, `gh auth login --hostname ${host}, or open the PR on ${host}`);
  }
  const list = run("gh", cwd, ["pr", "list", "--repo", repo!, "--head", name!, "--state", "open", "--json", "number,url", "--limit", "1"]);
  let open: { number?: number; url?: string }[] = [];
  try {
    open = list.ok ? (JSON.parse(list.out || "[]") as typeof open) : [];
  } catch {
    open = [];
  }
  const found = open.find((p) => typeof p.number === "number" && typeof p.url === "string");
  if (found) return { ...problem(`PR #${found.number} is already open for ${name}`, `open it: ${found.url}`), existing: { number: found.number!, url: found.url! } };
  return plan;
}

const urlIn = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^https?:\/\//.test(l));

/** Check what was confirmed against the plan now, push HEAD's commit to the destination ref (setting the upstream when there is none), then `gh pr create`. Returns the PR's URL. */
export function prCreate(cwd: string, run: PrRunner = runPr, opts: { base?: string; title?: string; expect?: Partial<PrConfirmed> } = {}): { url: string; plan: PrPlan } {
  const plan = prPlan(cwd, run, opts);
  const labels: Record<keyof PrConfirmed, string> = { branch: "the branch", head: "HEAD", remote: "the remote", ref: "the destination" };
  for (const k of ["branch", "head", "remote", "ref"] as const) {
    const was = opts.expect?.[k];
    if (was === undefined || was === plan[k]) continue;
    const show = (v: string | null) => (k === "head" && v ? v.slice(0, 7) : (v ?? "none"));
    throw new PrRefused(`${labels[k]} changed since the preview: was ${show(was)}, now ${show(plan[k])} — look at Create PR again`);
  }
  if (plan.problem) throw new PrRefused(`${plan.problem.message} — ${plan.problem.fix}`, plan.existing?.url);
  const branch = plan.branch!;
  const push = run("git", cwd, ["push", plan.remote, `${plan.head}:${plan.ref}`]);
  if (!push.ok) throw new PrRefused(`git push failed: ${line(push.err) || "no reason given"}`);
  if (plan.setsUpstream) {
    run("git", cwd, ["config", `branch.${branch}.remote`, plan.remote]);
    run("git", cwd, ["config", `branch.${branch}.merge`, plan.ref!]);
  }
  const pr = run("gh", cwd, ["pr", "create", "--repo", plan.repo!, "--fill", "--head", plan.prHead!, "--base", plan.base!, "--title", plan.title]);
  if (!pr.ok) throw new PrRefused(`gh pr create failed: ${line(pr.err) || "no reason given"}`, urlIn(`${pr.err}\n${pr.out}`));
  return { url: urlIn(pr.out) ?? pr.out.trim(), plan };
}

/** The preview, in words. */
export function prPreview(p: PrPlan): string[] {
  const n = p.ahead ?? 0;
  const out = [
    `Would push ${p.head?.slice(0, 7)} (${p.branch}, ${n} commit${n === 1 ? "" : "s"} ahead of ${p.base}) to ${p.remote} as ${p.ref}${p.setsUpstream ? ", setting it as the upstream" : ""}, and open a PR into ${p.base}: "${p.title}".`,
  ];
  if (p.uncommitted) out.push(`${p.uncommitted} uncommitted ${p.uncommitted === 1 ? "file stays" : "files stay"} out of it.`);
  out.push(`Run again with --yes to do it (add --expect-branch ${p.branch} --expect-head ${p.head} --expect-remote ${p.remote} --expect-ref ${p.ref} to refuse if any of this changes).`);
  return out;
}

export function cmdPrCreate(arg: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg) die("usage: agent-switch pr create <session> [--base B] [--title T] [--yes] [--json] [--expect-branch B --expect-head SHA --expect-remote R --expect-ref REF]");
  const cwd = target(arg).cwd;
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  const expect: Partial<PrConfirmed> = { branch: str("expect-branch"), head: str("expect-head"), remote: str("expect-remote"), ref: str("expect-ref") };
  const opts = { base: str("base"), title: str("title"), expect };
  const json = !!flags.json;
  if (!flags.yes) {
    const { repo: _repo, prHead: _head, ...p } = prPlan(cwd, runPr, opts);
    if (json) return void console.log(JSON.stringify(p));
    if (p.problem) die(`${p.problem.message}. Fix: ${p.problem.fix}`);
    return void console.log(prPreview(p).join("\n"));
  }
  try {
    const r = prCreate(cwd, runPr, opts);
    console.log(json ? JSON.stringify({ ok: true, url: r.url, done: `opened ${r.url}` }) : `Opened ${r.url}`);
  } catch (err) {
    if (!(err instanceof PrRefused)) throw err;
    if (json) {
      console.log(JSON.stringify({ ok: false, error: err.message, ...(err.url ? { url: err.url } : {}) }));
      process.exitCode = 2;
      return;
    }
    die(err.message);
  }
}
