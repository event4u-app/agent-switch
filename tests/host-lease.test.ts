import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { InputLeases, LeaseHeld, NotHolder, LEASE_TTL_MS } from "../src/host/lease.js";
import { TmuxHost } from "../src/host/tmux-host.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-lease-"));
const app = { id: "app-1", pid: process.pid, kind: "app" };
const cli = { id: "cli-1", pid: process.pid, kind: "cli" };
const KEY = "claude/work/s1";

test("one writer: the second viewer is refused while the first holds and renews", () => {
  let now = 1_000_000;
  const leases = new InputLeases(tmp(), () => now);
  assert.equal(leases.acquire(KEY, app).holder.id, "app-1");
  assert.throws(() => leases.acquire(KEY, cli), LeaseHeld);
  now += LEASE_TTL_MS - 1;
  leases.acquire(KEY, app); // renew
  now += LEASE_TTL_MS - 1;
  assert.throws(() => leases.acquire(KEY, cli), LeaseHeld, "renewed in time: still held");
  assert.equal(leases.acquire("claude/work/other", cli).holder.id, "cli-1", "another session has its own lease");
});

test("stale-lease recovery: a holder that stopped renewing, or whose process died, loses it", () => {
  let now = 1_000_000;
  const dead = new Set<number>();
  const leases = new InputLeases(tmp(), () => now, (pid) => !dead.has(pid));
  leases.acquire(KEY, app);
  now += LEASE_TTL_MS + 1;
  assert.equal(leases.acquire(KEY, cli).holder.id, "cli-1", "silent holder: recovered");

  const ghost = { id: "app-2", pid: 999_999, kind: "app" };
  leases.handover(KEY, cli, ghost);
  dead.add(999_999);
  assert.equal(leases.acquire(KEY, app).holder.id, "app-1", "dead holder: recovered at once");
});

test("handover is explicit and only the holder can give the lease away", () => {
  const leases = new InputLeases(tmp());
  leases.acquire(KEY, app);
  assert.throws(() => leases.handover(KEY, cli, cli), NotHolder);
  assert.equal(leases.handover(KEY, app, cli).holder.id, "cli-1");
  assert.throws(() => leases.acquire(KEY, app), LeaseHeld, "the old holder is a viewer now");
  assert.equal(leases.release(KEY, app), false);
  assert.equal(leases.release(KEY, cli), true);
  assert.equal(leases.read(KEY), null);
});

test("racing processes: exactly one of 12 gets the lease", async () => {
  const root = tmp();
  const mod = new URL("../src/host/lease.js", import.meta.url).href;
  const go = path.join(root, "go");
  // Every child waits at a barrier, so all twelve reach acquire() together.
  const script = `const { InputLeases } = await import(${JSON.stringify(mod)});
const fs = await import("node:fs");
const l = new InputLeases(process.argv[1]);
while (!fs.existsSync(${JSON.stringify(go)})) {}
try { l.acquire("claude/work/s1", { id: "p" + process.argv[2], pid: process.pid, kind: "cli" }); console.log("won"); } catch { console.log("lost"); }
setTimeout(() => {}, 300); // stay alive, so the lease is not stale while others try`;
  const pending = Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      new Promise<string>((resolve, reject) => {
        let out = "";
        const c = spawn(process.execPath, ["--input-type=module", "-e", script, root, String(i)], { stdio: ["ignore", "pipe", "inherit"] });
        c.stdout.on("data", (d) => (out += d));
        c.on("error", reject);
        c.on("exit", () => resolve(out.trim()));
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 1500)); // let every child reach the barrier
  fs.writeFileSync(go, "");
  const results = await pending;
  assert.equal(results.filter((r) => r === "won").length, 1, results.join(","));
});

