import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeUsage, parseStatuslineUsage, type UsageSnapshot } from "../src/usage.js";
import {
  STATUSLINE_FILE,
  STATUSLINE_MARKER,
  STATUSLINE_TTL_MS,
  NEWEST_KNOWN_VERSION,
  captureStatusline,
  installStatusline,
  isOurStatusline,
  mergeMonotone,
  profileForConfigDir,
  readStatuslineCache,
  readStatuslineSnapshot,
  resolveStatuslineBinary,
  statuslineCommand,
  statuslineFresh,
  statuslineHealth,
  uninstallStatusline,
  versionNewer,
  withStatuslineInstalled,
  withStatuslineRemoved,
  writeStatuslineSnapshot,
} from "../src/statusline.js";
import { SHARED_ITEMS, HISTORY_ITEM_NAMES } from "../src/share.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync([path.resolve(here, "fixtures", name), path.resolve(here, "../../tests/fixtures", name)].find((p) => fs.existsSync(p))!, "utf8"));
const tmp = (p = "asw-sl-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const AT = "2026-11-23T12:00:00.000Z";

// ---------- parser ----------

test("parseStatuslineUsage reads the 2.1.316 capture: 5h and 7d, epoch seconds → ISO", () => {
  const s = parseStatuslineUsage(fixture("statusline-stdin.json"), AT)!;
  assert.ok(s);
  assert.equal(s.source, "statusline");
  assert.equal(s.capturedAt, AT);
  assert.deepEqual(
    s.windows.map((w) => [w.key, w.utilization, w.resetsAt]),
    [
      ["five_hour", 7, new Date(1795414200 * 1000).toISOString()],
      ["seven_day", 3, new Date(1795806000 * 1000).toISOString()],
    ],
  );
  assert.equal(s.routines, null);
});

test("parseStatuslineUsage: no rate_limits → null, never an empty snapshot", () => {
  assert.equal(parseStatuslineUsage(fixture("statusline-stdin-freetier.json"), AT), null);
  assert.equal(parseStatuslineUsage({ rate_limits: {} }, AT), null);
  assert.equal(parseStatuslineUsage({ rate_limits: { five_hour: { used_percentage: "x" } } }, AT), null);
  assert.equal(parseStatuslineUsage(null, AT), null);
  assert.equal(parseStatuslineUsage("garbage", AT), null);
});

test("parseStatuslineUsage accepts `utilization`, ISO resets and epoch ms; drops a bad window only", () => {
  const s = parseStatuslineUsage(
    { rate_limits: { five_hour: { utilization: 41.6, resets_at: "2026-11-23T15:00:00Z" }, seven_day: { used_percentage: 12, resets_at: 1795806000000 }, opus: { used_percentage: 3 } } },
    AT,
  )!;
  assert.deepEqual(
    s.windows.map((w) => [w.key, w.utilization, w.resetsAt]),
    [
      ["five_hour", 42, "2026-11-23T15:00:00.000Z"],
      ["seven_day", 12, new Date(1795806000000).toISOString()],
    ],
  );
  const partial = parseStatuslineUsage({ rate_limits: { five_hour: { used_percentage: 5, resets_at: "not a date" }, seven_day: 7 } }, AT)!;
  assert.deepEqual(partial.windows.map((w) => [w.key, w.utilization, w.resetsAt]), [["five_hour", 5, null]]);
});

// ---------- merge ----------

const win = (key: string, utilization: number, resetsAt = "2026-11-24T00:00:00.000Z", label = key) => ({ key, label, utilization, resetsAt });

test("mergeUsage: statusline 5h/7d over polled opus/sonnet → all four, per-window provenance, older capturedAt", () => {
  const sl: UsageSnapshot = { windows: [win("five_hour", 50), win("seven_day", 20)], routines: null, capturedAt: "2026-11-23T12:00:00.000Z", source: "statusline" };
  const poll: UsageSnapshot = {
    windows: [win("five_hour", 40, undefined, "5h"), win("seven_day", 18, undefined, "7d"), win("seven_day_opus", 70), win("seven_day_sonnet", 10)],
    routines: { used: 1, limit: 5 },
    capturedAt: "2026-11-23T11:58:00.000Z",
  };
  const m = mergeUsage(sl, poll)!;
  assert.equal(m.source, "merged");
  assert.equal(m.capturedAt, poll.capturedAt);
  assert.deepEqual(m.routines, poll.routines);
  assert.deepEqual(
    m.windows.map((w) => [w.key, w.label, w.utilization, w.source, w.capturedAt]),
    [
      ["five_hour", "5h", 50, "statusline", sl.capturedAt],
      ["seven_day", "7d", 20, "statusline", sl.capturedAt],
      ["seven_day_opus", "seven_day_opus", 70, "poll", poll.capturedAt],
      ["seven_day_sonnet", "seven_day_sonnet", 10, "poll", poll.capturedAt],
    ],
  );
});

test("mergeUsage: a window newer in the poll is not overwritten by an older statusline reading", () => {
  const sl: UsageSnapshot = { windows: [win("five_hour", 30)], routines: null, capturedAt: "2026-11-23T11:00:00.000Z", source: "statusline" };
  const poll: UsageSnapshot = { windows: [win("five_hour", 35), win("seven_day", 9)], routines: null, capturedAt: "2026-11-23T11:30:00.000Z" };
  const m = mergeUsage(sl, poll)!;
  assert.deepEqual(m.windows.map((w) => [w.key, w.utilization, w.source]), [["five_hour", 35, "poll"], ["seven_day", 9, "poll"]]);
  assert.equal(m.source, "poll");
});

test("mergeUsage: only statusline windows contribute → its own capturedAt; a window absent from both stays absent", () => {
  const sl: UsageSnapshot = { windows: [win("five_hour", 1), win("seven_day", 2)], routines: null, capturedAt: AT, source: "statusline" };
  const poll: UsageSnapshot = { windows: [win("five_hour", 0), win("seven_day", 0)], routines: null, capturedAt: "2026-11-23T10:00:00.000Z" };
  const m = mergeUsage(sl, poll)!;
  assert.equal(m.capturedAt, AT);
  assert.equal(m.source, "statusline");
  assert.equal(mergeUsage(null, poll), poll);
  assert.equal(mergeUsage(sl, null), sl);
  assert.equal(mergeUsage(null, null), null);
  // Idempotent over its own output: merging the same sample again changes nothing.
  assert.deepEqual(mergeUsage(sl, m), m);
});

// ---------- cache + monotone rule ----------

test("cache round-trips; corrupted → null; null snapshot → no write", () => {
  const dir = tmp();
  assert.equal(readStatuslineSnapshot(dir), null);
  assert.equal(writeStatuslineSnapshot(dir, null, "2.1.316"), false);
  assert.equal(fs.existsSync(path.join(dir, STATUSLINE_FILE)), false);
  const s = parseStatuslineUsage(fixture("statusline-stdin.json"), AT)!;
  assert.equal(writeStatuslineSnapshot(dir, s, "2.1.316"), true);
  assert.deepEqual(readStatuslineSnapshot(dir)?.windows, s.windows);
  assert.equal(readStatuslineCache(dir)?.version, "2.1.316");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, STATUSLINE_FILE)).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(dir, STATUSLINE_FILE), "{not json");
  assert.equal(readStatuslineSnapshot(dir), null);
  fs.writeFileSync(path.join(dir, STATUSLINE_FILE), JSON.stringify({ schema: 1, snapshot: { windows: [], capturedAt: AT } }));
  assert.equal(readStatuslineSnapshot(dir), null);
});

