/**
 * The agent-config link's CLI front door (road-to-the-agent-config-link).
 * `limits` reads every account's limits from cache; `switch` raises and decides
 * requests. Nothing here moves a session — the service carries out approvals.
 */

import { decideSwitch, describeRequest, readLimits, requestSwitch } from "../link/ops.js";
import type { MoveHow, Raiser } from "../link/requests.js";
import { requestStore } from "../link/store.js";
import { die } from "../profiles.js";
import type { ProviderId } from "../providers.js";

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
  "usage: agent-switch switch list [--all] [--json]\n" +
  "       agent-switch switch show <id> [--json]\n" +
  "       agent-switch switch request (--account provider/name | --session provider/account/id) [--by ac] [--json]\n" +
  "       agent-switch switch decide <id> approve [--to provider/name] [--how after-turn|now|handoff] [--by <who>] [--json]\n" +
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
      const rows = flags.all ? all : all.filter((r) => ACTIVE.has(r.state));
      return out(flags, rows, rows.length ? rows.map(describeRequest).join("\n") : "No open switch requests.");
    }
    if (sub === "show" || sub === "status") {
      const id = positional[0] ?? die(USAGE);
      const r = store.get(id) ?? die(`no switch request ${id}`);
      return out(flags, r, describeRequest(r));
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
      const { request, applied } = decideSwitch(store, { id, decision, target: str("to"), how: how as MoveHow | undefined, by: str("by") ?? "as-cli" });
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
