/**
 * `agent-switch sync` — bring every profile up to date with its source
 * (src/follow.ts). agent-config runs it after `install` and `upgrade`; the
 * engine runs it every few minutes; a start through agent-switch runs it for
 * the one profile it starts.
 */

import { approve, liveEnv, readFollow, report, setConfirmNew, setRelation, syncAll, targetKey, type FollowKind, type SyncReport } from "../follow.js";
import { die, requireProfile } from "../profiles.js";

const USAGE =
  "usage: agent-switch sync [run|status|confirm on|off|approve [<profile>]|follow <profile> [--from <profile|default>]|unfollow <profile>] [--app claude-desktop] [--force] [--quiet] [--json]";

const STATE_LABEL: Record<string, string> = {
  applied: "in step",
  "pending-app-running": "waiting (app open)",
  "pending-approval": "waiting for approval",
  differs: "differs",
  failed: "failed",
  off: "not following",
  unsynced: "not synced yet",
};

function kindOf(flags: Record<string, string | boolean>): FollowKind {
  const app = flags.app;
  if (app === undefined) return "claude";
  if (app === "claude-desktop") return "claude-desktop";
  return die(`--app takes claude-desktop (got ${String(app)}).`);
}

function print(r: SyncReport, flags: Record<string, string | boolean>): void {
  if (flags.json) return void console.log(JSON.stringify(r, null, 2));
  if (!r.ran) console.log("Another sync is running — showing the last result.");
  if (flags.quiet) {
    const off = r.targets.filter((t) => t.state === "failed" || t.state === "pending-approval");
    for (const t of off) console.log(`agent-switch sync: ${t.key} ${STATE_LABEL[t.state]} — ${t.detail}`);
    return;
  }
  console.log(`New plugins and extensions: ${r.confirmNew ? "wait for `agent-switch sync approve`" : "applied automatically"}`);
  for (const t of r.targets) console.log(`  ${t.key.padEnd(28)} ← ${t.source.padEnd(10)} ${STATE_LABEL[t.state] ?? t.state}${t.detail ? ` — ${t.detail}` : ""}`);
}

export function cmdSync(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const kind = kindOf(flags);
  switch (sub ?? "run") {
    case "run": {
      const r = syncAll(undefined, { force: !!flags.force, profile: args[0] ? requireProfile("claude", args[0], "sync") : undefined });
      print(r, flags);
      if (r.targets.some((t) => t.state === "failed")) process.exitCode = 1;
      return;
    }
    case "status": {
      print(report(readFollow(), liveEnv(), true), flags);
      return;
    }
    case "confirm": {
      const on = args[0] === "on" ? true : args[0] === "off" ? false : die(USAGE);
      setConfirmNew(on);
      if (flags.json) return void console.log(JSON.stringify({ confirmNew: on }));
      console.log(on ? "New plugins and Desktop extensions now wait for `agent-switch sync approve`." : "New plugins and Desktop extensions are applied automatically.");
      return;
    }
    case "approve": {
      const key = args[0] ? targetKey(kind, requireProfile("claude", args[0], "sync approve")) : null;
      const done = approve(key);
      if (!done.length) return void console.log("Nothing waits for approval.");
      console.log(`Approved: ${done.join(", ")}`);
      print(syncAll(undefined, { profile: args[0] }), flags);
      return;
    }
    case "follow": {
      const p = requireProfile("claude", args[0] ?? die(USAGE), "sync follow");
      const from = typeof flags.from === "string" ? (flags.from === "default" ? "default" : requireProfile("claude", flags.from, "sync follow --from")) : undefined;
      const rel = setRelation(kind, p, { enabled: true, ...(from ? { source: from } : {}) });
      console.log(`${targetKey(kind, p)} follows ${rel.source}.`);
      print(syncAll(undefined, { profile: p, kinds: [kind] }), flags);
      return;
    }
    case "unfollow": {
      const p = requireProfile("claude", args[0] ?? die(USAGE), "sync unfollow");
      setRelation(kind, p, { enabled: false });
      console.log(`${targetKey(kind, p)} no longer follows its source; what it has stays.`);
      return;
    }
    default:
      die(USAGE);
  }
}
