/**
 * `agent-switch engine status|restart [--json]` — is the v3 engine answering?
 * The app reads this for "Engine stopped" in the title bar and the restart
 * banner (spec §4.1, §6.6). Hosted sessions do not depend on the engine: they
 * run in tmux and are counted here so the banner can say they keep running.
 */

import { callEngine } from "../engine/client.js";
import { engineAddress } from "../protocol/messages.js";
import { die, ROOT } from "../profiles.js";
import { serviceCli, serviceInstall, serviceRestart, serviceTarget } from "../service.js";
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
  /** Whose CLI the background service runs; the engine lives inside it. */
  service: ServiceOwner;
}

export type ServiceOwner = ReturnType<typeof serviceTarget>;

/** Why the engine does not answer. A service of another install (an older
 *  version, a dev checkout) is the cause a restart cannot fix, so it is named
 *  before the socket error. Pure. */
export function downReason(service: ServiceOwner, socketError: string, otherCli: string | null): string {
  if (service === "other-cli") return `the background service runs another Agent Switch${otherCli ? ` (${otherCli})` : ""}; restarting it does not start this engine`;
  return socketError;
}

export async function engineStatus(timeoutMs = 800): Promise<EngineStatus> {
  const address = engineAddress(ROOT);
  const service = serviceTarget();
  const hostedRunning = TmuxHost.available() ? new TmuxHost(ROOT).list().filter((s) => s.alive).length : 0;
  try {
    const [r] = await callEngine(address, [{ op: "hello" }], timeoutMs);
    if (r.ok) {
      const h = r.result as { protocol: number; pid: number; driver: string };
      return { running: true, address, protocol: h.protocol, pid: h.pid, driver: h.driver, hostedRunning, service };
    }
    return { running: false, address, reason: downReason(service, r.error.message, serviceCli()), hostedRunning, service };
  } catch (err: any) {
    return { running: false, address, reason: downReason(service, String(err?.message ?? err), serviceCli()), hostedRunning, service };
  }
}

export async function cmdEngine(sub: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const action = sub ?? "status";
  if (action === "restart") {
    // The engine runs inside the background service; restarting that restarts it.
    // A service of another install has no engine for this CLI: asked to restart,
    // it is moved onto this one (a deliberate act, like `activate`).
    const moved = serviceTarget() === "other-cli";
    if (moved) serviceInstall(() => {});
    else serviceRestart();
    const s = await waitForEngine(5000);
    if (flags.json) console.log(JSON.stringify({ ...s, moved }));
    else {
      if (moved) console.log("The background service now runs this Agent Switch.");
      console.log(s.running ? `Engine is back (pid ${s.pid}).` : `Engine did not come back: ${s.reason}. See agent-switch service status.`);
    }
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
    : `Engine stopped: ${s.reason}.${s.hostedRunning ? ` ${s.hostedRunning} hosted session(s) keep running in tmux.` : ""} ${s.service === "other-cli" ? "Move the service here with" : "Start it with"}: agent-switch engine restart`);
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
