/**
 * The PATH an agent binary is looked up on when the GUI started this CLI.
 *
 * A Finder- or menu-bar-started app gets `/usr/bin:/bin:/usr/sbin:/sbin`, which
 * misses every version manager (v3.2 Phase 0, `agents/evidence/v32-phase0-spikes-2026-11.md`).
 * Two sources, because neither is enough alone: the user's login shell (it
 * knows their dotfiles), and the version-manager directories that exist on disk
 * (mise activates in the prompt hook, so its shims are not on the login PATH).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseVersionToken } from "./tooling.js";
import { npmSearchPath } from "./updates.js";

const START = "__ASPATH__";
const END = "__END__";
export const LOGIN_SHELL_TIMEOUT_MS = 3000;

/** The PATH between the markers; a shell's own noise around it is ignored. Pure. */
export function cutMarkedPath(out: string): string | null {
  const i = out.lastIndexOf(START);
  if (i < 0) return null;
  const j = out.indexOf(END, i + START.length);
  if (j < 0) return null;
  return out.slice(i + START.length, j) || null;
}

/** PATH of the user's login shell, or null. Never trusts the exit status — a
 *  noisy zshrc fails half its plugins and still prints the PATH. */
export function loginShellPath(
  shell: string = process.env.SHELL ?? "/bin/zsh",
  home: string = os.homedir(),
  run: typeof spawnSync = spawnSync,
): string | null {
  if (process.platform === "win32" || !path.isAbsolute(shell)) return null;
  const r = run(shell, ["-ilc", `printf '${START}%s${END}' "$PATH"`], {
    env: { HOME: home, USER: process.env.USER ?? "", TERM: "dumb" },
    stdio: ["ignore", "pipe", "ignore"],
    timeout: LOGIN_SHELL_TIMEOUT_MS,
    encoding: "utf8",
  });
  return typeof r.stdout === "string" ? cutMarkedPath(r.stdout) : null;
}

/** Version-manager bin directories, whether or not they exist. Pure. */
export function versionManagerDirs(home: string, nvmDefault: string | null): string[] {
  const j = (...p: string[]) => path.join(home, ...p);
  return [
    ...(nvmDefault ? [j(".nvm", "versions", "node", nvmDefault, "bin")] : []),
    j(".volta", "bin"),
    j(".local", "share", "mise", "shims"),
    j(".asdf", "shims"),
    j(".nix-profile", "bin"),
    "/nix/var/nix/profiles/default/bin",
    j(".bun", "bin"),
    j(".cargo", "bin"),
  ];
}

/** nvm's default version directory name (`v22.3.0`), following one alias hop. */
export function nvmDefaultVersion(home: string): string | null {
  const versions = path.join(home, ".nvm", "versions", "node");
  let names: string[];
  try {
    names = fs.readdirSync(versions);
  } catch {
    return null;
  }
  let alias: string;
  try {
    alias = fs.readFileSync(path.join(home, ".nvm", "alias", "default"), "utf8").trim();
  } catch {
    alias = "";
  }
  const want = alias.replace(/^v/, "");
  const hit = names.filter((n) => want && n.replace(/^v/, "").startsWith(want)).sort().pop();
  return hit ?? names.sort().pop() ?? null;
}

/** Join PATH lists, first occurrence wins, empty entries dropped. Pure. */
export function mergePaths(...lists: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lists) for (const d of (l ?? "").split(path.delimiter)) if (d && !seen.has(d)) (seen.add(d), out.push(d));
  return out.join(path.delimiter);
}

let cached: string | null = null;

/** The search PATH for agent binaries: inherited PATH and the npm locations,
 *  then the login shell's, then version-manager dirs that exist. Cached per process. */
export function agentSearchPath(home: string = os.homedir()): string {
  if (cached !== null) return cached;
  const dirs = versionManagerDirs(home, nvmDefaultVersion(home)).filter((d) => fs.existsSync(d));
  cached = mergePaths(npmSearchPath(), loginShellPath(undefined, home), dirs.join(path.delimiter));
  return cached;
}

/** `<binary> --version` on {@link agentSearchPath}: the version token, or null
 *  when the binary is missing or prints none. */
export function probeVersion(binary: string, searchPath: string = agentSearchPath(), run: typeof spawnSync = spawnSync): string | null {
  const r = run(binary, ["--version"], { env: { ...process.env, PATH: searchPath }, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) return null;
  return parseVersionToken(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
}
