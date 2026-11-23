/** `agent-switch statusline on|off|status [profile]` and the managed `__statusline` render command (ADR-011). */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, configDir, die, listProfiles, profileDir, requireProfile } from "../profiles.js";
import {
  NEWEST_KNOWN_VERSION,
  STATUSLINE_TTL_MS,
  captureStatusline,
  installStatusline,
  installedBinary,
  readStatuslineCache,
  resolveStatuslineBinary,
  statuslineCommand,
  statuslineHealth,
  uninstallStatusline,
  versionNewer,
} from "../statusline.js";

/** Claude Code runs this on every render. It writes no byte to stdout and exits 0
 *  on every path: turning collection on must not change what the user sees. */
export function cmdStatusline(): void {
  let text = "";
  try {
    text = fs.readFileSync(0, "utf8");
  } catch {
    return;
  }
  captureStatusline(text, process.env, ROOT);
}

/** The profiles a profile's settings.json serves: itself plus every profile
 *  whose settings.json resolves to the same file (a `share on` link). */
function servedBy(name: string): string[] {
  const real = (n: string) => {
    try {
      return fs.realpathSync(path.join(configDir("claude", n), "settings.json"));
    } catch {
      return null;
    }
  };
  const mine = real(name);
  if (!mine) return [name];
  return listProfiles("claude").filter((n) => n === name || real(n) === mine);
}

function ago(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** One line describing the newest sample, with the version canary. */
export function sampleLine(name: string, now: number = Date.now()): string {
  const cache = readStatuslineCache(profileDir("claude", name));
  if (!cache) return "no sample yet — a sample arrives once a session on this account has had its first answer";
  const age = now - Date.parse(cache.snapshot.capturedAt);
  const fresh = age < STATUSLINE_TTL_MS ? "" : " (stale — the poll answers until a session renders again)";
  const ver = cache.version ? ` from Claude Code ${cache.version}` : "";
  const canary = cache.version && versionNewer(cache.version, NEWEST_KNOWN_VERSION) ? ` — newer than ${NEWEST_KNOWN_VERSION}, the newest version checked; if numbers look wrong the poll still covers` : "";
  return `last sample ${ago(age)}${ver}${fresh}${canary}`;
}

export function cmdStatuslineCli(sub: string | undefined, name?: string): void {
  const action = sub ?? "status";
  if (!["on", "off", "status"].includes(action)) die("usage: agent-switch statusline on|off|status [profile]");
  const profiles = name ? [requireProfile("claude", name, "statusline")] : listProfiles("claude");
  if (profiles.length === 0) die("no claude profiles");

  if (action === "status") {
    for (const p of profiles) {
      const health = statuslineHealth(configDir("claude", p), profileDir("claude", p));
      const bin = installedBinary(configDir("claude", p), profileDir("claude", p));
      const text: Record<typeof health, string> = {
        present: `on · ${sampleLine(p)}`,
        displaced: "displaced — another statusLine took the slot after Agent Switch's; it is kept, and usage is polled",
        missing: "removed — the statusLine entry is gone; usage is polled (run `agent-switch statusline on` to restore)",
        off: "off — usage is polled",
      };
      const moved = bin && !fs.existsSync(bin) ? ` · points at a missing binary (${bin}) — run \`agent-switch statusline on\`` : "";
      console.log(`claude/${p}: ${text[health]}${moved}`);
    }
    return;
  }

  let command: string | null = null;
  if (action === "on") {
    const bin = resolveStatuslineBinary();
    if (!bin) {
      console.error("error: cannot find an absolute path to agent-switch (not on PATH, and this run has no script path). Nothing was changed; usage keeps polling.");
      process.exitCode = 1;
      return;
    }
    command = statuslineCommand(bin);
  }

  let changed = false;
  const done = new Set<string>();
  for (const p of profiles) {
    if (done.has(p)) continue;
    const group = servedBy(p);
    group.forEach((g) => done.add(g));
    if (group.length > 1) console.log(`claude/${group.join(", claude/")} share one settings.json — this ${action === "on" ? "turns it on" : "turns it off"} for all of them.`);
    for (const g of group) {
      if (action === "on") {
        let r: ReturnType<typeof installStatusline>;
        try {
          r = installStatusline(configDir("claude", g), profileDir("claude", g), command!);
        } catch (e) {
          console.log(`claude/${g}: refused — ${(e as Error).message}`);
          process.exitCode = 1;
          continue;
        }
        changed ||= r.changed;
        const msg =
          r.reason === "has-own" ? "left alone — it has a statusLine of its own (Agent Switch never wraps one); usage keeps polling"
          : r.reason === "repointed" ? `on (re-pointed at ${command})`
          : r.changed ? "on"
          : "already on";
        console.log(`claude/${g}: ${msg}`);
      } else {
        let r: ReturnType<typeof uninstallStatusline>;
        try {
          r = uninstallStatusline(configDir("claude", g), profileDir("claude", g));
        } catch (e) {
          console.log(`claude/${g}: refused — ${(e as Error).message}`);
          process.exitCode = 1;
          continue;
        }
        changed ||= r.changed;
        const msg = r.reason === "not-ours" ? "left alone — the statusLine there is not Agent Switch's" : r.changed ? "off" : "already off";
        console.log(`claude/${g}: ${msg}`);
      }
    }
  }
  if (changed) {
    if (action === "on") console.log("\nSessions started from now on report usage as they render; the poll answers for everything else.");
    console.log("settings.json changed. If you use `share on`, run `agent-switch share sync` so the edit propagates and the link is restored.");
  }
}
