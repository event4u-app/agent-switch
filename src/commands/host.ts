/**
 * `agent-switch host start|list|end` — sessions that keep running when the
 * window closes (src/host/tmux-host.ts). Hosting is opt-in per start: a plain
 * `claude` keeps starting in the user's own terminal as before.
 */

import * as path from "node:path";

import { configDir, die, readBinaryPath, requireProfile, ROOT } from "../profiles.js";
import { provider, type ProviderId } from "../providers.js";
import { HostUnavailable, TmuxHost } from "../host/tmux-host.js";

export function cmdHost(providerId: ProviderId, sub: string | undefined, arg: string | undefined, flags: Record<string, string | boolean>): void {
  const action = sub ?? "list";
  if (!["start", "list", "end"].includes(action)) die("usage: agent-switch host start <profile> [--provider P] [--cwd DIR] | list | end <session-key>");
  if (!TmuxHost.available()) {
    die(process.platform === "win32"
      ? "hosting needs tmux, which Windows does not have; sessions started in the app there are ephemeral"
      : "hosting needs tmux (macOS: brew install tmux · Debian/Ubuntu: apt install tmux)");
  }
  const host = new TmuxHost(ROOT);
  try {
    if (action === "start") {
      if (providerId !== "claude" && providerId !== "codex") die(`hosting supports claude and codex for now`);
      const profile = requireProfile(providerId, arg, "host start");
      const cwd = path.resolve(typeof flags.cwd === "string" ? flags.cwd : process.cwd());
      const bin = readBinaryPath(providerId) ?? provider(providerId).binary;
      const s = host.start({ provider: providerId, account: profile, configDir: configDir(providerId, profile), cwd, bin }, hookCommandPrefix());
      if (flags.json) console.log(JSON.stringify(s));
      else console.log(`Started ${s.key} in ${cwd}. It keeps running when you close the window; end it with: agent-switch host end ${s.key}`);
      return;
    }
    if (action === "end") {
      if (!arg) die("usage: agent-switch host end <session-key>");
      if (!host.end(arg)) die(`no hosted session ${arg}`);
      console.log(`Ended ${arg}.`);
      return;
    }
    const rows = host.list();
    const legacy = host.legacy();
    if (flags.json) {
      console.log(JSON.stringify({ hosted: rows, legacy }));
      return;
    }
    if (rows.length === 0 && legacy.length === 0) console.log("No hosted sessions.");
    for (const r of rows) console.log(`${r.alive ? "*" : " "} ${r.key}  ${r.cwd}  since ${r.startedAt}`);
    for (const l of legacy) console.log(`  ${l.name}  (2.x tmux session of ${l.provider}/${l.profile}, read-only)`);
  } catch (err) {
    if (err instanceof HostUnavailable) die(err.message);
    throw err;
  }
}

/** The hook command must reach this very CLI, wherever it is installed; the
 *  hooks run it through a shell, so each part is single-quoted. */
function hookCommandPrefix(): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return process.argv[1] ? `${q(process.execPath)} ${q(process.argv[1])}` : "agent-switch";
}
