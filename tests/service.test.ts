import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-svc-"));
const S = await import("../src/service.js");

const EXEC = "/usr/bin/node";
const ARGS = ["/opt/agent-switch/dist/index.js", "service", "run"];

test("launchd plist carries the program args, RunAtLoad, and log paths", () => {
  const plist = S.launchdPlist(EXEC, ARGS, "/tmp/x.log", "com.example.test");
  assert.match(plist, /<key>Label<\/key><string>com\.example\.test<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.ok(plist.includes(`<string>${EXEC}</string>`));
  assert.ok(plist.includes("<string>service</string>") && plist.includes("<string>run</string>"));
  assert.ok(plist.includes("<string>/tmp/x.log</string>"));
});

test("systemd unit runs the exec+args, restarts on failure, installs to default.target", () => {
  const unit = S.systemdUnit(EXEC, ARGS);
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/agent-switch\/dist\/index\.js service run/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
});

test("schtasks create args register a logon-triggered task with the quoted command", () => {
  const args = S.schtasksCreateArgs(EXEC, ARGS, "TestTask");
  assert.deepEqual(args.slice(0, 4), ["/create", "/tn", "TestTask", "/tr"]);
  assert.ok(args.includes("/onlogon".replace("/", "")) || args.includes("onlogon"));
  const tr = args[args.indexOf("/tr") + 1];
  assert.ok(tr.includes(`"${EXEC}"`) && tr.includes("service") && tr.includes("run"));
});

test("rotateLog moves an oversized log to .1 and leaves a small one alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-log-"));
  const log = path.join(dir, "daemon.log");

  fs.writeFileSync(log, "x".repeat(50));
  S.rotateLog(log, 1000); // under cap → untouched
  assert.equal(fs.existsSync(log), true);
  assert.equal(fs.existsSync(log + ".1"), false);

  fs.writeFileSync(log, "x".repeat(2000));
  S.rotateLog(log, 1000); // over cap → rotated
  assert.equal(fs.existsSync(log + ".1"), true);
  assert.equal(fs.existsSync(log), false);
});
