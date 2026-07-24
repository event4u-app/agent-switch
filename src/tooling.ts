/**
 * Ecosystem tooling detection — the single source behind `agent-switch tooling`
 * and the agent-config/rtk rows in `agent-switch doctor` (one implementation,
 * two renderers; the GUI consumes `tooling --json` and never shells out).
 *
 * Covers agent-config, rtk, and the provider CLIs (claude, codex, agy).
 * Detection is read-only: it runs local binaries with a short timeout and
 * discards their output after classification; no network calls.
 *
 * rtk is special — upstream documents a hard name collision with an unrelated
 * `rtk` (Rust Type Kit) and names `rtk gain` as the discriminator. Identity is
 * judged on the probe's OUTPUT SIGNATURE, not its exit code (upstream defines
 * no exit-code contract for `rtk gain`): a broken right tool is not the wrong
 * tool, so a timed-out/crashed/ambiguous probe is `unverified`, never
 * `unknown-rtk`.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { ProviderId } from "./providers.js";
import { readBinaryPath } from "./profiles.js";
import { npmSearchPath } from "./updates.js";

export type ToolId = "agent-config" | "rtk" | "claude" | "codex" | "agy";
export const TOOL_IDS: readonly ToolId[] = ["agent-config", "rtk", "claude", "codex", "agy"];

export type RtkIdentity = "token-killer" | "unknown-rtk" | "unverified";

export interface ToolStatus {
  id: ToolId;
  present: boolean;
  version: string | null;
  path: string | null;
  healthy: boolean;
  /** Only for tools with a name-collision risk (today: rtk). */
  identity?: RtkIdentity;
  /** One actionable sentence when unhealthy; empty string when healthy. */
  hint: string;
}

/** Which provider a probed binary belongs to (for `providers link` hints and
 *  the user-linked path lookup). */
const BINARY_PROVIDER: Partial<Record<ToolId, ProviderId>> = {
  claude: "claude",
  codex: "codex",
  agy: "antigravity",
};

/** Probe timeouts: `rtk gain` is the identity discriminator and measured at
 *  ~666 ms warm (S0.2), so 1500 ms is headroom, not hope; `--version` probes
 *  get a little more because a cold Node CLI start can exceed 1.5 s. */
export const RTK_PROBE_TIMEOUT_MS = 1500;
const VERSION_PROBE_TIMEOUT_MS = 3000;

// ---------- runner (injectable so every probe is unit-testable) --------------

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  /** The process never started (ENOENT/EACCES spawn error). */
  failedToStart: boolean;
  timedOut: boolean;
}

export type Runner = (cmd: string, args: string[], timeoutMs: number) => RunResult;

/** spawnSync wrapper. Runs with {@link toolingSearchPath} so probes work when
 *  this CLI was spawned from the GUI with a stripped PATH (Finder/menu-bar
 *  launches); `shell` on Windows for `.cmd` shims (same as selfUpdate). */
export function defaultRunner(cmd: string, args: string[], timeoutMs: number): RunResult {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: toolingSearchPath() },
    shell: process.platform === "win32",
    windowsHide: true,
  });
  const err = r.error as NodeJS.ErrnoException | undefined;
  const timedOut = err?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status,
    failedToStart: !!err && !timedOut,
    timedOut,
  };
}

// ---------- PATH resolution ---------------------------------------------------

/** The PATH the tooling sweep searches: {@link npmSearchPath} already covers
 *  the stripped-GUI-PATH case (node's own bin dir first, then the inherited
 *  PATH, homebrew, /usr/local/bin, ~/.npm-global/bin, and ~/.local/bin — where
 *  rtk's upstream install.sh and agy's installer land). */
export function toolingSearchPath(): string {
  return npmSearchPath();
}

/** Locate a binary on a search PATH without spawning it. Pure fs, injectable
 *  platform — on Windows, tries the executable extensions; on POSIX, requires
 *  the executable bit so a stray data file named `rtk` doesn't count. */
export function findOnPath(
  binary: string,
  searchPath: string = toolingSearchPath(),
  platform: NodeJS.Platform = process.platform,
): string | null {
  const exts = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** First version-looking token in a probe's output (`rtk 1.4.2` → `1.4.2`,
 *  `v2.0.1-beta.3` → `2.0.1-beta.3`); null when there is none. */
