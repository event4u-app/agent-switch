/**
 * `agent-switch continue <session-key> [--text "…"]` — type one message into a
 * session Agent Switch hosts, so it carries on by itself after its account was
 * switched at a limit (rebind keeps the conversation; Claude adopts the new
 * login with its next message). Through the input lease, so it is refused while
 * someone else types there; never into a terminal Agent Switch does not host.
 */

import { ROOT, die } from "../profiles.js";
import { InputLeases, LeaseHeld, type Holder } from "../host/lease.js";
import { TmuxHost } from "../host/tmux-host.js";

/** What a session is told after its account was switched. */
export const CONTINUE_TEXT = "Continue where you left off.";

/** Type `text` + Enter into a hosted session as `holder`, taking and releasing
 *  the input lease. Throws a sentence a person can act on. */
export function typeIntoHosted(host: TmuxHost, leases: InputLeases, key: string, holder: Holder, text: string): void {
  if (!host.windowOf(key)) throw new Error(`${key} is not hosted by Agent Switch — type one message in its own terminal to continue it`);
  try {
    leases.acquire(key, holder);
  } catch (err) {
    if (err instanceof LeaseHeld) throw new Error(`${key} is being typed into by ${err.lease.holder.kind}; wait, or hand the input over there`);
    throw err;
  }
  try {
    leases.type(host, key, holder, text, { enter: true });
  } finally {
    leases.release(key, holder);
  }
}

export function cmdContinue(key: string | undefined, text: string | undefined): void {
  if (!key || !/^(claude|codex|antigravity)\/[^/]+\/[^/]+$/.test(key)) die("usage: agent-switch continue <provider/account/session-id> [--text \"…\"]");
  if (!TmuxHost.available()) die("tmux is not available here — Agent Switch hosts no sessions to type into");
  const body = text?.trim() ? text : CONTINUE_TEXT;
  try {
    typeIntoHosted(new TmuxHost(ROOT), new InputLeases(ROOT), key, { id: `cli-${process.pid}`, pid: process.pid, kind: "cli" }, body);
  } catch (err) {
    die((err as Error).message);
  }
  console.log(`Sent to ${key}: ${body}`);
}
