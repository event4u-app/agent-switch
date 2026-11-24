/**
 * `agent-switch debug-log` — the app's debug log (see ../debug-log.ts): read it,
 * switch it on or off, add the app's entries, show the file.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { appendDebug, DEBUG_LOG_FILE, DEBUG_LOG_KEEP, debugLogEnabled, formatDebug, readDebug, setDebugLog } from "../debug-log.js";
import { plan, realEnv } from "../open-in.js";
import { die } from "../profiles.js";

const USAGE = "usage: agent-switch debug-log [--json] · debug-log status [--json] · debug-log on|off|clear · debug-log reveal · debug-log add <json>";

export function cmdDebugLog(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const status = () => ({ enabled: debugLogEnabled(), file: DEBUG_LOG_FILE, keep: DEBUG_LOG_KEEP, entries: readDebug().length });
  switch (sub) {
    case undefined: {
      const entries = readDebug();
      if (flags.json) return void console.log(JSON.stringify({ ...status(), log: entries }));
      console.log(`Debug log ${debugLogEnabled() ? "on" : "off"} · ${DEBUG_LOG_FILE} · newest ${DEBUG_LOG_KEEP}`);
      for (const e of entries) console.log(formatDebug(e));
      return;
    }
    case "status":
      return void console.log(flags.json ? JSON.stringify(status()) : `Debug log ${debugLogEnabled() ? "on" : "off"} · ${DEBUG_LOG_FILE}`);
    case "on":
    case "off":
      setDebugLog(sub === "on");
      return void console.log(flags.json ? JSON.stringify({ ok: true, ...status() }) : `Debug log ${sub}.`);
    case "clear":
      fs.rmSync(DEBUG_LOG_FILE, { force: true });
      return void console.log(flags.json ? JSON.stringify({ ok: true }) : "Debug log cleared.");
    case "reveal": {
      const file = fs.existsSync(DEBUG_LOG_FILE) ? DEBUG_LOG_FILE : undefined;
      const p = plan("finder", path.dirname(DEBUG_LOG_FILE), realEnv, file);
      if (!p) die("no file manager to show the debug log in");
      spawnSync(p.program, p.args, { stdio: "ignore" });
      return void console.log(flags.json ? JSON.stringify({ ok: true }) : `Revealed ${DEBUG_LOG_FILE}.`);
    }
    case "add": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(args[0] ?? "");
      } catch {
        die(USAGE);
      }
      const n = appendDebug(Array.isArray(parsed) ? parsed : [parsed]);
      if (n === null) {
        process.exitCode = 1;
        return void console.log(JSON.stringify({ ok: false, error: "the debug log could not be written" }));
      }
      return void console.log(JSON.stringify({ ok: true, done: String(n) }));
    }
    default:
      die(USAGE);
  }
}