export function parseVersionToken(s: string): string | null {
  return /\bv?(\d+\.\d+\.\d+[-+.\w]*)/.exec(s)?.[1] ?? null;
}

// ---------- rtk identity probe ------------------------------------------------

/** `rtk gain` output header of the real Token Killer (S0.2 measured signature). */
const RTK_SIGNATURE = /RTK Token Savings|Token Savings/;

/**
 * The rtk identity probe — THE seam for the planned delegation: when
 * agent-config ships its rtk detection contract (AC-side
 * road-to-rtk-onboarding-correctness Phase 3), delegation replaces this
 * function's body with a mapping over that readout; everything else in this
 * module stays. Today's implementation is the documented fallback probe.
 *
 * Semantics (output signature, never exit code):
 *   - stdout carries the Token Savings header → `token-killer` (+ version via
 *     `rtk --version`, which is not identity-bearing);
 *   - the probe ran and produced other output (unknown-subcommand error etc.)
 *     → `unknown-rtk` (the name-collision case);
 *   - timeout, crash-on-start, or a silent run → `unverified` (a broken right
 *     tool is not the wrong tool).
 */
export function probeRtkIdentity(
  rtkCmd: string,
  run: Runner = defaultRunner,
): { identity: RtkIdentity; version: string | null } {
  const gain = run(rtkCmd, ["gain"], RTK_PROBE_TIMEOUT_MS);
  if (gain.timedOut || gain.failedToStart) return { identity: "unverified", version: null };
  if (RTK_SIGNATURE.test(gain.stdout)) {
    const v = run(rtkCmd, ["--version"], VERSION_PROBE_TIMEOUT_MS);
    return { identity: "token-killer", version: parseVersionToken(v.stdout) };
  }
  if (`${gain.stdout}${gain.stderr}`.trim().length > 0) return { identity: "unknown-rtk", version: null };
  return { identity: "unverified", version: null }; // ran silent — ambiguous
}

// ---------- hints ---------------------------------------------------------------

function installHint(id: ToolId, platform: NodeJS.Platform): string {
  switch (id) {
    case "agent-config":
      return "not installed — install: `npm install -g @event4u/agent-config`";
    case "rtk":
      if (platform === "darwin") return "not installed — install: `brew install rtk`";
      if (platform === "win32") return "not installed — install: `winget install rtk-ai.rtk`";
      return "not installed — install: `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh`";
    default:
      return `not installed — install the ${id} CLI, or link it: \`agent-switch providers link --provider ${BINARY_PROVIDER[id]} --path <path-to-binary>\``;
  }
}

function rtkUnhealthyHint(identity: RtkIdentity, platform: NodeJS.Platform): string {
  if (identity === "unknown-rtk") {
    // installHint's tail carries the right per-OS install command.
    return `the \`rtk\` on PATH is not Token Killer (name collision) — ${installHint("rtk", platform).replace("not installed — ", "")}`;
  }
  return "could not verify `rtk` (probe timed out or crashed) — run `rtk gain` manually to check";
}

// ---------- the sweep -----------------------------------------------------------

export interface CheckOptions {
  /** Which tools to check (default: all — the `tooling` readout). */
  ids?: readonly ToolId[];
  run?: Runner;
  searchPath?: string;
  platform?: NodeJS.Platform;
  /** User-linked provider binary path lookup (injectable for tests). */
  linked?: (id: ProviderId) => string | null;
}

/** One status entry for a tool that is not on the search PATH. Absence carries
 *  no `identity` — there was no binary to probe, so there is nothing to judge. */
function absent(id: ToolId, platform: NodeJS.Platform): ToolStatus {
  return { id, present: false, version: null, path: null, healthy: false, hint: installHint(id, platform) };
}

/**
 * Detect every requested tool. Absence is encoded as `present: false`;
 * `identity` appears only for rtk; `healthy` for rtk is true only for
 * identity `token-killer`, for everything else when its `--version` probe ran.
 */