test("monotone: within one reset window the higher reading stays; a later reset starts over; an earlier one is ignored", () => {
  const R = "2026-11-23T15:00:00.000Z";
  const at = (min: number) => new Date(Date.parse(AT) + min * 60_000).toISOString();
  const snap = (u5: number, r5: string, min: number): UsageSnapshot => ({ windows: [win("five_hour", u5, r5, "5h"), win("seven_day", 10, "2026-11-28T00:00:00.000Z", "7d")], routines: null, capturedAt: at(min), source: "statusline" });
  const busy = snap(60, R, 0);
  // An idle session renders its older, lower reading after the busy one.
  const idle = mergeMonotone(busy, snap(40, R, 1));
  assert.equal(idle.windows.find((w) => w.key === "five_hour")!.utilization, 60);
  assert.equal(idle.capturedAt, at(1));
  // Jitter of a few seconds on resets_at is the same window.
  assert.equal(mergeMonotone(busy, snap(55, "2026-11-23T15:00:03.000Z", 1)).windows[0].utilization, 60);
  // A later reset is a new window: the low number is the truth now.
  assert.equal(mergeMonotone(busy, snap(2, "2026-11-23T20:00:00.000Z", 2)).windows[0].utilization, 2);
  // A payload still on the previous window (earlier reset) does not roll it back.
  const rolled = snap(2, "2026-11-23T20:00:00.000Z", 2);
  const late = mergeMonotone(rolled, snap(90, R, 3));
  assert.deepEqual([late.windows[0].utilization, late.windows[0].resetsAt], [2, "2026-11-23T20:00:00.000Z"]);
  // Higher in the same window replaces.
  assert.equal(mergeMonotone(busy, snap(70, R, 4)).windows[0].utilization, 70);
});

