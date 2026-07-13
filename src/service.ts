/**
 * Background-service control + per-OS installers.
 *
 * `service run` is the foreground loop (for debuggers and service managers);
 * `start/stop/status` manage a detached background process; `install/uninstall`
 * wire the OS's user-level autostart (launchd LaunchAgent, systemd --user unit,
 * Windows Task Scheduler logon task) and record every generated file in a
 * manifest so uninstall removes exactly what was installed.
 *
 * The per-OS file generators are pure (golden-tested). Registration is the only
 * OS-integration step.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, die } from "./profiles.js";
import { PIDFILE, readDaemonState, readPid, processAlive } from "./daemon.js";
import { runDaemon } from "./daemon.js";

const LABEL = "com.event4u.agent-switch";
const LOG = path.join(ROOT, "daemon.log");
const MANIFEST = path.join(ROOT, "service-manifest.json");
const LOG_CAP_BYTES = 1_000_000; // 1 MB, single-generation rotation

/** The command a service manager runs: this node + this index.js + `service run`. */
function runInvocation(): { exec: string; args: string[] } {
  const index = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");
  return { exec: process.execPath, args: [index, "service", "run"] };
}

// ---------- per-OS service files (pure, golden-tested) ----------

export function launchdPlist(exec: string, args: string[], log: string, label = LABEL): string {
  const argv = [exec, ...args].map((a) => `    <string>${a}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argv}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

export function systemdUnit(exec: string, args: string[]): string {
  return `[Unit]
Description=agent-switch usage daemon
After=network-online.target

[Service]
Type=simple
ExecStart=${exec} ${args.join(" ")}
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`;
}

/** Args for `schtasks /create` registering a logon-triggered task. */
export function schtasksCreateArgs(exec: string, args: string[], label = LABEL): string[] {
  const cmd = `"${exec}" ${args.map((a) => `"${a}"`).join(" ")}`;
  return ["/create", "/tn", label, "/tr", cmd, "/sc", "onlogon", "/f"];
}

// ---------- manifest ----------

function readManifest(): string[] {
  try {
    const d = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    return Array.isArray(d?.files) ? d.files : [];
  } catch {
    return [];
  }
}

function writeManifest(files: string[]): void {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({ label: LABEL, files }, null, 2) + "\n", { mode: 0o600 });
}

// ---------- install / uninstall ----------

export function serviceInstall(): void {
  const { exec, args } = runInvocation();
  fs.mkdirSync(ROOT, { recursive: true });

  if (process.platform === "darwin") {
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, launchdPlist(exec, args, LOG));
    spawnSync("launchctl", ["unload", plist], { stdio: "ignore" }); // idempotent
    const r = spawnSync("launchctl", ["load", plist], { encoding: "utf8" });
    if (r.status !== 0) die(`launchctl load failed: ${r.stderr || r.stdout}`);
    writeManifest([plist]);
    console.log(`Installed LaunchAgent ${plist} (loaded).`);
  } else if (process.platform === "linux") {
    const unit = path.join(os.homedir(), ".config", "systemd", "user", "agent-switch.service");
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, systemdUnit(exec, args));
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const r = spawnSync("systemctl", ["--user", "enable", "--now", "agent-switch.service"], { encoding: "utf8" });
    if (r.status !== 0) console.log(`(note: \`systemctl --user enable --now\` returned nonzero — unit written to ${unit}; enable manually if needed)`);
    writeManifest([unit]);
    console.log(`Installed systemd user unit ${unit}.`);
  } else if (process.platform === "win32") {
    const r = spawnSync("schtasks", schtasksCreateArgs(exec, args), { encoding: "utf8" });
    if (r.status !== 0) die(`schtasks /create failed: ${r.stderr || r.stdout}`);
    writeManifest([`schtasks:${LABEL}`]); // a task, not a file
    console.log(`Installed Task Scheduler logon task ${LABEL}.`);
  } else {
    die(`service install is not supported on ${process.platform}`);
  }
}

export function serviceUninstall(): void {
  const files = readManifest();
  if (process.platform === "darwin") {
    for (const f of files) {
      spawnSync("launchctl", ["unload", f], { stdio: "ignore" });
      fs.rmSync(f, { force: true });
    }
  } else if (process.platform === "linux") {
    spawnSync("systemctl", ["--user", "disable", "--now", "agent-switch.service"], { stdio: "ignore" });
    for (const f of files) fs.rmSync(f, { force: true });
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  } else if (process.platform === "win32") {
    spawnSync("schtasks", ["/delete", "/tn", LABEL, "/f"], { stdio: "ignore" });
  }
  fs.rmSync(MANIFEST, { force: true });
  console.log(files.length ? `Uninstalled service (removed: ${files.join(", ")}).` : "Nothing installed.");
}

// ---------- log rotation ----------

/** Single-generation rotation: when the log exceeds the cap, move it to `.1`
 *  (overwriting any previous `.1`) and start fresh. */
export function rotateLog(logFile: string = LOG, capBytes: number = LOG_CAP_BYTES): void {
  try {
    if (fs.statSync(logFile).size > capBytes) fs.renameSync(logFile, logFile + ".1");
  } catch {
    /* no log yet */
  }
}

// ---------- start / stop / status ----------

export function serviceRun(): void {
  rotateLog();
  void runDaemon();
}

export function serviceStart(): void {
  const pid = readPid();
  if (pid && processAlive(pid)) {
    console.log(`Daemon already running (pid ${pid}).`);
    return;
  }
  rotateLog();
  const { exec, args } = runInvocation();
  const out = fs.openSync(LOG, "a");
  const child = spawn(exec, args, { detached: true, stdio: ["ignore", out, out] });
  child.unref();
  console.log(`Started daemon (pid ${child.pid}). Logs: ${LOG}`);
}

export function serviceStop(): void {
  const pid = readPid();
  if (!pid || !processAlive(pid)) {
    console.log("Daemon is not running.");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (pid ${pid}).`);
  } catch (err: any) {
    die(`failed to stop daemon: ${err?.message ?? err}`);
  }
}

export function serviceStatus(): void {
  const pid = readPid();
  const running = pid !== null && processAlive(pid);
  console.log(running ? `Daemon: running (pid ${pid})` : "Daemon: not running");

  const state = readDaemonState();
  if (state) {
    console.log(`  last poll: ${state.lastPoll ?? "never"}`);
    console.log(`  poll interval: ${Math.round(state.pollIntervalMs / 1000)}s`);
    console.log(`  cached profiles: ${Object.keys(state.profiles).join(", ") || "none"}`);
    if (state.lastError) console.log(`  last error: ${state.lastError}`);
  } else {
    console.log("  (no daemon-state.json yet)");
  }

  try {
    const lines = fs.readFileSync(LOG, "utf8").trimEnd().split("\n");
    const tail = lines.slice(-5);
    if (tail.length && tail[0]) {
      console.log("  recent log:");
      for (const l of tail) console.log(`    ${l}`);
    }
  } catch {
    /* no log */
  }
}

export function cmdService(sub?: string): void {
  switch (sub) {
    case "run": return serviceRun();
    case "start": return serviceStart();
    case "stop": return serviceStop();
    case "status": return serviceStatus();
    case "install": return serviceInstall();
    case "uninstall": return serviceUninstall();
    default: die("usage: agent-switch service run|start|stop|status|install|uninstall");
  }
}
