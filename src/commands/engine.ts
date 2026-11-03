/**
 * `agent-switch engine status|restart [--json]` — is the v3 engine answering?
 * The app reads this for "Engine stopped" in the title bar and the restart
 * banner (spec §4.1, §6.6). Hosted sessions do not depend on the engine: they
 * run in tmux and are counted here so the banner can say they keep running.
 */

import { callEngine } from "../engine/client.js";
import { engineAddress } from "../protocol/messages.js";
import { die, ROOT } from "../profiles.js";
import { cmdService } from "../service.js";
import { TmuxHost } from "../host/tmux-host.js";

export interface EngineStatus {
  running: boolean;
  address: string;
  protocol?: number;
  pid?: number;
  driver?: string;
  reason?: string;
  /** Hosted sessions still running in tmux, engine or not. */
  hostedRunning: number;
}

export async function engineStatus(timeoutMs = 800): Promise<EngineStatus> {
  const address = engineAddress(ROOT);
  const hostedRunning = TmuxHost.available() ? new TmuxHost(ROOT).list().filter((s) => s.alive).length : 0;
  try {
    const [r] = await callEngine(address, [{ op: "hello" }], timeoutMs);
    if (r.ok) {
      const h = r.result as { protocol: number; pid: number; driver: string };
      return { running: true, address, protocol: h.protocol, pid: h.pid, driver: h.driver, hostedRunning };
    }
    return { running: false, address, reason: r.error.message, hostedRunning };
  } catch (err: any) {
    return { running: false, address, reason: String(err?.message ?? err), hostedRunning };
  }
}

export async function cmdEngine(sub: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const action = sub ?? "status";
  if (action === "restart") {
    // The engine runs inside the background service; restarting that restarts it.
    cmdService("stop");
    cmdService("start");
    const s = await waitForEngine(5000);
    if (flags.json) console.log(JSON.stringify(s));
    else console.log(s.running ? `Engine is back (pid ${s.pid}).` : `Engine did not come back: ${s.reason}. See agent-switch service status.`);
    if (!s.running) process.exitCode = 1;
    return;
  }
  if (action !== "status") die("usage: agent-switch engine status|restart [--json]");
  const s = await engineStatus();
  if (flags.json) {
    console.log(JSON.stringify(s));
    return;
  }
  console.log(s.running
    ? `Engine running (pid ${s.pid}, protocol ${s.protocol}, ${s.driver}).`
    : `Engine stopped: ${s.reason}.${s.hostedRunning ? ` ${s.hostedRunning} hosted session(s) keep running in tmux.` : ""} Start it with: agent-switch engine restart`);
}

async function waitForEngine(ms: number): Promise<EngineStatus> {
  const end = Date.now() + ms;
  let s = await engineStatus();
  while (!s.running && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    s = await engineStatus();
  }
  return s;
}