export function checkTooling(opts: CheckOptions = {}): ToolStatus[] {
  const ids = opts.ids ?? TOOL_IDS;
  const run = opts.run ?? defaultRunner;
  const searchPath = opts.searchPath ?? toolingSearchPath();
  const platform = opts.platform ?? process.platform;
  const linked = opts.linked ?? readBinaryPath;

  return ids.map((id) => {
    // Provider binaries honor a user-linked path first (same precedence as
    // resolveBinary: linked > PATH, with ~/.local/bin inside the search PATH).
    const providerId = BINARY_PROVIDER[id];
    const linkedPath = providerId ? linked(providerId) : null;
    const binPath = linkedPath && fs.existsSync(linkedPath) ? linkedPath : findOnPath(id, searchPath, platform);
    if (!binPath) return absent(id, platform);

    if (id === "rtk") {
      const { identity, version } = probeRtkIdentity(binPath, run);
      return {
        id,
        present: true,
        version,
        path: binPath,
        healthy: identity === "token-killer",
        identity,
        hint: identity === "token-killer" ? "" : rtkUnhealthyHint(identity, platform),
      };
    }

    const probe = run(binPath, ["--version"], VERSION_PROBE_TIMEOUT_MS);
    const healthy = !probe.failedToStart && !probe.timedOut;
    return {
      id,
      present: true,
      version: healthy ? parseVersionToken(probe.stdout) : null,
      path: binPath,
      healthy,
      hint: healthy ? "" : `\`${id} --version\` ${probe.timedOut ? "timed out" : "failed to run"} — reinstall it (${installHint(id, platform).replace("not installed — ", "")})`,
    };
  });
}

// ---------- install / upgrade ---------------------------------------------------

export type ToolAction = "install" | "upgrade";

export interface ToolCommand {
  cmd: string;
  args: string[];
  /** Human-readable rendering, printed (as `→ …`) before the run. */
  display: string;
}

/** npm packages behind the npm-installed tools (same commands the hints cite). */
const NPM_PACKAGES = {
  "agent-config": "@event4u/agent-config",
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
} as const;

/** rtk's upstream installer (linux — used for install AND upgrade there).
 *  NEVER `cargo install rtk`: that builds the unrelated Rust Type Kit. */
const RTK_INSTALL_SH = "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh";

function npmCommand(pkg: string, latest: boolean): ToolCommand {
  const spec = latest ? `${pkg}@latest` : pkg;
  return { cmd: "npm", args: ["install", "-g", spec], display: `npm install -g ${spec}` };
}

/**
 * The exact command for `tooling install|upgrade <id>` — pure, per-platform.
 * A `refusal` result means there is no honest command to run (today: agy —
 * the binary ships with the Antigravity app; this repo documents no standalone
 * installer, and inventing one would be worse than saying so).
 *
 * `claudePath` (resolved linked-or-PATH binary) selects the claude upgrade
 * shape: the CLI's own `claude update` when the binary is present, else the
 * npm `@latest` reinstall.
 */
export function planToolAction(
  id: ToolId,
  action: ToolAction,
  opts: { platform?: NodeJS.Platform; claudePath?: string | null } = {},
): { command: ToolCommand } | { refusal: string } {
  const platform = opts.platform ?? process.platform;
  switch (id) {
    case "agent-config":
      return { command: npmCommand(NPM_PACKAGES["agent-config"], action === "upgrade") };
    case "codex":
      return { command: npmCommand(NPM_PACKAGES.codex, action === "upgrade") };
    case "claude":
      if (action === "upgrade" && opts.claudePath) {
        return { command: { cmd: opts.claudePath, args: ["update"], display: "claude update" } };
      }
      return { command: npmCommand(NPM_PACKAGES.claude, action === "upgrade") };
    case "rtk": {
      if (platform === "darwin") {
        const verb = action === "upgrade" ? "upgrade" : "install";
        return { command: { cmd: "brew", args: [verb, "rtk"], display: `brew ${verb} rtk` } };
      }
      if (platform === "win32") {
        return { command: { cmd: "winget", args: [action, "rtk-ai.rtk"], display: `winget ${action} rtk-ai.rtk` } };
      }
      // linux (and anything else POSIX): the upstream installer covers both actions.
      return { command: { cmd: "sh", args: ["-c", RTK_INSTALL_SH], display: RTK_INSTALL_SH } };
    }
    case "agy":
      return {
        refusal:
          "`agy` has no standalone installer — the Antigravity CLI ships with the Antigravity app.\n" +
          "Install the app, then (if `agy` is not on PATH) link the binary:\n" +
          "  agent-switch providers link --provider antigravity --path <path-to-agy>",
      };
  }
}

