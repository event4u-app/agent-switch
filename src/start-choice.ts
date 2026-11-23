/**
 * What a new session starts with beyond the account: the model, the thinking
 * level and whether it gets a worktree of its own. Shared by `run` and
 * `host start`, so a session started in the user's terminal and one hosted in
 * Agent Switch start the same way.
 */

import { spawnSync } from "node:child_process";
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

/**
 * A new worktree for a session in `cwd`: branch `agent-switch/<name>` at the
 * folder's HEAD, checked out in `<repo>.worktrees/<name>` beside the repository
 * so it never shows up in the repository's own status. Returns the folder the
 * session starts in — the same subfolder of the new checkout as `cwd` was of
 * the old one. Throws with git's reason when it cannot be made.
 */
export function newWorktree(cwd: string, providerId: ProviderId, at: Date = new Date()): string {
  const git = (...a: string[]) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", timeout: 30_000 });
  const top = git("rev-parse", "--show-toplevel");
  if (top.status !== 0) throw new Error(`not a git repository: ${cwd}`);
  const toplevel = top.stdout.trim();
  const name = worktreeName(providerId, at);
  const dir = path.join(path.dirname(toplevel), `${path.basename(toplevel)}.worktrees`, name);
  const add = git("worktree", "add", "-q", "-b", `agent-switch/${name}`, dir, "HEAD");
  if (add.status !== 0) throw new Error(`could not make a worktree: ${(add.stderr || add.stdout).trim()}`);
  const prefix = git("rev-parse", "--show-prefix").stdout.trim();
  return prefix ? path.join(dir, prefix.replace(/\/$/, "")) : dir;
}
