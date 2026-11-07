/**
 * The agent-config link's CLI front door (road-to-the-agent-config-link).
 * `limits` reads every account's limits from cache; `switch` raises and decides
 * requests. Nothing here moves a session — the service carries out approvals.
 */

import { liveSessions } from "../api.js";
import { profileFromConfigDir } from "../hooks.js";
import { createMcpHandler, serveStdio } from "../link/mcp.js";
import { decideSwitch, describeRequest, readLimits, requestSwitch } from "../link/ops.js";
import type { MoveHow, Raiser } from "../link/requests.js";
import { requestStore } from "../link/store.js";
import { forSession, requestSummary, requestView } from "../link/summary.js";
import { ROOT, die, readLinkAutoConnect, readLinkExecutor, readPaceSuggest, setLinkAutoConnect, setLinkExecutor, setPaceSuggest, type LinkExecutor } from "../profiles.js";
import { currentVersion } from "../updates.js";
import { logActivity } from "./shared.js";
import { isProviderId, type ProviderId } from "../providers.js";

export { readLimits } from "../link/ops.js";

export function cmdLimits(provider: ProviderId | undefined, flags: Record<string, unknown>): void {
  const r = readLimits(provider);
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }
  if (!r.accounts.length) {
    console.log("No accounts yet — add one with `agent-switch add <name>`.");
    return;
  }
  for (const a of r.accounts) {
    const windows = a.windows.map((w) => `${w.key} ${w.fill === null ? "?" : `${w.fill}%`}`).join(" · ") || "no readout";
    console.log(`${a.usable ? "✓" : "·"} ${a.id.padEnd(24)} ${windows}${a.why ? `  (${a.why})` : ""}`);
  }
}

const USAGE =
  "usage: agent-switch switch list [--all] [--session provider/account/id] [--json]\n" +
  "       agent-switch switch show <id> [--json]\n" +
  "       agent-switch switch request (--account provider/name | --session provider/account/id) [--by ac] [--json]\n" +
  "       agent-switch switch decide <id> approve [--to provider/name] [--how after-turn|now|handoff] [--by <who>] [--executed <what>] [--json]\n" +
  "       agent-switch switch decide <id> decline|snooze [--by <who>] [--json]";

const HOWS: readonly MoveHow[] = ["after-turn", "now", "handoff"];
const ACTIVE = new Set(["open", "approved", "executing"]);

function out(flags: Record<string, unknown>, json: unknown, text: string): void {
  if (flags.json) process.stdout.write(JSON.stringify(json, null, 2) + "\n");
  else console.log(text);
}

export function cmdSwitch(sub: string | undefined, positional: string[], flags: Record<string, unknown>): void {
  const store = requestStore();
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  try {
    if (sub === "list" || sub === undefined) {
      const all = store.list();
      const session = str("session");
      const rows = (flags.all ? all : all.filter((r) => ACTIVE.has(r.state))).filter(session ? forSession(session) : () => true);
      const now = Date.now();
      return out(flags, rows.map((r) => requestView(r, now)), rows.length ? rows.map(describeRequest).join("\n") : "No open switch requests.");
    }
    if (sub === "show" || sub === "status") {
      const id = positional[0] ?? die(USAGE);
      const r = store.get(id) ?? die(`no switch request ${id}`);
      return out(flags, requestView(r, Date.now()), `${describeRequest(r)}\n${requestSummary(r, Date.now())}`);
    }
    if (sub === "request") {
      const by = str("by") ?? "as-cli";
      if (by !== "as-cli" && by !== "ac") die("--by is as-cli (default) or ac");
      const { request, created } = requestSwitch(store, { account: str("account"), session: str("session") ?? null, raisedBy: by as Raiser });
      return out(flags, { created, request }, `${created ? "Raised" : "Already open"}: ${describeRequest(request)}`);
    }
    if (sub === "decide") {
      const [id, decision] = positional;
      if (!id || (decision !== "approve" && decision !== "decline" && decision !== "snooze")) die(USAGE);
      const how = str("how");
      if (how !== undefined && !HOWS.includes(how as MoveHow)) die(`--how is one of ${HOWS.join(", ")}`);
      const executed = flags.executed === undefined ? undefined : typeof flags.executed === "string" ? flags.executed : "";
      if (executed !== undefined && decision !== "approve") die("--executed records an approval the caller already carried out");
      const { request, applied } = decideSwitch(store, { id, decision, target: str("to"), how: how as MoveHow | undefined, by: str("by") ?? "as-cli", executed });
      const text = applied
        ? `Decided: ${describeRequest(request)}`
        : `Not changed — the request is already ${request.state}${request.decision ? ` (by ${request.decision.by})` : ""}: ${describeRequest(request)}`;
      return out(flags, { applied, request }, text);
    }
  } catch (e) {
    die((e as Error).message);
  }
  die(USAGE);
}

