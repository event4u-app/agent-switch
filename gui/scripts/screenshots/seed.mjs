/**
 * Seeds a throw-away agent-switch home for the screenshot run: claude
 * work/side/personal, codex work/personal (example.com identities only), labels,
 * a pool, folder rules, protection, notifications, activity, usage history and
 * a handful of Claude session transcripts — two of them "live" (a parked
 * `sleep` whose cwd is the project folder, registered as the profile's pid file).
 *
 * The temp dir doubles as $HOME for the CLI, so every path it prints starts with
 * the temp dir; the harness rewrites that prefix to `~` before the GUI sees it.
 */

import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { EMAILS } from "./fixtures.mjs";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const PROJECTS = ["agent-config", "agent-switch", "galawork-api", "data-helpers"];

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

/** Deterministic PRNG so every run renders the same charts. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function setTimes(file, startMs, lastMs) {
  // macOS: setting mtime before the birthtime moves the birthtime back too,
  // which is what the GUI reads as "started at".
  fs.utimesSync(file, new Date(startMs), new Date(startMs));
  fs.utimesSync(file, new Date(lastMs), new Date(lastMs));
}

/** One transcript: header line (cwd + summary), a few turns, and an assistant
 *  line carrying usage so the context % renders. */
function transcript({ cwd, summary, turns, model, contextTokens, startMs }) {
  const lines = [{ type: "summary", summary, cwd, leafUuid: "00000000-0000-4000-8000-000000000000" }];
  let t = startMs;
  turns.forEach(([role, text], i) => {
    t += 2 * MIN;
    const last = i === turns.length - 1;
    lines.push({
      type: role,
      cwd,
      timestamp: new Date(t).toISOString(),
      message:
        role === "user"
          ? { role, content: text }
          : {
              id: `msg_${i}`,
              role,
              model,
              stop_reason: "end_turn",
              content: [{ type: "text", text }],
              usage: last
                ? { input_tokens: 1200, cache_read_input_tokens: contextTokens - 4200, cache_creation_input_tokens: 3000, output_tokens: 900 }
                : { input_tokens: 900, cache_read_input_tokens: 20000, cache_creation_input_tokens: 1000, output_tokens: 400 },
            },
    });
  });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

const SESSIONS = [
  {
    profile: "work",
    project: "agent-config",
    id: "5b1f7c2e-8a41-4d0b-9e3a-2c6f1d8e4a10",
    summary: "Knowledge map: edge filter for stale links",
    live: true,
    startAgo: 84 * MIN,
    lastAgo: 20_000,
    model: "claude-opus-4-7",
    contextTokens: 412_000,
    turns: [
      ["user", "The knowledge map shows edges to notes that were deleted. Filter those out before rendering."],
      ["assistant", "I'll trace where edges are built. The map reads links from the index, but never checks whether the target note still exists."],
      ["user", "Keep the filter in the loader, not in the renderer."],
      ["assistant", "Moved the existence check into loadEdges() and added a test for a dangling link. Running the suite now."],
    ],
  },
  {
    profile: "side",
    project: "agent-switch",
    id: "9c3e2a71-4f6d-4b8e-a1c2-7d5e9f0b3c24",
    summary: "Redesign: README screenshots",
    live: true,
    startAgo: 2 * HOUR + 10 * MIN,
    lastAgo: 2 * MIN,
    model: "claude-opus-4-7",
    contextTokens: 168_000,
    turns: [
      ["user", "Capture fresh README screenshots of the redesigned app."],
      ["assistant", "I'll render each screen against a seeded demo home so no real account data shows up."],
    ],
  },
  {
    profile: "personal",
    project: "data-helpers",
    id: "e2d4b6a8-1c3f-4e5a-9b7d-0f2e4c6a8b13",
    summary: "Map CSV columns to the import schema",
    live: false,
    startAgo: 4 * HOUR,
    lastAgo: 3 * HOUR,
    model: "claude-sonnet-4-6",
    contextTokens: 96_000,
    turns: [
      ["user", "Write a helper that maps the CSV headers to our import schema, case-insensitive."],
      ["assistant", "Added mapColumns() with a synonym table and a report of unmapped headers."],
    ],
  },
  {
    profile: "work",
    project: "galawork-api",
    id: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    summary: "Invoice export: paginate results",
    live: false,
    startAgo: 26 * HOUR,
    lastAgo: 25 * HOUR,
    model: "claude-sonnet-4-6",
    contextTokens: 210_000,
    turns: [
      ["user", "The invoice export times out for large tenants. Paginate it."],
      ["assistant", "Switched the export to a cursor over invoice ids, 500 per page, and streamed the CSV."],
    ],
  },
  {
    profile: "side",
    project: "agent-config",
    id: "7f8e9d0c-1b2a-4c3d-8e4f-5a6b7c8d9e0f",
    summary: "Release notes for 18.2.0",
    live: false,
    startAgo: 6 * HOUR,
    lastAgo: 5 * HOUR,
    model: "claude-opus-4-7",
    contextTokens: 74_000,
    turns: [
      ["user", "Draft the release notes for 18.2.0 from the merged PRs."],
      ["assistant", "Grouped the changes into features, fixes and docs; flagged one breaking settings rename."],
    ],
  },
  {
    profile: "work",
    project: "agent-switch",
    id: "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
    summary: "Tray popover: size to content",
    live: false,
    startAgo: 2 * DAY,
    lastAgo: 2 * DAY - 40 * MIN,
    model: "claude-opus-4-7",
    contextTokens: 133_000,
    turns: [
      ["user", "The tray popover leaves an empty strip at the bottom."],
      ["assistant", "It measured before fonts loaded. Now it re-measures on a ResizeObserver and resizes the window."],
    ],
  },
  {
    profile: "personal",
    project: "data-helpers",
    id: "c0ffee00-1234-4abc-8def-0123456789ab",
    summary: "Dedupe contacts by normalised email",
    live: false,
    startAgo: 3 * DAY,
    lastAgo: 3 * DAY - 25 * MIN,
    model: "claude-sonnet-4-6",
    contextTokens: 52_000,
    turns: [
      ["user", "Dedupe the contacts list by email, ignoring case and dots in gmail addresses."],
      ["assistant", "Done — normaliseEmail() plus a merge that keeps the newest record."],
    ],
  },
];

function usageHistory(seed, base, now) {
  const r = rng(seed);
  const samples = [];
  for (let h = 30 * 24; h >= 1; h--) {
    const at = now - h * HOUR;
    const hourOfDay = new Date(at).getHours();
    const busy = hourOfDay >= 9 && hourOfDay <= 19 ? 1 : 0.25;
    const five = Math.min(100, Math.round(base * busy * (0.5 + r())));
    const seven = Math.min(100, Math.round(((30 * 24 - h) % (7 * 24)) / (7 * 24) * base + r() * 8));
    samples.push({ at: new Date(at).toISOString(), windows: [{ key: "five_hour", utilization: five }, { key: "seven_day", utilization: seven }] });
  }
  return { samples };
}

/**
 * @returns {{ home: string, ash: string, env: NodeJS.ProcessEnv, liveFiles: string[], cleanup: () => void }}
 */
export function seedHome(cliPath, now = Date.now()) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "as-shots-")));
  const ash = path.join(home, ".agent-switch");
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    AGENT_SWITCH_HOME: ash,
    LANG: "en_US.UTF-8",
    TZ: process.env.TZ ?? "Europe/Berlin",
  };
  const run = (...args) => execFileSync(process.execPath, [cliPath, ...args], { env, encoding: "utf8", cwd: home });

  for (const p of PROJECTS) fs.mkdirSync(path.join(home, "dev", p), { recursive: true });

  const profiles = [
    ["claude", "work"],
    ["claude", "side"],
    ["claude", "personal"],
    ["codex", "work"],
    ["codex", "personal"],
  ];
  for (const [provider, name] of profiles) {
    const dir = path.join(ash, provider, name, "config");
    fs.mkdirSync(dir, { recursive: true });
    const email = EMAILS[`${provider}/${name}`];
    if (provider === "claude") {
      fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: email } }));
    } else {
      const idToken = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ email })}.sig`;
      fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ tokens: { id_token: idToken, account_id: `acct-${name}` } }));
    }
  }

  run("label", "work", "Work");
  run("label", "side", "Other");
  run("label", "personal", "Personal");
  run("label", "work", "Work", "--provider", "codex");
  run("label", "personal", "Personal", "--provider", "codex");
  run("use", "work");
  run("use", "work", "--provider", "codex");

  const pool = JSON.parse(run("pool", "create", "work", "--json"));
  run("pool", "add", pool.id, "claude/work");
  run("pool", "add", pool.id, "claude/side");

  run("map", `pool:${pool.id}`, path.join(home, "dev", "agent-config"));
  run("map", "side", path.join(home, "dev", "agent-switch"));
  run("map", "work", path.join(home, "dev", "galawork-api"), "--provider", "codex");
  run("map", "personal", path.join(home, "dev", "data-helpers"));

  run("protection", "set", "claude/work", "--on", "--threshold", "95");
  run("protection", "set", "claude/side", "--on", "--threshold", "98");
  run("protection", "set", "codex/work", "--on", "--threshold", "90");
  run("guard", "warn");
  run("gui-settings", "set", "autostart", "enabled", "--by", "first-run");
  run("gui-settings", "set", "pet-welcomed");

  run("notify", "--kind", "warning", "--title", "side is at 94 % of its 5h window", "--message", "Agent Switch warns at 98 %. Resets in 1h 18m.");
  run("notify", "--kind", "success", "--title", "Switched to work", "--message", "~/dev/agent-config starts on work (pool work, most headroom).");
  run("notify", "--kind", "info", "--title", "Codex CLI 0.150.0 is out", "--message", "You have 0.148.0. Running sessions are not touched.");

  // Usage history (30 days, hourly) for the profiles with a readout.
  const bases = { "claude/work": [11, 55], "claude/side": [12, 70], "claude/personal": [13, 80], "codex/work": [14, 40] };
  for (const [key, [seed, base]] of Object.entries(bases)) {
    const [provider, name] = key.split("/");
    fs.writeFileSync(path.join(ash, provider, name, "usage-history.json"), JSON.stringify(usageHistory(seed, base, now)));
  }

  // Activity: replace what the seeding commands logged with a believable day.
  const act = [
    [3 * MIN, "protection", "claude/side", "warned at 94 %", "5h window is close to the 98 % protection threshold", true],
    [24 * MIN, "switch", "claude/work", "activated", "folder rule ~/dev/agent-config → pool work (most headroom)", true],
    [41 * MIN, "login", "codex/personal", "sign-in needed", "Codex turned down the refresh", false],
    [2 * HOUR, "update", null, "rtk 0.31.0 installed", "user clicked Update in Tools", true],
    [5 * HOUR, "pool", "work", "added claude/side", "user ran `agent-switch pool add`", true],
    [9 * HOUR, "guard", null, "set warn", "user changed it in Settings", true],
    [26 * HOUR, "switch", "codex/work", "activated", "user ran `agent-switch use`", true],
    [2 * DAY, "autostart", null, "start at login enabled", "first-run default, confirmed with the OS", true],
  ];
  fs.writeFileSync(
    path.join(ash, "activity.jsonl"),
    act
      .reverse()
      .map(([ago, kind, target, action, reason, ok]) => JSON.stringify({ at: new Date(now - ago).toISOString(), kind, target, action, reason, ok }))
      .join("\n") + "\n",
  );

  // Session transcripts + live markers.
  const sleepers = [];
  const liveFiles = [];
  for (const s of SESSIONS) {
    const cwd = path.join(home, "dev", s.project);
    const cfg = path.join(ash, "claude", s.profile, "config");
    const dir = path.join(cfg, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${s.id}.jsonl`);
    fs.writeFileSync(file, transcript({ cwd, summary: s.summary, turns: s.turns, model: s.model, contextTokens: s.contextTokens, startMs: now - s.startAgo }));
    setTimes(file, now - s.startAgo, now - s.lastAgo);
    if (s.live) {
      const child = spawn("sleep", ["900"], { cwd, stdio: "ignore", detached: false });
      sleepers.push(child);
      fs.mkdirSync(path.join(cfg, "sessions"), { recursive: true });
      fs.writeFileSync(path.join(cfg, "sessions", `${child.pid}.json`), JSON.stringify({ pid: child.pid, sessionId: s.id, cwd }));
      liveFiles.push({ file, startMs: now - s.startAgo, lagMs: s.lastAgo });
    }
  }

  return {
    home,
    ash,
    env,
    liveFiles,
    cleanup() {
      for (const c of sleepers) {
        try {
          c.kill();
        } catch {
          /* already gone */
        }
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
