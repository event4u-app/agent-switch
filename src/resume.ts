/**
 * Resume preflight (spec §8.4; road-to-agent-switch-v3-central Phase 4): before
 * an old session is resumed, check what changed since — folder, branch, commit,
 * the main checkout, the account — and suggest where to resume so the user's
 * open changes stay untouched. Every option ends in the exact command it runs.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type How = "continue" | "fork" | "account" | "brief";
export type Target = "same_cwd" | "worktree" | "new_worktree";

export interface Check {
  ok: boolean;
  /** One line, in words. */
  text: string;
}

export interface Preflight {
  checks: Check[];
  target: Target;
  /** The suggestion in words. */
  suggestion: string;
  /** Where the session will run. */
  cwd: string | null;
  /** The commands, in order. */
  commands: string[][];
}

export interface PreflightInput {
  sessionId: string;
  account: string;
  /** The folder the session last worked in. */
  cwd: string | null;
  branch: string | null;
  headSha: string | null;
  /** Was that folder a linked worktree? */
  worktree: boolean;
  how: How;
  toAccount?: string;
  /** Where `handoff extract` writes this session's brief (src/handoff.ts `writeBrief`). */
  briefPath: string;
  /** Account readiness, from the caller: signed in and how full its tightest window is. */
  account_ready: { signedIn: boolean; tightestPct: number | null };
}

export interface GitProbe {
  exists(dir: string): boolean;
  branchExists(dir: string, branch: string): boolean;
  commitReachable(dir: string, sha: string): boolean;
  dirty(dir: string): boolean;
}

/** Resume runs on request, not on a hot path: a busy Windows machine needs more than 1 s for a cold `git status`. */
const PROBE_TIMEOUT_MS = 5000;

export const realGit: GitProbe = {
  exists: (d) => fs.existsSync(d),
  branchExists: (d, b) => spawnSync("git", ["-C", d, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`], { timeout: PROBE_TIMEOUT_MS }).status === 0,
  commitReachable: (d, sha) => spawnSync("git", ["-C", d, "cat-file", "-e", `${sha}^{commit}`], { timeout: PROBE_TIMEOUT_MS }).status === 0,
  // No answer is not "clean": resuming into unseen changes is the outcome this check exists to prevent.
  dirty: (d) => {
    const r = spawnSync("git", ["-C", d, "status", "--porcelain"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
    return r.status !== 0 || (r.stdout ?? "").trim().length > 0;
  },
};

/** Pure given the probe: what to check, what to suggest, which commands run. */
export function preflight(i: PreflightInput, git: GitProbe = realGit): Preflight {
  const checks: Check[] = [];
  const cwd = i.cwd;
  const folder = !!cwd && git.exists(cwd);
  checks.push({ ok: folder, text: folder ? `Folder ${cwd} exists` : `Folder ${cwd ?? "(unknown)"} is gone` });
  let target: Target = "same_cwd";
  let base = cwd;
  let branchOk = true;
  let commitOk = true;
  let dirty = false;
  if (folder && i.branch) {
    branchOk = git.branchExists(cwd!, i.branch);
    commitOk = !i.headSha || git.commitReachable(cwd!, i.headSha);
    checks.push(branchOk
      ? { ok: true, text: `Branch ${i.branch} still exists` }
      : { ok: commitOk, text: commitOk ? `Branch ${i.branch} is gone, its commit is still reachable` : `Branch ${i.branch} is gone and so is its commit` });
    dirty = git.dirty(cwd!);
    checks.push({ ok: !dirty, text: dirty ? `${i.worktree ? "The worktree" : "The main checkout"} has changes that are not committed` : `${i.worktree ? "The worktree" : "The main checkout"} is clean` });
  }
  const acct = i.how === "account" ? (i.toAccount ?? i.account) : i.account;
  const ready = i.account_ready.signedIn && (i.account_ready.tightestPct === null || i.account_ready.tightestPct < 100);
  checks.push({ ok: ready, text: !i.account_ready.signedIn ? `Account ${acct} is not signed in` : `Account ${acct} ready${i.account_ready.tightestPct !== null ? ` (${i.account_ready.tightestPct}% of its tightest window used)` : ""}` });

  let suggestion = "Resume where it ran.";
  const commands: string[][] = [];
  if (folder && i.headSha && commitOk && (!branchOk || dirty)) {
    target = "new_worktree";
    base = path.join(path.dirname(cwd!), `${path.basename(cwd!)}-resume-${i.sessionId.slice(0, 8)}`);
    suggestion = "A new worktree at the session's last commit, so your open changes stay untouched.";
    commands.push(["git", "-C", cwd!, "worktree", "add", "--detach", base, i.headSha]);
  } else if (folder && i.worktree) {
    target = "worktree";
    suggestion = "Resume in its worktree.";
  } else if (!folder) {
    suggestion = "The folder is gone: resume as a new session with a brief, or restore the folder first.";
  }
  const run = (account: string, args: string[]) => ["agent-switch", "run", account, ...(base ? ["--cwd", base] : []), "--", ...args];
  if (i.how === "continue") commands.push(run(i.account, ["--resume", i.sessionId]));
  if (i.how === "fork") commands.push(run(i.account, ["--resume", i.sessionId, "--fork-session"]));
  if (i.how === "account") commands.push(["agent-switch", "takeover", i.sessionId, "--to", acct]);
  if (i.how === "brief") {
    commands.push(["agent-switch", "handoff", "extract", i.sessionId, "--from", i.account, "--to", "claude"], ["agent-switch", "handoff", "seed", "--to", acct, "--brief", i.briefPath]);
  }
  return { checks, target, suggestion, cwd: base, commands };
}

/** A command as one copyable line, quoting what needs it. Pure. */
export function shellLine(argv: readonly string[]): string {
  return argv.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
}
