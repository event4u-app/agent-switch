import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { applyWait, autoContinueState, waitTargets } from "../src/protection.js";

const WIN = process.platform === "win32";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../src/index.js");

/** Four Claude profiles under a temp root: a and b share one settings.json by link, c has its own, d has none yet. */
function seedRoot(): { root: string; cfg: (n: string) => string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-wait-")));
  const cfg = (n: string) => path.join(root, "claude", n, "config");
  for (const n of ["a", "b", "c", "d"]) fs.mkdirSync(cfg(n), { recursive: true });
  const shared = path.join(root, "shared", "claude");
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, "settings.json"), JSON.stringify({ theme: "dark" }));
  fs.symlinkSync(path.join(shared, "settings.json"), path.join(cfg("a"), "settings.json"));
  fs.symlinkSync(path.join(shared, "settings.json"), path.join(cfg("b"), "settings.json"));
  fs.writeFileSync(path.join(cfg("c"), "settings.json"), JSON.stringify({ autoContinueAtUsageLimit: false }));
  fs.writeFileSync(path.join(root, ".layout-v2"), "2\n");
  return { root, cfg };
}

test("waitTargets: one target per real settings file, listing every profile it serves", { skip: WIN ? "file symlinks and read-only modes differ on win32" : false }, () => {
  const { root, cfg } = seedRoot();
  const t = waitTargets(["a", "b", "c", "d"].map((name) => ({ name, configDir: cfg(name) })));
  assert.deepEqual(
    t.map((x) => [path.relative(root, x.file), x.profiles, x.before]),
    [
      ["shared/claude/settings.json", ["a", "b"], "default"],
      ["claude/c/config/settings.json", ["c"], "off"],
      ["claude/d/config/settings.json", ["d"], "default"],
    ],
  );
});

test("applyWait: writes each target once, keeps the link, and reports a failed one", { skip: WIN ? "file symlinks and read-only modes differ on win32" : false }, () => {
  const { root, cfg } = seedRoot();
  const t = waitTargets(["a", "b", "c", "d"].map((name) => ({ name, configDir: cfg(name) })));
  fs.chmodSync(path.join(cfg("c"), "settings.json"), 0o444);
  const r = applyWait(t, "on");
  assert.deepEqual(r.map((x) => [x.profiles.join("+"), x.ok]), [["a+b", true], ["c", false], ["d", true]]);
  assert.match(r[1].error ?? "", /EACCES|permission/i);
  assert.ok(fs.lstatSync(path.join(cfg("a"), "settings.json")).isSymbolicLink(), "the shared link stays a link");
  assert.equal(autoContinueState(cfg("b")), "on");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "shared", "claude", "settings.json"), "utf8")).theme, "dark");
  assert.equal(autoContinueState(cfg("c")), "off", "the unwritable one is unchanged");
  assert.equal(autoContinueState(cfg("d")), "on");

  fs.chmodSync(path.join(cfg("c"), "settings.json"), 0o644);
  const back = applyWait(waitTargets(["a", "c"].map((name) => ({ name, configDir: cfg(name) }))), "default");
  assert.ok(back.every((x) => x.ok));
  assert.equal(autoContinueState(cfg("a")), "default");
  assert.equal(autoContinueState(cfg("c")), "default");
});

test("applyWait: a target that changed since the preview is not written", () => {
  const { root, cfg } = seedRoot();
  const t = waitTargets([{ name: "d", configDir: cfg("d") }]);
  fs.symlinkSync(path.join(root, "shared", "claude", "settings.json"), path.join(cfg("d"), "settings.json"));
  const [r] = applyWait(t, "off");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /changed since the preview/);
  assert.equal(autoContinueState(cfg("a")), "default", "the file it now points at is untouched");
});

const run = (root: string, args: string[]) => spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: root }, encoding: "utf8" });

test("CLI: protection wait on --all previews without --yes and writes nothing", () => {
  const { root, cfg } = seedRoot();
  const r = run(root, ["protection", "wait", "on", "--all"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude\/a, claude\/b/);
  assert.match(r.stdout, /--yes/);
  assert.equal(autoContinueState(cfg("a")), "default");
  assert.equal(autoContinueState(cfg("c")), "off");
});

test("CLI: protection wait off --all --yes writes every target; a partial failure exits non-zero", () => {
  const { root, cfg } = seedRoot();
  fs.chmodSync(path.join(cfg("c"), "settings.json"), 0o444);
  const r = run(root, ["protection", "wait", "on", "--all", "--yes", "--json"]);
  assert.notEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.state, "on");
  assert.equal(out.written, true);
  assert.deepEqual(out.targets.map((x: { profiles: string[]; ok: boolean }) => [x.profiles, x.ok]), [[["claude/a", "claude/b"], true], [["claude/c"], false], [["claude/d"], true]]);
  fs.chmodSync(path.join(cfg("c"), "settings.json"), 0o644);
  const ok = run(root, ["protection", "wait", "default", "--all", "--yes"]);
  assert.equal(ok.status, 0, ok.stderr);
  for (const n of ["a", "b", "c", "d"]) assert.equal(autoContinueState(cfg(n)), "default");
});

test("CLI: --all with a profile name is refused", () => {
  const { root } = seedRoot();
  const r = run(root, ["protection", "wait", "on", "claude/a", "--all"]);
  assert.notEqual(r.status, 0);
});