/** The contract agent-config reads; bump with a breaking change to a tool or JSON
 *  shape, or a new field a caller may rely on. 2: request `kind` and `summary`,
 *  `switch_list` session filter, per-window `burnPerHour`/`etaFull`. */
export const LINK_CONTRACT = 2;

export function linkStatus(): { enabled: boolean; executor: LinkExecutor; version: string; contract: number; mcp: { command: string; args: string[] } } {
  return { enabled: readLinkAutoConnect(), executor: readLinkExecutor(), version: currentVersion(), contract: LINK_CONTRACT, mcp: { command: "agent-switch", args: ["mcp", "serve"] } };
}

const LINK_USAGE = "usage: agent-switch link [on|off|status] [--json]\n       agent-switch link executor [app|service] [--json]";

/** `agent-switch link [on|off|status] [--json]` — whether agent-config may connect
 *  to this agent-switch (MCP server + its own wiring). Default on.
 *  `link executor app|service` — who carries out a move answered in the app. */
export function cmdLink(sub: string | undefined, json = false, arg?: string): void {
  if (sub === "executor") {
    if (arg !== undefined) {
      if (arg !== "app" && arg !== "service") die(LINK_USAGE);
      if (readLinkExecutor() !== arg) {
        setLinkExecutor(arg);
        logActivity("settings", null, `agent-config moves carried out by the ${arg}`, "user changed it");
      }
    }
    const executor = readLinkExecutor();
    if (json) console.log(JSON.stringify({ executor }));
    else console.log(executor === "service" ? "Moves answered in the app are carried out by the background service." : "Moves answered in the app are carried out by the app (default).");
    return;
  }
  if (sub === "on" || sub === "off") {
    const on = sub === "on";
    if (readLinkAutoConnect() !== on) {
      setLinkAutoConnect(on);
      logActivity("settings", null, `agent-config link ${on ? "on" : "off"}`, "user changed it");
    }
  } else if (sub && sub !== "status") die(LINK_USAGE);
  const s = linkStatus();
  if (json) console.log(JSON.stringify(s));
  else console.log(`agent-config link ${s.enabled ? "ON" : "OFF"} — ${s.enabled ? "agent-config connects to `agent-switch mcp serve` and may raise and decide switch requests" : "agent-config does not connect; `mcp serve` offers no tools"}.`);
}

/** `agent-switch pace [on|off|status] [--json]` — whether the service suggests a
 *  switch when accounts run at different paces. Default on; only ever asks. */
export function cmdPace(sub: string | undefined, json = false): void {
  if (sub === "on" || sub === "off") {
    const on = sub === "on";
    if (readPaceSuggest() !== on) {
      setPaceSuggest(on);
      logActivity("settings", null, `pace suggestions ${on ? "on" : "off"}`, "user changed it");
    }
  } else if (sub && sub !== "status") die("usage: agent-switch pace [on|off|status] [--json]");
  const enabled = readPaceSuggest();
  if (json) console.log(JSON.stringify({ enabled }));
  else console.log(`Pace suggestions ${enabled ? "ON — the service asks to move a session when its account runs out well before its reset while another account would let room expire" : "OFF — only the limit ask (at 90 %) remains"}.`);
}

/** Which account and session started this process: the provider's own config
 *  env (set by the agent-switch wrapper), and for Claude the host's registry
 *  entry of the parent process — an MCP server is the agent's direct child. */
export function whoami(env: NodeJS.ProcessEnv = process.env, parentPid: number = process.ppid): { account: string | null; session: string | null; source: string } {
  const hosted = env.AGENT_SWITCH_HOST_PANE;
  if (hosted && hosted.split("/").length === 3) return { account: hosted.split("/").slice(0, 2).join("/"), session: hosted, source: "hosted" };
  for (const [provider, key] of [["claude", "CLAUDE_CONFIG_DIR"], ["codex", "CODEX_HOME"]] as const) {
    const dir = env[key];
    if (!dir) continue;
    const p = profileFromConfigDir(dir, ROOT);
    if (!p || p.provider !== provider) continue;
    const account = `${p.provider}/${p.profile}`;
    const sid = provider === "claude" ? (liveSessions(dir).find((l) => l.pid === parentPid)?.sessionId ?? null) : null;
    return { account, session: sid ? `${account}/${sid}` : null, source: key };
  }
  return { account: null, session: null, source: "none" };
}

/** `agent-switch mcp serve` — the stdio MCP server agent-config connects to. */
export async function cmdMcpServe(): Promise<void> {
  await serveStdio(
    createMcpHandler({
      version: currentVersion(),
      enabled: readLinkAutoConnect,
      status: linkStatus,
      limits: (provider) => readLimits(provider && isProviderId(provider) ? provider : undefined),
      whoami: () => whoami(),
      store: requestStore,
      request: requestSwitch,
      decide: decideSwitch,
    }),
  );
}
