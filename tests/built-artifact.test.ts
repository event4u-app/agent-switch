import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

// The same behaviour as the src tests, run against the SHIPPED build (dist/), in
// process: what users install is what is checked here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../../dist");
const FIX = path.resolve(HERE, "../../tests/fixtures");
const built = fs.existsSync(path.join(DIST, "index.js"));
const gate = { skip: built ? false : "run `npm run build` first (dist/index.js missing)" };
const WIN = process.platform === "win32";

// profiles.js reads AGENT_SWITCH_HOME once at load: set it before any dist import.
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-built-")));
process.env.AGENT_SWITCH_HOME = ROOT;
fs.writeFileSync(path.join(ROOT, ".layout-v2"), "2\n");

const load = async (rel: string): Promise<any> => (built ? import(pathToFileURL(path.join(DIST, rel)).href) : {});
const SL = await load("statusline.js");
const SLCMD = await load("commands/statusline.js");
const PS = await load("program-status.js");
const RS = await load("runtime-state.js");
const U = await load("usage.js");
const PROT = await load("protection.js");
const UCMD = await load("commands/usage.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-built-t-"));
const fixture = (n: string) => fs.readFileSync(path.join(FIX, n));
const CMD = "/opt/bin/agent-switch __statusline";

function capture<T>(fn: () => T): { out: string; code: number | undefined; value: T } {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    const value = fn();
    return { out: lines.join("\n"), code: process.exitCode as number | undefined, value };
  } finally {
    console.log = log;
    process.exitCode = before;
  }
}

function claudeProfile(name: string, settings?: unknown): string {
  const cfg = path.join(ROOT, "claude", name, "config");
  fs.mkdirSync(cfg, { recursive: true });
  if (settings !== undefined) fs.writeFileSync(path.join(cfg, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings));
  return cfg;
}

test("dist/usage.js parses the captured statusLine payload; the free tier gives null", gate, () => {
  const s = U.parseStatuslineUsage(JSON.parse(fixture("statusline-stdin.json").toString()), "2026-11-23T12:00:00.000Z");
  assert.deepEqual(s.windows.map((w: any) => [w.key, w.utilization, w.resetsAt]), [
    ["five_hour", 7, new Date(1795414200 * 1000).toISOString()],
    ["seven_day", 3, new Date(1795806000 * 1000).toISOString()],
  ]);
  assert.equal(U.parseStatuslineUsage(JSON.parse(fixture("statusline-stdin-freetier.json").toString())), null);
});

test("dist/statusline.js monotone merge keeps the retained reading's own time", gate, () => {
  const R = "2026-11-23T15:00:00.000Z";
  const snap = (u: number, at: string, weekly = true) => ({
    windows: [{ key: "five_hour", label: "5h", utilization: u, resetsAt: R }, ...(weekly ? [{ key: "seven_day", label: "7d", utilization: 10, resetsAt: "2026-11-28T00:00:00.000Z" }] : [])],
    routines: null,
    capturedAt: at,
  });
  const m = SL.mergeMonotone(snap(60, "2026-11-23T12:00:00.000Z"), snap(40, "2026-11-23T12:01:00.000Z", false));
  assert.deepEqual(m.windows.map((w: any) => [w.key, w.utilization, w.capturedAt]), [
    ["five_hour", 60, "2026-11-23T12:00:00.000Z"],
    ["seven_day", 10, "2026-11-23T12:00:00.000Z"],
  ]);
  assert.equal(m.capturedAt, "2026-11-23T12:00:00.000Z");
});

test("dist/statusline.js install, remove, refusal, and the strict unreadable-file refusal", gate, () => {
  const dir = tmp();
  const cfg = path.join(dir, "config");
  fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ model: "opus" }));
  assert.equal(SL.installStatusline(cfg, dir, CMD).changed, true);
  assert.equal(SL.statuslineHealth(cfg, dir), "present");
  assert.equal(SL.uninstallStatusline(cfg, dir).changed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8")), { model: "opus" });

  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "/usr/local/bin/other __statusline" } }));
  assert.equal(SL.installStatusline(cfg, dir, CMD).reason, "has-own");

  const broken = '{"theme": "dark", "hooks": {';
  fs.writeFileSync(path.join(cfg, "settings.json"), broken);
  assert.throws(() => SL.installStatusline(cfg, dir, CMD), /nothing was written/);
  assert.equal(fs.readFileSync(path.join(cfg, "settings.json"), "utf8"), broken);
});

