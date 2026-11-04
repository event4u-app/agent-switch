import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { InputLeases } from "../src/host/lease.js";
import { TmuxHost } from "../src/host/tmux-host.js";
import { CONTINUE_TEXT, typeIntoHosted } from "../src/commands/continue.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-continue-"));
const me = { id: "cli-9", pid: process.pid, kind: "cli" };

test("typeIntoHosted refuses a session Agent Switch does not host, and one someone else types into", { skip: TmuxHost.available() ? false : "tmux is not installed here" }, () => {
  const root = tmp();
  const bin = path.join(root, "echoer");
  fs.writeFileSync(bin, '#!/bin/sh\nwhile IFS= read -r l; do echo "got: $l"; done\n', { mode: 0o755 });
  const host = new TmuxHost(root, { socket: `as-test-continue-${process.pid}` });
  try {
    const leases = new InputLeases(root);
    assert.throws(() => typeIntoHosted(host, leases, "claude/work/not-hosted", me, CONTINUE_TEXT), /not hosted by Agent Switch/);
    const s = host.start({ provider: "claude", account: "work", configDir: "/cfg", cwd: root, bin });
    const other = { id: "app-1", pid: process.pid, kind: "app" };
    leases.acquire(s.key, other);
    assert.throws(() => typeIntoHosted(host, leases, s.key, me, CONTINUE_TEXT), /being typed into by app/);
    leases.release(s.key, other);
    typeIntoHosted(host, leases, s.key, me, CONTINUE_TEXT);
    let screen = "";
    for (let i = 0; i < 40 && !screen.includes("got:"); i++) {
      spawnSync("sleep", ["0.05"]);
      screen = host.capture(s.key) ?? "";
    }
    assert.ok(screen.includes(`got: ${CONTINUE_TEXT}`), screen);
    assert.equal(leases.acquire(s.key, other).holder.id, "app-1", "the lease is released afterwards");
  } finally {
    host.killServer();
  }
});
