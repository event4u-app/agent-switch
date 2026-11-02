/**
 * Git facts for a session's folder (road-to-agent-switch-v3-central Phase 3, M5):
 * branch, head, dirty, ahead/behind, worktree, remote. One `git status
 * --porcelain=v2 --branch` plus one `rev-parse` per folder, each under a 1 s
 * timeout; a folder that is not a repo, or a git that hangs, gives null — never
 * a guess. Status is read fresh every time (a new untracked file changes no
 * index or HEAD timestamp a cache could key on); only the remote URL is cached,
 * per (toplevel, config mtime).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface GitFacts {
  toplevel: string;
  /** null on a detached HEAD. */
  branch: string | null;
  headSha: string | null;
  dirty: boolean;
  /** Changed paths (staged, unstaged, untracked), for "3 changed". */
  changed: number;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
  /** The upstream remote's URL, credentials stripped. */
  remote: string | null;
  /** A linked worktree (not the main checkout). */
  worktree: boolean;
}

export const GIT_TIMEOUT_MS = 1000;

function git(cwd: string, args: string[], timeoutMs: number): string | null {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: timeoutMs, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } });
  return r.status === 0 && !r.error ? r.stdout : null;
}

/** Parse `git status --porcelain=v2 --branch`. Pure. */
export function parseStatusV2(out: string): Pick<GitFacts, "branch" | "headSha" | "dirty" | "changed" | "ahead" | "behind" | "upstream"> {
  let branch: string | null = null;
  let headSha: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let upstream: string | null = null;
  let changed = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.oid ")) headSha = /^[0-9a-f]{7,64}$/.test(line.slice(13)) ? line.slice(13) : null;
    else if (line.startsWith("# branch.head ")) branch = line.slice(14) === "(detached)" ? null : line.slice(14);
    else if (line.startsWith("# branch.upstream ")) upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const m = /^\+(\d+) -(\d+)$/.exec(line.slice(12));
      if (m) [ahead, behind] = [Number(m[1]), Number(m[2])];
    } else if (/^[12u?] /.test(line)) changed++;
  }
  return { branch, headSha, dirty: changed > 0, changed, ahead, behind, upstream };
}

/** A remote URL without user or password. Pure. */
export function stripCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1");
}

const remoteCache = new Map<string, { key: string; remote: string | null }>();

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** One spelling per folder: git prints long, forward-slash paths while the caller may hold
 *  a symlink or a Windows 8.3 short name for the same place. */
function canonical(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

export function gitFacts(cwd: string, timeoutMs = GIT_TIMEOUT_MS): GitFacts | null {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const rp = git(cwd, ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"], timeoutMs);
  if (!rp) return null;
  const [topRaw, gitDir, commonRaw] = rp.trim().split("\n");
  if (!topRaw || !gitDir) return null;
  const toplevel = canonical(topRaw);
  const commonDir = canonical(path.resolve(cwd, commonRaw ?? gitDir));
  const st = git(toplevel, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], timeoutMs);
  if (st === null) return null;
  const s = parseStatusV2(st);
  let remote: string | null = null;
  const remoteName = s.upstream?.split("/")[0];
  if (remoteName) {
    const key = `${remoteName}:${mtime(path.join(commonDir, "config"))}`;
    const hit = remoteCache.get(toplevel);
    if (hit && hit.key === key) remote = hit.remote;
    else {
      const url = git(toplevel, ["config", "--get", `remote.${remoteName}.url`], timeoutMs);
      remote = url ? stripCredentials(url.trim()) : null;
      remoteCache.set(toplevel, { key, remote });
    }
  }
  return { toplevel, ...s, remote, worktree: canonical(gitDir) !== commonDir };
}
