/**
 * Whether a `claude` or `codex` typed in the user's own terminal runs in Agent
 * Switch's host (src/host/tmux-host.ts), with that terminal as one view of it,
 * so the same session takes input from the terminal and from the app at once.
 * Only interactive starts qualify; everything else runs exactly as before.
 * Roadmap: road-to-terminal-sessions-in-sync, D4 and D5.
 */

export type SyncProvider = "claude" | "codex";

/** `launch`'s "start it the old way": the shell wrapper then runs the program itself. */
export const LAUNCH_PLAIN_EXIT = 87;

export interface StartContext {
  /** The switch (Settings › Open in, `terminal-sync`). */
  enabled: boolean;
  platform: NodeJS.Platform;
  /** tmux is installed. */
  tmux: boolean;
  stdinTty: boolean;
  stdoutTty: boolean;
  /** Typed inside an AS-hosted window already (AGENT_SWITCH_HOST_PANE is set). */
  insideHost: boolean;
}

export type PlainReason = "off" | "no-host" | "not-a-terminal" | "inside-host" | "not-interactive" | "subcommand" | "picker" | "fork";

export type StartPlan =
  | { kind: "plain"; reason: PlainReason }
  /** `sessionId`: the id the session keeps (a resume, or one the user chose); `continue`: resume the folder's newest. */
  | { kind: "hosted"; args: string[]; sessionId?: string; continue?: true };

const NOT_INTERACTIVE = new Set(["-p", "--print", "--output-format", "--input-format", "-v", "--version", "-h", "--help"]);
const CLAUDE_SUBCOMMANDS = new Set(["mcp", "config", "doctor", "update", "upgrade", "install", "setup-token", "plugin", "plugins", "migrate-installer", "agents", "remote-control"]);
const CODEX_SUBCOMMANDS = new Set(["exec", "e", "review", "login", "logout", "mcp", "mcp-server", "app-server", "completion", "sandbox", "debug", "apply", "a", "resume", "fork", "cloud", "features", "help", "proto"]);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The plan for one terminal start. Pure. */
export function terminalStartPlan(provider: SyncProvider, argv: readonly string[], c: StartContext): StartPlan {
  const plain = (reason: PlainReason): StartPlan => ({ kind: "plain", reason });
  if (!c.enabled) return plain("off");
  if (c.platform === "win32" || !c.tmux) return plain("no-host");
  if (!c.stdinTty || !c.stdoutTty) return plain("not-a-terminal");
  if (c.insideHost) return plain("inside-host");
  if (argv.some((a) => NOT_INTERACTIVE.has(a) || a.startsWith("--output-format=") || a.startsWith("--input-format="))) return plain("not-interactive");
  const first = argv[0];
  if (first !== undefined && (provider === "claude" ? CLAUDE_SUBCOMMANDS : CODEX_SUBCOMMANDS).has(first)) return plain("subcommand");
  if (provider === "codex") return { kind: "hosted", args: [...argv] };

  const args: string[] = [];
  let sessionId: string | undefined;
  let cont = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--resume" || a === "-r" || a.startsWith("--resume=")) {
      const id = a.startsWith("--resume=") ? a.slice("--resume=".length) : argv[i + 1];
      if (id === undefined || !SESSION_ID.test(id)) return plain("picker");
      if (!a.startsWith("--resume=")) i++;
      sessionId = id;
      args.push("--resume", id);
    } else if (a === "--session-id") {
      const id = argv[i + 1];
      if (id === undefined || !SESSION_ID.test(id)) return plain("picker");
      i++;
      sessionId = id;
    } else if (a === "-c" || a === "--continue") {
      cont = true;
    } else if (a === "--fork-session") {
      return plain("fork");
    } else {
      args.push(a);
    }
  }
  return { kind: "hosted", args, ...(sessionId ? { sessionId } : {}), ...(cont && !sessionId ? { continue: true as const } : {}) };
}