test("writeStatuslineSnapshot applies the monotone rule against the file on disk", () => {
  const dir = tmp();
  const R = "2026-11-23T15:00:00.000Z";
  const s = (u: number): UsageSnapshot => ({ windows: [win("five_hour", u, R, "5h")], routines: null, capturedAt: AT, source: "statusline" });
  writeStatuslineSnapshot(dir, s(60), null);
  writeStatuslineSnapshot(dir, s(40), null);
  assert.equal(readStatuslineSnapshot(dir)!.windows[0].utilization, 60);
});

test("statuslineFresh: age under the TTL, no reset that has passed", () => {
  const now = Date.parse(AT);
  const s = (ageMs: number, reset = "2026-11-23T15:00:00.000Z"): UsageSnapshot => ({ windows: [win("five_hour", 5, reset)], routines: null, capturedAt: new Date(now - ageMs).toISOString() });
  assert.equal(statuslineFresh(s(60_000), now), true);
  assert.equal(statuslineFresh(s(STATUSLINE_TTL_MS + 1), now), false);
  assert.equal(statuslineFresh(s(60_000, "2026-11-23T11:59:00.000Z"), now), false);
  assert.equal(statuslineFresh(null, now), false);
  // The GUI greys data after 10 minutes; a fresh statusline sample is never already grey.
  assert.ok(STATUSLINE_TTL_MS <= 10 * 60_000);
});

// ---------- settings: install / remove (pure) ----------

const CMD = statuslineCommand("/opt/bin/agent-switch");

test("statuslineCommand quotes a path with spaces; isOurStatusline matches any path running __statusline", () => {
  assert.equal(CMD, "/opt/bin/agent-switch __statusline");
  assert.equal(statuslineCommand("/Users/a b/bin/agent-switch"), "'/Users/a b/bin/agent-switch' __statusline");
  assert.equal(isOurStatusline({ type: "command", command: "'/x y/agent-switch' __statusline", padding: 0 }), true);
  assert.equal(isOurStatusline({ type: "command", command: "ccstatusline" }), false);
  assert.equal(isOurStatusline(undefined), false);
});

test("install on a settings without statusLine adds a byte-clean {type,command,padding}; remove restores the rest", () => {
  const before = { model: "opus", hooks: { Stop: [{ hooks: [] }] }, env: { A: "1" } };
  const ins = withStatuslineInstalled(before, CMD);
  assert.equal(ins.changed, true);
  assert.deepEqual(ins.settings.statusLine, { type: "command", command: CMD, padding: 0 });
  assert.deepEqual(Object.keys(ins.settings.statusLine).sort(), ["command", "padding", "type"]);
  assert.equal(JSON.stringify(before), JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [] }] }, env: { A: "1" } }), "input not mutated");
  assert.equal(withStatuslineInstalled(ins.settings, CMD).changed, false, "double install is a no-op");
  const rem = withStatuslineRemoved(ins.settings);
  assert.equal(rem.changed, true);
  assert.equal(JSON.stringify(rem.settings), JSON.stringify(before));
});

test("install refuses a profile that already has its own statusLine", () => {
  const own = { statusLine: { type: "command", command: "~/.claude/statusline.sh" }, theme: "dark" };
  const r = withStatuslineInstalled(own, CMD);
  assert.equal(r.changed, false);
  assert.equal(r.reason, "has-own");
  assert.equal(JSON.stringify(r.settings), JSON.stringify(own));
});

