/**
 * What a new session starts with beyond the account: the model, the thinking
 * level and whether it gets a worktree of its own. Shared by `run` and
 * `host start`, so a session started in the user's terminal and one hosted in
 * Agent Switch start the same way.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ProviderId } from "./providers.js";

export interface StartChoice {
  model?: string;
  /** The thinking level, in the tool's own words (`high`, `max`, `minimal`…). */
  effort?: string;
}

/** A model or level is one word: it is placed on the tool's command line. */
const PLAIN = /^[A-Za-z0-9][\w.:\[\]-]*$/;

/** The tool's own arguments for the choice. Throws when the tool has no such choice. */
export function choiceArgs(providerId: ProviderId, c: StartChoice): string[] {
  if (c.model !== undefined && !PLAIN.test(c.model)) throw new Error(`not a model name: ${c.model}`);
  if (c.effort !== undefined && !PLAIN.test(c.effort)) throw new Error(`not a thinking level: ${c.effort}`);
  if (providerId === "antigravity") {
    if (c.model !== undefined || c.effort !== undefined) throw new Error("Antigravity starts on its own model; it takes no model or thinking choice");
    return [];
  }
  const model = c.model !== undefined ? ["--model", c.model] : [];
  if (c.effort === undefined) return model;
  // Codex reads thinking as a config value; Claude has its own flag.
  return providerId === "codex" ? [...model, "-c", `model_reasoning_effort="${c.effort}"`] : [...model, "--effort", c.effort];
}

/** `claude-20261123-090507`: the tool and the local start time. */
export function worktreeName(providerId: ProviderId, at: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${providerId}-${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
}

/** A worktree a start made: where the session starts, the checkout and its branch. */
export interface MadeWorktree {
  /** The folder the session starts in (the same subfolder as the one asked for). */
  cwd: string;
  /** The checkout's root. */
  dir: string;
  branch: string;
}

/**
 * A new worktree for a session in `cwd`: branch `agent-switch/<name>` at the
 * folder's HEAD, checked out in `<repo>.worktrees/<name>` beside the main
 * repository — also when `cwd` is itself a worktree, so worktrees never nest —
 * where it never shows up in the repository's own status. Two starts in the
 * same second get `<name>-2`, `-3`, …: git refuses a branch or folder that
 * exists, so a name is taken by whoever creates it first. Returns the folder the
 * session starts in — the same subfolder of the new checkout as `cwd` was of
 * the old one, or the nearest folder above it the checkout has (an untracked
 * folder is not checked out). Throws with git's reason when it cannot be made.
 */
export function newWorktree(cwd: string, providerId: ProviderId, at: Date = new Date()): MadeWorktree {
  const git = (...a: string[]) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", timeout: 30_000 });
  const top = git("rev-parse", "--show-toplevel");
  if (top.status !== 0) throw new Error(`not a git repository: ${cwd}`);
  const main = mainCheckout(cwd) ?? top.stdout.trim();
  const base = worktreeName(providerId, at);
  const prefix = git("rev-parse", "--show-prefix").stdout.trim();
  for (let n = 1; n <= 50; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    const dir = path.join(path.dirname(main), `${path.basename(main)}.worktrees`, name);
    const branch = `agent-switch/${name}`;
    if (fs.existsSync(dir) || git("show-ref", "--verify", "--quiet", `refs/heads/${branch}`).status === 0) continue;
    const add = git("worktree", "add", "-q", "-b", branch, dir, "HEAD");
    if (add.status === 0) return { cwd: nearestIn(dir, prefix), dir, branch };
    // Another start took this name between the check and the add: try the next one.
    if (fs.existsSync(dir) || git("show-ref", "--verify", "--quiet", `refs/heads/${branch}`).status === 0) continue;
    throw new Error(`could not make a worktree: ${(add.stderr || add.stdout).trim()}`);
  }
  throw new Error(`could not make a worktree: every name from ${base} to ${base}-50 is taken`);
}

/** `prefix` inside the checkout `dir`, or the nearest folder above it that exists there. */
function nearestIn(dir: string, prefix: string): string {
  const parts = prefix.split("/").filter(Boolean);
  for (let n = parts.length; n > 0; n--) {
    const p = path.join(dir, ...parts.slice(0, n));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return dir;
}

/** The main checkout of the repository `cwd` is in (also from inside a linked
 *  worktree), or null for a bare repository. */
function mainCheckout(cwd: string): string | null {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return null;
  const common = r.stdout.trim();
  return path.basename(common) === ".git" ? path.dirname(common) : null;
}

/** Takes back a worktree a start made and could not use: the checkout, then its
 *  branch. Best effort — a start that failed reports its own reason. */
export function removeWorktree(w: MadeWorktree): void {
  const main = mainCheckout(w.dir);
  spawnSync("git", ["-C", main ?? path.dirname(w.dir), "worktree", "remove", "--force", w.dir], { encoding: "utf8", timeout: 30_000 });
  if (main) spawnSync("git", ["-C", main, "branch", "-D", w.branch], { encoding: "utf8", timeout: 30_000 });
}