test("dist/commands/statusline.js on → status → off in a temp home, own bar left alone", gate, () => {
  const work = claudeProfile("work", { model: "opus" });
  claudeProfile("own", { statusLine: { type: "command", command: "my-bar" } });
  const on = capture(() => SLCMD.cmdStatuslineCli("on"));
  assert.match(on.out, /claude\/own: left alone/);
  assert.match(on.out, /claude\/work: on/);
  assert.match(JSON.parse(fs.readFileSync(path.join(work, "settings.json"), "utf8")).statusLine.command, / __statusline$/);
  assert.match(capture(() => SLCMD.cmdStatuslineCli("status", "work")).out, /claude\/work: on · no sample yet/);
  assert.match(capture(() => SLCMD.cmdStatuslineCli("off", "work")).out, /claude\/work: off/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, "settings.json"), "utf8")), { model: "opus" });
  assert.match(capture(() => SLCMD.cmdStatuslineCli("status", "work")).out, /claude\/work: off/);
});

test("dist/usage.js: a fresh sample merges onto the poll's per-model window without a request", gate, async () => {
  const now = Date.now();
  const at = (ago: number) => new Date(now - ago).toISOString();
  const w = (key: string, u: number) => ({ key, label: key, utilization: u, resetsAt: new Date(now + 3_600_000).toISOString() });
  const sl = { windows: [w("five_hour", 20), w("seven_day", 10)], routines: null, capturedAt: at(30_000), source: "statusline" };
  const base = { windows: [w("five_hour", 5), w("seven_day_opus", 95)], routines: null, capturedAt: at(60_000) };
  let calls = 0;
  const poll = async () => (calls++, null);
  const fresh = (s: any) => !!s && now - Date.parse(s.capturedAt) < 300_000;
  const r = await U.resolveClaudeUsage({ statusline: sl, base, now, fresh, pollOnlyMaxAgeMs: 300_000, poll });
  assert.equal(calls, 0);
  assert.deepEqual(r.snapshot.windows.map((x: any) => [x.key, x.utilization, x.source]), [["five_hour", 20, "statusline"], ["seven_day_opus", 95, "poll"], ["seven_day", 10, "statusline"]]);
  const failed = await U.resolveClaudeUsage({ statusline: sl, base: { ...base, capturedAt: at(600_000) }, now, fresh, pollOnlyMaxAgeMs: 300_000, poll });
  assert.equal(calls, 1);
  assert.equal(failed.pollFailed, true);
  assert.equal(failed.snapshot.windows.find((x: any) => x.key === "five_hour").utilization, 20);
  assert.equal(U.mergeUsage(null, base), base);
});

test("dist/program-status.js scans the recorded Codex stream, ignores other apps, matches hosted rows", gate, async () => {
  const file = path.join(tmp(), "s.json");
  const bytes = fixture("codex-osc-7501-stream.bin");
  let t = 1000;
  await PS.runProgramStatus(file, Readable.from([bytes.subarray(0, 37), bytes.subarray(37)]), () => t++);
  assert.equal(PS.readProgramStatus(file).state, "done");
  const other = path.join(tmp(), "o.json");
  await PS.runProgramStatus(other, Readable.from([Buffer.from("\x1b]7501;state=working:app=evil\x07")]), () => 1);
  assert.equal(PS.readProgramStatus(other), null);

  const start = Date.parse("2026-11-23T10:00:00Z");
  const before = { sessionId: "standalone", profile: "work", cwd: "/w", birthtimeMs: start - 2_000 };
  const after = { sessionId: "hosted-own", profile: "work", cwd: "/w", birthtimeMs: start + 3_000 };
  const h = [{ sessionId: "h1", account: "work", cwd: "/w", startedAt: new Date(start).toISOString() }];
  for (const rows of [[before, after], [after, before]]) assert.deepEqual([...PS.matchHostedRows(rows, h).keys()].map((r: any) => r.sessionId), ["hosted-own"]);
});