test("install re-points ours at a moved binary; remove keeps a user's replacement", () => {
  const old = { statusLine: { type: "command", command: "/old/agent-switch __statusline", padding: 0 } };
  const r = withStatuslineInstalled(old, CMD);
  assert.deepEqual([r.changed, r.reason, r.settings.statusLine.command], [true, "repointed", CMD]);
  const replaced = { statusLine: { type: "command", command: "npx ccstatusline" } };
  const rem = withStatuslineRemoved(replaced);
  assert.deepEqual([rem.changed, rem.reason], [false, "not-ours"]);
  assert.equal(JSON.stringify(rem.settings), JSON.stringify(replaced));
  assert.deepEqual(withStatuslineRemoved({}).reason, "absent");
});

// ---------- binary resolution ----------

test("resolveStatuslineBinary: an absolute agent-switch on PATH, else the running script; nothing → null", () => {
  const dir = tmp();
  const bin = path.join(dir, "agent-switch");
  fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
  const script = path.join(dir, "index.js");
  fs.writeFileSync(script, "", { mode: 0o755 });
  assert.equal(resolveStatuslineBinary({ pathEnv: dir, argv1: script, platform: "linux" }), bin);
  assert.equal(resolveStatuslineBinary({ pathEnv: path.join(dir, "nope"), argv1: script, platform: "linux" }), script);
  assert.equal(resolveStatuslineBinary({ pathEnv: path.join(dir, "nope"), argv1: undefined, platform: "linux" }), null);
  assert.equal(resolveStatuslineBinary({ pathEnv: path.join(dir, "nope"), argv1: path.join(dir, "gone.js"), platform: "linux" }), null);
  assert.equal(resolveStatuslineBinary({ pathEnv: "relative/dir", argv1: undefined, platform: "linux" }), null);
});

// ---------- disk install / uninstall + marker + health ----------

function profile(root: string, name: string): { profileDir: string; configDir: string } {
  const profileDir = path.join(root, "claude", name);
  const configDir = path.join(profileDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  return { profileDir, configDir };
}

test("install/uninstall on disk: refusal leaves the file and writes no marker; round-trip restores other keys", () => {
  const root = tmp();
  const own = profile(root, "own");
  const ownText = JSON.stringify({ statusLine: { type: "command", command: "my-bar" } }, null, 4);
  fs.writeFileSync(path.join(own.configDir, "settings.json"), ownText);
  const refused = installStatusline(own.configDir, own.profileDir, CMD);
  assert.deepEqual([refused.changed, refused.reason], [false, "has-own"]);
  assert.equal(fs.readFileSync(path.join(own.configDir, "settings.json"), "utf8"), ownText);
  assert.equal(fs.existsSync(path.join(own.profileDir, STATUSLINE_MARKER)), false);

  const p = profile(root, "work");
  const before = { model: "opus", permissions: { allow: ["Bash(ls)"] } };
  fs.writeFileSync(path.join(p.configDir, "settings.json"), JSON.stringify(before, null, 2) + "\n");
  assert.equal(installStatusline(p.configDir, p.profileDir, CMD).changed, true);
  assert.equal(fs.existsSync(path.join(p.profileDir, STATUSLINE_MARKER)), true);
  assert.equal(statuslineHealth(p.configDir, p.profileDir), "present");
  assert.equal(uninstallStatusline(p.configDir, p.profileDir).changed, true);
  assert.equal(fs.readFileSync(path.join(p.configDir, "settings.json"), "utf8"), JSON.stringify(before, null, 2) + "\n");
  assert.equal(fs.existsSync(path.join(p.profileDir, STATUSLINE_MARKER)), false);
  assert.equal(statuslineHealth(p.configDir, p.profileDir), "off");
});

test("health: displaced when a foreign statusLine replaced ours, missing when the key is gone", () => {
  const root = tmp();
  const p = profile(root, "work");
  installStatusline(p.configDir, p.profileDir, CMD);
  fs.writeFileSync(path.join(p.configDir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "npx ccstatusline" } }));
  assert.equal(statuslineHealth(p.configDir, p.profileDir), "displaced");
  const r = uninstallStatusline(p.configDir, p.profileDir);
  assert.deepEqual([r.changed, r.reason], [false, "not-ours"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(p.configDir, "settings.json"), "utf8")).statusLine.command, "npx ccstatusline");
  installStatusline(profile(root, "b").configDir, path.join(root, "claude", "b"), CMD);
  fs.writeFileSync(path.join(root, "claude", "b", "config", "settings.json"), "{}");
  assert.equal(statuslineHealth(path.join(root, "claude", "b", "config"), path.join(root, "claude", "b")), "missing");
});

