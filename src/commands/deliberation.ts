/**
 * `agent-switch deliberation get|set [off|offer|auto|inherit] [--session <session>] [--json]`: whether the agent
 * offers a council, an arena or a panel when a question warrants one (owner, 2026-11-26). agent-config owns the
 * setting (`deliberation.mode`) and the per-session override; this passes the GUI's word through to
 * `agent-config deliberation:get|set`, with the session's own agent-config root when its profile has one.
 */

import { spawnSync } from "node:child_process";

import { agentConfigRootFor, AGENT_CONFIG_HOME_ENV } from "../agent-config-root.js";
import { die } from "../profiles.js";
import { resolveBinary } from "../providers.js";
import { target } from "./bridge.js";

export const DELIBERATION_MODES = ["off", "offer", "auto"] as const;
export type DeliberationMode = (typeof DELIBERATION_MODES)[number];

export interface DeliberationState {
  /** What the session (or, without one, everyone) runs with now. */
  mode: DeliberationMode;
  /** Where it comes from: this session's own choice, the global setting, or agent-config's default. */
  source: "session" | "global" | "default";
}

/** agent-config's answer, read leniently: an unknown mode is the default `off`. Pure. */
export function parseDeliberation(stdout: string): DeliberationState {
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "{}") as Record<string, unknown>;
  } catch {
    o = {};
  }
  const mode = (DELIBERATION_MODES as readonly string[]).includes(String(o.mode)) ? (o.mode as DeliberationMode) : "off";
  const source = o.source === "session" || o.source === "global" ? o.source : "default";
  return { mode, source };
}

/** The arguments for agent-config. Pure. */
export function deliberationArgs(verb: "get" | "set", mode: string | undefined, sessionId: string | null | undefined): string[] {
  // The global setting is the user's choice made in the GUI: agent-config records it as such.
  return [`deliberation:${verb}`, ...(verb === "set" && mode ? [mode] : []), ...(sessionId ? ["--session", sessionId] : verb === "set" ? ["--source", "gui"] : []), "--json"];
}

export function cmdDeliberation(positional: string[], flags: Record<string, string | boolean>): void {
  const [verb, mode] = positional;
  if (verb !== "get" && verb !== "set") die("usage: agent-switch deliberation get|set [off|offer|auto|inherit] [--session <session>] [--json]");
  if (verb === "set" && !mode) die("deliberation set needs off, offer, auto or inherit");
  if (verb === "set" && mode !== "inherit" && !(DELIBERATION_MODES as readonly string[]).includes(mode!)) die(`unknown mode ${mode}: off, offer, auto or inherit`);
  if (verb === "set" && mode === "inherit" && typeof flags.session !== "string") die("inherit applies to one session: add --session");
  const t = typeof flags.session === "string" ? target(flags.session) : null;
  const root = t && t.provider === "claude" ? agentConfigRootFor(t.account) : null;
  const env = root ? { ...process.env, [AGENT_CONFIG_HOME_ENV]: root } : process.env;
  const run = (args: string[]) => spawnSync(resolveBinary("agent-config"), args, { encoding: "utf8", env, timeout: 20_000 });
  if (verb === "set") {
    const r = run(deliberationArgs("set", mode, t?.sessionId));
    if (r.error || r.status !== 0) die((r.stderr || r.error?.message || "agent-config deliberation:set failed").trim());
  }
  const g = run(deliberationArgs("get", undefined, t?.sessionId));
  if (g.error || g.status !== 0) die((g.stderr || g.error?.message || "agent-config deliberation:get failed").trim());
  const state = parseDeliberation(g.stdout);
  if (flags.json) return void console.log(JSON.stringify(state));
  console.log(`${state.mode} (${state.source})`);
}
