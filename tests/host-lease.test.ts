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
  fs.writeFileSync(bin, '#!/bin/sh\nwhile IFS= read -r l; do echo "got: $l"; done\n', { mode: 0o755 });
  const host = new TmuxHost(root, { socket: `as-test-lease-${process.pid}` });
  try {
    const s = host.start({ provider: "codex", account: "work", configDir: "/cfg", cwd: root, bin });
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