test("install writes through a shared settings.json symlink and keeps the link", { skip: process.platform === "win32" }, () => {
  const root = tmp();
  const shared = path.join(root, "shared-settings.json");
  fs.writeFileSync(shared, JSON.stringify({ theme: "dark" }));
  const p = profile(root, "work");
  fs.symlinkSync(shared, path.join(p.configDir, "settings.json"));
  installStatusline(p.configDir, p.profileDir, CMD);
  assert.equal(fs.lstatSync(path.join(p.configDir, "settings.json")).isSymbolicLink(), true);
  assert.equal(JSON.parse(fs.readFileSync(shared, "utf8")).statusLine.command, CMD);
});

// ---------- profile mapping + capture ----------

test("profileForConfigDir: only a registered claude profile's config dir; symlinks canonicalised; unknown → null", () => {
  const root = tmp();
  profile(root, "work");
  profile(root, "side");
  assert.equal(profileForConfigDir(path.join(root, "claude", "work", "config"), root), "work");
  assert.equal(profileForConfigDir(path.join(root, "claude", "work", "config") + path.sep, root), "work");
  const alias = path.join(tmp(), "alias");
  fs.symlinkSync(path.join(root, "claude", "side", "config"), alias);
  assert.equal(profileForConfigDir(alias, root), "side");
  assert.equal(profileForConfigDir(path.join(root, "claude", "ghost", "config"), root), null);
  assert.equal(profileForConfigDir(path.join(os.homedir(), ".claude"), root), null);
  assert.equal(profileForConfigDir(undefined, root), null);
});

test("captureStatusline writes the cache for a registered profile and nothing otherwise; never throws", () => {
  const root = tmp();
  const p = profile(root, "work");
  const text = JSON.stringify(fixture("statusline-stdin.json"));
  captureStatusline(text, { CLAUDE_CONFIG_DIR: p.configDir }, root, AT);
  const cache = readStatuslineCache(p.profileDir)!;
  assert.equal(cache.version, "2.1.316");
  assert.equal(cache.snapshot.windows.length, 2);
  // Free tier: no write. Unknown dir: no write anywhere. Garbage: no throw.
  const q = profile(root, "free");
  captureStatusline(JSON.stringify(fixture("statusline-stdin-freetier.json")), { CLAUDE_CONFIG_DIR: q.configDir }, root, AT);
  assert.equal(fs.existsSync(path.join(q.profileDir, STATUSLINE_FILE)), false);
  captureStatusline(text, { CLAUDE_CONFIG_DIR: path.join(root, "elsewhere") }, root, AT);
  captureStatusline(text, {}, root, AT);
  captureStatusline("{not json", { CLAUDE_CONFIG_DIR: p.configDir }, root, AT);
  captureStatusline("", { CLAUDE_CONFIG_DIR: p.configDir }, root, AT);
  assert.deepEqual(fs.readdirSync(path.join(root, "claude")).sort(), ["free", "work"]);
});

test("privacy: the capture path never reads transcript_path and makes no network call", () => {
  const src = fs.readFileSync([path.resolve(here, "../src/statusline.ts"), path.resolve(here, "../../src/statusline.ts")].find((p) => fs.existsSync(p))!, "utf8");
  assert.doesNotMatch(src, /transcript_path/);
  assert.doesNotMatch(src, /\bfetch\(|node:https?|node:net|from "\.\/api\.js"/);
});

test("version canary: newer than the newest fixture is flagged", () => {
  assert.equal(NEWEST_KNOWN_VERSION, "2.1.316");
  assert.equal(versionNewer("2.1.317", NEWEST_KNOWN_VERSION), true);
  assert.equal(versionNewer("2.2.0", NEWEST_KNOWN_VERSION), true);
  assert.equal(versionNewer("2.1.316", NEWEST_KNOWN_VERSION), false);
  assert.equal(versionNewer("2.1.99", NEWEST_KNOWN_VERSION), false);
  assert.equal(versionNewer("garbage", NEWEST_KNOWN_VERSION), false);
});

test("sharing never carries the statusline cache or the install marker", () => {
  for (const name of [STATUSLINE_FILE, STATUSLINE_MARKER]) {
    assert.equal(SHARED_ITEMS.includes(name), false);
    assert.equal(HISTORY_ITEM_NAMES.includes(name), false);
  }
});