test("dist/runtime-state.js reads every recorded registry step as expected", gate, () => {
  const NOW = 1_795_396_500_000;
  const { steps } = JSON.parse(fixture("registry-status-2.1.316.json").toString());
  assert.ok(steps.length >= 10);
  for (const s of steps) {
    const r = RS.runtimeState({ live: true, hostStatus: s.status, hostStatusAt: NOW - s.statusAgeS * 1000, mtimeMs: NOW - s.transcriptAgeS * 1000 }, NOW);
    assert.equal(r?.state, s.expect, s.situation);
    assert.equal(r?.source, "host", s.situation);
  }
});

test("dist/protection.js + dist/commands/usage.js: wait --all previews, then writes each settings file once", { skip: gate.skip || (WIN ? "file symlinks and read-only modes differ on win32" : false) }, () => {
  const shared = path.join(ROOT, "shared-wait", "settings.json");
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  fs.writeFileSync(shared, JSON.stringify({ theme: "dark" }));
  for (const n of ["wa", "wb"]) fs.symlinkSync(shared, path.join(claudeProfile(n), "settings.json"));
  const names = fs.readdirSync(path.join(ROOT, "claude"));
  const targets = PROT.waitTargets(names.map((name) => ({ name, configDir: path.join(ROOT, "claude", name, "config") })));
  assert.deepEqual(targets.find((t: any) => t.file === fs.realpathSync(shared))?.profiles, ["wa", "wb"]);

  const preview = capture(() => UCMD.cmdProtection("wait", ["on"], { all: true }));
  assert.match(preview.out, /Nothing written/);
  assert.equal(PROT.autoContinueState(path.join(ROOT, "claude", "wa", "config")), "default");
  const done = capture(() => UCMD.cmdProtection("wait", ["on"], { all: true, yes: true }));
  assert.equal(done.code, undefined, done.out);
  assert.equal(PROT.autoContinueState(path.join(ROOT, "claude", "wb", "config")), "on");
  assert.ok(fs.lstatSync(path.join(ROOT, "claude", "wa", "config", "settings.json")).isSymbolicLink());
  assert.equal(JSON.parse(fs.readFileSync(shared, "utf8")).theme, "dark");
  const back = PROT.applyWait(PROT.waitTargets([{ name: "wa", configDir: path.join(ROOT, "claude", "wa", "config") }]), "default");
  assert.ok(back.every((r: any) => r.ok));
});

// The shipped host, driven through a stand-in for tmux that records every argv
// (CI's macOS runners have no tmux; the stand-in runs wherever /bin/sh does).
const HOST = await load("host/tmux-host.js");
const shGate = { skip: !built ? gate.skip : WIN ? "the tmux stand-in is a shell script" : false };

function recordingTmux(dir: string): { bin: string; calls: () => string[][] } {
  const log = path.join(dir, "tmux-calls.jsonl");
  const bin = path.join(dir, "fake-tmux");
  fs.writeFileSync(bin, `#!/bin/sh\nnode -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)) + "\\n")' "${log}" "$@"\necho @7\n`, { mode: 0o755 });
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []) };
}

