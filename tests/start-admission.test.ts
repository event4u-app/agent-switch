import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-admit-"));
const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-admit-bin-"));
const marker = path.join(bin, "ran");
process.env.AGENT_SWITCH_HOME = home;
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
const { admissionRefusal } = await import("../src/start-admission.js");
const { resolveDir, admittedLaunch } = await import("../src/commands/routing.js");
const { GUARD_REFUSED_EXIT } = await import("../src/single-load.js");
const { setActive } = await import("../src/profiles.js");

const posix = { skip: process.platform === "win32" ? "fake binary is a POSIX script" : false };

function signIn(name: string, account: string | null): void {
  const dir = path.join(home, "codex", name, "config");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "auth.json");
  if (account === null) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, JSON.stringify({ tokens: { account_id: account } }));
}

function runs(): number {
  return fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0;
}

signIn("work", "acct-a");
setActive("codex", "work");
fs.writeFileSync(path.join(bin, "codex"), `#!/bin/sh\n[ "$1" = --version ] && exit 0\necho ran >> "${marker}"\n`, { mode: 0o755 });

test("admissionRefusal: the same account at pick and start is admitted", () => {
  assert.equal(admissionRefusal("codex/work", "a@example.com", "a@example.com"), null);
  assert.equal(admissionRefusal("codex/work", null, null), null);
});

test("admissionRefusal: another account, or none, at start names both sides", () => {
  const moved = admissionRefusal("codex/work", "a@example.com", "b@example.com");
  assert.match(moved ?? "", /codex\/work/);
  assert.match(moved ?? "", /a@example\.com/);
  assert.match(moved ?? "", /b@example\.com/);
  assert.match(admissionRefusal("codex/work", "a@example.com", null) ?? "", /signed out/);
});

test("a routed start refuses when the account changes between the pick and the spawn", posix, () => {
  fs.rmSync(marker, { force: true });
  signIn("work", "acct-a");
  const pick = resolveDir("codex", true, home);
  assert.equal(pick.name, "work");
  assert.equal(pick.identity, "acct-a");
  signIn("work", "acct-b");
  assert.equal(admittedLaunch("codex", { name: "work", identity: pick.identity ?? null }, []), GUARD_REFUSED_EXIT);
  assert.equal(runs(), 0, "the binary never ran on a login nobody picked");
});

test("a routed start refuses when the account signed out between the pick and the spawn", posix, () => {
  fs.rmSync(marker, { force: true });
  signIn("work", "acct-a");
  const pick = resolveDir("codex", true, home);
  signIn("work", null);
  assert.equal(admittedLaunch("codex", { name: "work", identity: pick.identity ?? null }, []), GUARD_REFUSED_EXIT);
  assert.equal(runs(), 0);
});

test("an unchanged account starts exactly once", posix, () => {
  fs.rmSync(marker, { force: true });
  signIn("work", "acct-a");
  const pick = resolveDir("codex", true, home);
  assert.equal(admittedLaunch("codex", { name: "work", identity: pick.identity ?? null }, []), 0);
  assert.equal(runs(), 1);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(bin, { recursive: true, force: true });
});