test("typing reaches the hosted window only for the holder, literally", { skip: TmuxHost.available() ? false : "tmux is not installed here" }, () => {
  const root = tmp();
  const bin = path.join(root, "echoer");
  fs.writeFileSync(bin, '#!/bin/sh\nwhile printf "> "; IFS= read -r l; do echo "got: $l"; done\n', { mode: 0o755 });
  const host = new TmuxHost(root, { socket: `as-test-lease-${process.pid}` });
  try {
    const s = host.start({ provider: "codex", account: "work", configDir: "/cfg", cwd: root, bin });
    // The program draws its input line before anything is typed into it.
    for (let i = 0; i < 40 && !(host.capture(s.key) ?? "").includes(">"); i++) spawnSync("sleep", ["0.05"]);
    const leases = new InputLeases(root);
    leases.acquire(s.key, app);
    assert.throws(() => leases.type(host, s.key, cli, "nope", { enter: true }), NotHolder);
    leases.type(host, s.key, app, "Enter C-c $(echo hi)", { enter: true });
    let screen = "";
    for (let i = 0; i < 40 && !screen.includes("got:"); i++) {
      spawnSync("sleep", ["0.05"]);
      screen = host.capture(s.key) ?? "";
    }
    assert.match(screen, /got: Enter C-c \$\(echo hi\)/, "key names and shell syntax arrive as text");
    assert.doesNotMatch(screen, /got: nope/);
  } finally {
    host.killServer();
  }
});

/** A host whose window shows an empty prompt and whose view clients report `activity()` (epoch seconds). */
function typingHost(activity: () => number[]) {
  const sent: string[][] = [];
  const host = {
    windowOf: () => "@1",
    run: (args: string[]) => {
      if (args[0] === "list-clients") return { ok: true, out: activity().map((a) => `${a} @1`).concat(["99999999999 @2"]).join("\n"), err: "" };
      if (args[0] === "capture-pane") return { ok: true, out: "> \n", err: "" };
      sent.push(args);
      return { ok: true, out: "", err: "" };
    },
  } as unknown as TmuxHost;
  return { host, sent };
}

test("G3: an automated send waits while a person types in an attached view, then sends", () => {
  let t = 1_000_000_000_000;
  const root = tmp();
  const leases = new InputLeases(root, () => t, () => true, (ms) => void (t += ms));
  leases.acquire("k", app);
  const typedAt = t / 1000 - 1; // a key a second ago; quiet from 2 s on (activity is in whole seconds)
  const { host, sent } = typingHost(() => [typedAt]);
  const before = t;
  leases.type(host, "k", app, "go on", { enter: true });
  assert.ok(t - before >= 2000, "it waited for the person");
  assert.deepEqual(sent, [["send-keys", "-t", "@1", "-l", "go on"], ["send-keys", "-t", "@1", "Enter"]]);
});

test("G3: never quiet within 60 s gives up and types nothing; another window's client never counts", () => {
  let t = 1_000_000_000_000;
  const leases = new InputLeases(tmp(), () => t, () => true, (ms) => void (t += ms));
  leases.acquire("k", app);
  const { host, sent } = typingHost(() => [Math.floor(t / 1000)]);
  assert.throws(() => leases.type(host, "k", app, "go on", { enter: true }), /someone is typing in it/);
  assert.deepEqual(sent, []);
  // Only window @2's client is busy: no wait at all. (The long wait above outlived the lease: take it again.)
  leases.acquire("k2", app);
  const other = typingHost(() => []);
  const start = t;
  leases.type(other.host, "k2", app, "hi", { enter: true });
  assert.equal(t, start);
  assert.equal(other.sent.length, 2);
});

test("G3: a key typed between the text and Enter: no Enter, and only what was typed is taken back", () => {
  let t = 1_000_000_000_000;
  const leases = new InputLeases(tmp(), () => t, () => true, (ms) => void (t += ms));
  leases.acquire("k", app);
  let calls = 0;
  // Quiet when it looks first; a person types right after the text went in.
  const { host, sent } = typingHost(() => (calls++ === 0 ? [] : [Math.floor(t / 1000)]));
  assert.throws(() => leases.type(host, "k", app, "go ön", { enter: true }), /someone typed in it while/);
  assert.deepEqual(sent, [["send-keys", "-t", "@1", "-l", "go ön"], ["send-keys", "-t", "@1", "-N", "5", "BSpace"]]);
});