test("built host: Claude and Codex windows start, respawn, park and end with the right tmux calls", shGate, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-built-host-"));
  const t = recordingTmux(root);
  const host = new HOST.TmuxHost(root, { socket: "rec", tmux: t.bin });
  try {
    const cl = host.start({ provider: "claude", account: "work", configDir: "/cfg/work", cwd: root, bin: "claude" }, "h");
    assert.equal(cl.key, `claude/work/${cl.sessionId}`);
    assert.equal(t.calls().filter((a) => a.includes("pipe-pane")).length, 0, "no pipe for Claude");
    const cx = host.start({ provider: "codex", account: "work", configDir: "/cfg/cx", cwd: root, bin: "codex" }, "'/n' '/as.js'");
    const pipe = t.calls().find((a) => a.includes("pipe-pane"))!;
    assert.deepEqual(pipe.slice(pipe.indexOf("pipe-pane"), pipe.indexOf("pipe-pane") + 2), ["pipe-pane", "-O"]);
    assert.equal(pipe[pipe.length - 1], `'/n' '/as.js' __program-status '${PS.programStatusFile(root, cx.sessionId)}'`);
    const moved = host.respawn(cl.key, { provider: "claude", account: "side", configDir: "/cfg/side", cwd: root, bin: "claude", args: ["--resume", cl.sessionId] }, "h");
    assert.equal(moved.key, `claude/side/${cl.sessionId}`);
    assert.ok(t.calls().some((a) => a.includes("respawn-pane") || a.includes("respawn-window")), "respawned in place");
    const before = t.calls().length;
    host.park(cx.key, ["codex", "resume"]);
    assert.ok(t.calls().length > before, "park talks to tmux");
    assert.throws(() => host.start({ provider: "x;y", account: "work", configDir: "/cfg", cwd: root, bin: "claude" }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The shipped `sessions`: a live registry word becomes `runtime`; the text listing shows it.
const SESS = await load("commands/sessions.js");

test("built sessions: the host's word becomes runtime, and the listing shows it", gate, async () => {
  const cfg = claudeProfile("rt");
  const dir = path.join(cfg, "projects", "-proj-rt");
  fs.mkdirSync(dir, { recursive: true });
  const old = Date.now() - 5 * 60_000;
  for (const id of ["root-rt", "seat-rt"]) {
    const file = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ cwd: "/proj/rt", summary: id })}\n`);
    fs.utimesSync(file, new Date(old), new Date(old));
  }
  fs.mkdirSync(path.join(cfg, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(cfg, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: "root-rt", status: "busy", statusUpdatedAt: old }));
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await SESS.cmdSessions("claude", true, "rt", { json: true });
  } finally {
    console.log = log;
  }
  const rows = JSON.parse(lines.join("\n")) as { sessionId: string; live: boolean; hostStatus?: string; hostStatusAt?: number; runtime?: { state: string; source: string } }[];
  const root = rows.find((r) => r.sessionId === "root-rt")!;
  assert.equal(root.live, true);
  assert.equal(root.hostStatusAt, old);
  assert.deepEqual([root.runtime?.state, root.runtime?.source], ["working", "host"], "busy holds although the transcript is quiet");
  const seat = rows.find((r) => r.sessionId === "seat-rt")!;
  assert.equal(seat.runtime, undefined, "not live, no runtime");
  const text: string[] = [];
  console.log = (...a: unknown[]) => void text.push(a.join(" "));
  try {
    await SESS.cmdSessions("claude", true, "rt", {});
  } finally {
    console.log = log;
  }
  assert.match(text.join("\n"), /root-rt.*\[live: busy\]/);
});

const RN = await load("release-notes.js");
const CC = await load("cc-contract.js");
const CT = await load("config-transfer.js");
const AV = await load("app-visibility.js");

test("dist/release-notes.js turns the captured 14.2.0 body into blocks, a highlight and clamped text", gate, () => {
  const md = fixture("agent-config-release-14.2.0.md").toString("utf8");
  assert.equal(RN.stripHtmlComments("a <!-- x\ny\n--> b"), "a  b");
  assert.equal(RN.normalizeInline("see [the docs](https://example.com/x) **b** _i_"), "see the docs b i");
  const blocks = RN.releaseNoteBlocks(md);
  assert.ok(blocks.length > 3);
  assert.ok(blocks.every((b: { text: string }) => !b.text.includes("<!--")));
  const hi = RN.firstHighlight(blocks);
  assert.equal(typeof hi, "string");
  assert.ok(hi.length > 0 && !/\]\(https?:/.test(hi));
  const all = RN.releaseNotesText(blocks);
  assert.equal(all.omitted, 0);
  assert.ok(all.lines.length >= blocks.length);
  const capped = RN.releaseNotesText(blocks, { maxLines: 3, bullet: "-", indent: "  " });
  assert.equal(capped.lines.length, 3);
  assert.equal(capped.omitted, all.lines.length - 3);
  assert.ok(capped.lines.every((l: string) => l === "" || l.startsWith("  ")));
  assert.equal(RN.clampText("abc", 10), "abc");
  assert.equal(RN.clampText("one two three four five", 12), "one two…");
  assert.equal(RN.clampText("x".repeat(50), 10), `${"x".repeat(10)}…`);
  assert.equal(RN.firstHighlight([]), null);
});

function ccBundle(drop: string | null = null): string {
  const parts: Record<string, string> = {
    version: "// Version: 9.9.9\n",
    naming:
      `var Qx="-credentials";function Kk(e=""){let n=process.env.CLAUDE_CONFIG_DIR,r=(n??"").normalize("NFC"),` +
      `a=n?"-"+h("sha256").update(r).digest("hex").substring(0,8):"";return\`Claude Code\${Z().S}\${e}\${a}\`}\n`,
    legacy:
      `async function Ll(e){return\`\${await Rp(e).catch(()=>e)}.lock\`}` +
      `if(P.code==="ELOCKED")throw q("tengu_oauth_refresh_legacy_lock_contended",{}),P;\n`,
    timing: `function Op(e,n){return{lockfilePath:J(e,".oauth_refresh.lock"),realpath:!1,stale:60000,update:5000}}\n`,
    cache:
      `var w9=30000;class C{cache={data:null,cachedAt:0}}` +
      `read(){let r=g().cache;if(Date.now()-r.cachedAt<w9)return r.data;` +
      `let s=x(\`security find-generic-password -a "\${n}" -w -s "\${o}"\`)}\n`,
  };
  if (drop) parts[drop] = "";
  return Object.values(parts).join("");
}
const ccFailed = (v: { findings: { ok: boolean; fact: string }[] }) => v.findings.filter((f) => !f.ok).map((f) => f.fact);

test("dist/cc-contract.js passes the pinned facts, fails each drift, and caches the binary verdict", gate, () => {
  assert.deepEqual(ccFailed(CC.analyzeCCContract(ccBundle(), "9.9.9")), []);
  assert.deepEqual(ccFailed(CC.analyzeCCContract(ccBundle(), "9.9.10")), ["version"]);
  for (const part of ["naming", "legacy", "timing", "cache"]) {
    assert.ok(ccFailed(CC.analyzeCCContract(ccBundle(part), "9.9.9")).length > 0, part);
  }
  const dir = tmp();
  const bin = path.join(dir, "claude");
  const cacheFile = path.join(dir, "cache.json");
  fs.writeFileSync(bin, ccBundle());
  let reads = 0;
  const readBinary = (p: string) => (reads++, fs.readFileSync(p));
  assert.equal(CC.verifyCCBinary("9.9.9", { binaryPath: bin, cacheFile, readBinary }).ok, true);
  assert.equal(CC.verifyCCBinary("9.9.9", { binaryPath: bin, cacheFile, readBinary }).ok, true);
  assert.equal(reads, 1);
  fs.writeFileSync(bin, ccBundle("legacy"));
  assert.equal(CC.verifyCCBinary("9.9.9", { binaryPath: bin, cacheFile, readBinary }).ok, false);
  assert.deepEqual(ccFailed(CC.verifyCCBinary("9.9.9", { binaryPath: null, cacheFile })), ["binary"]);
  assert.equal(CC.verifyCCBinary("9.9.9", { binaryPath: path.join(dir, "missing"), cacheFile: path.join(dir, "c2.json") }).ok, false);
});

test("dist/config-transfer.js round-trips the allowlist and never carries the account deny-set", gate, () => {
  const src = path.join(tmp(), "config");
  const allow: Record<string, string> = { "settings.json": '{"theme":"dark"}', "CLAUDE.md": "# hi\n", "skills/foo.md": "s\n" };
  for (const [rel, body] of Object.entries(allow)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), body);
  }
  fs.writeFileSync(path.join(src, ".credentials.json"), '{"claudeAiOauth":{"accessToken":"secret-token"}}');
  fs.mkdirSync(path.join(src, "sessions"));
  fs.writeFileSync(path.join(src, "sessions", "s1.jsonl"), "{}");
  const bundle = CT.exportConfig(src);
  assert.ok(!bundle.includes("secret-token") && !bundle.includes("s1.jsonl"));
  const dest = path.join(tmp(), "config");
  const written = CT.importConfig(dest, bundle);
  assert.deepEqual([...written].sort(), Object.keys(allow).sort());
  for (const [rel, body] of Object.entries(allow)) assert.equal(fs.readFileSync(path.join(dest, rel), "utf8"), body);
  assert.throws(() => CT.assertNotFull(true));
  assert.doesNotThrow(() => CT.assertNotFull(false));
  assert.throws(() => CT.importConfig(dest, "not json"));
});

test("dist/app-visibility.js: only a recent 'hidden' report pauses", gate, () => {
  const f = AV.visibilityFile(tmp());
  const t = new Date("2026-11-02T10:00:00Z");
  assert.equal(AV.appHidden(f, t.getTime()), false);
  AV.writeVisibility(f, false, t);
  assert.equal(AV.appHidden(f, t.getTime() + 60_000), true);
  assert.equal(AV.appHidden(f, t.getTime() + AV.VISIBILITY_TTL_MS + 1), false);
});