/** Runs an install/upgrade command as a visible child (inherit stdio) and
 *  returns its exit code. Injectable so tests never really install anything. */
export type InstallRunner = (cmd: string, args: string[]) => number;

/** The real runner: inherits stdio (the GUI runs this CLI inside its embedded
 *  terminal, so the user watches npm/brew output live), searches
 *  {@link toolingSearchPath} so a GUI-spawned run finds npm/brew on a stripped
 *  PATH, and uses `shell` on Windows for `.cmd` shims (same as selfUpdate). */
export function defaultInstallRunner(cmd: string, args: string[]): number {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, PATH: toolingSearchPath() },
    shell: process.platform === "win32",
  });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    console.error(`❌ \`${cmd}\` not found on PATH — install it first, then retry.`);
    return 1;
  }
  return r.status ?? 1;
}

/** The claude binary `tooling upgrade claude` prefers: linked path first (same
 *  precedence as resolveBinary), else PATH. Null → npm fallback. */
function resolveClaudeForUpdate(): string | null {
  const linked = readBinaryPath("claude");
  if (linked && fs.existsSync(linked)) return linked;
  return findOnPath("claude");
}

/**
 * `agent-switch tooling install|upgrade <id>` — plan the per-platform command,
 * print it (transparency: the user sees exactly what runs), run it with
 * inherited stdio, and return the child's exit code. A refusal (agy) prints
 * the explanation and returns 1 without running anything.
 */
export function runToolAction(
  id: ToolId,
  action: ToolAction,
  opts: {
    platform?: NodeJS.Platform;
    run?: InstallRunner;
    claudePath?: string | null;
    log?: (line: string) => void;
    error?: (line: string) => void;
  } = {},
): number {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const claudePath =
    opts.claudePath !== undefined
      ? opts.claudePath
      : id === "claude" && action === "upgrade"
        ? resolveClaudeForUpdate()
        : null;
  const plan = planToolAction(id, action, { platform: opts.platform, claudePath });
  if ("refusal" in plan) {
    error(plan.refusal);
    return 1;
  }
  log(`→ ${plan.command.display}`);
  const status = (opts.run ?? defaultInstallRunner)(plan.command.cmd, plan.command.args);
  if (status === 0) {
    log(`✅ ${id} ${action === "upgrade" ? "upgraded" : "installed"} — verify with \`agent-switch tooling\`.`);
  } else {
    error(`❌ \`${plan.command.display}\` exited with ${status} (its output is above).`);
  }
  return status;
}

// ---------- renderers -----------------------------------------------------------

export function statusGlyph(t: ToolStatus): "✅" | "⚠️" | "❌" {
  if (t.healthy) return "✅";
  return t.present ? "⚠️" : "❌";
}

/** Aligned human rows for `agent-switch tooling` (glyph, id, version, detail). */
export function formatToolingLines(tools: ToolStatus[]): string[] {
  const idW = Math.max(...tools.map((t) => t.id.length));
  const verW = Math.max(...tools.map((t) => (t.version ?? "—").length));
  return tools.map((t) => {
    const detail = t.healthy
      ? `${t.path}${t.identity === "token-killer" ? " (Token Killer verified)" : ""}`
      : t.hint;
    return `${statusGlyph(t)}  ${t.id.padEnd(idW)}  ${(t.version ?? "—").padEnd(verW)}  ${detail}`.trimEnd();
  });
}

/** One doctor-style message per tool (doctor prefixes its own OK/WARN mark).
 *  Never a hard error — agent-config and rtk are optional ecosystem tools. */
export function doctorToolingLine(t: ToolStatus): string {
  if (t.healthy) {
    return `\`${t.id}\`${t.version ? ` ${t.version}` : ""} is installed${t.identity === "token-killer" ? " (Token Killer verified)" : ""}.`;
  }
  return `\`${t.id}\`: ${t.hint}`;
}
