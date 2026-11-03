/**
 * `agent-switch remote [--json]` — which remote stage is on.
 * `remote rc on|off <account>` — R1: new hosted Claude sessions of that account
 *   start with Claude Remote Control.
 * `remote ssh on|off` — R2: let `remote rpc` answer.
 * `remote rpc` — JSON lines on stdin/stdout for `ssh <host> agent-switch remote rpc`.
 * `needs allow|deny <session> <approval>` — answer an open approval of a chat
 *   the app runs, through that chat's bridge (one decision, spec §13.5).
 */

import * as readline from "node:readline";

import { readPending } from "../bridge/pending.js";
import { submitAnswer, waitAck } from "../bridge/inbox.js";
import { die, ROOT } from "../profiles.js";
import { readRemote, rpc, setRemoteControl, setSsh, type RpcDeps } from "../remote.js";
import { gatherCandidates } from "./needs.js";
import { attentionFile, buildQueue, readAttention } from "../attention.js";

/** Answer through the bridge that holds `key`; `no-bridge` when none runs. */
export async function answerApproval(key: string, approvalId: string, decision: "allow" | "deny", source: string, timeoutMs = 5_000): Promise<{ status: "applied" | "rejected" | "no-bridge"; reason: string }> {
  if (!readPending(ROOT).some((f) => f.key === key)) return { status: "no-bridge", reason: "no chat holds this session right now" };
  const nonce = submitAnswer(ROOT, key, { approvalId, decision, source });
  const ack = await waitAck(ROOT, key, nonce, timeoutMs);
  return ack ?? { status: "rejected", reason: "the chat did not answer in time; nothing was applied by this request" };
}

const rpcDeps: RpcDeps = {
  needs: () => ({ items: buildQueue(gatherCandidates(), readAttention(attentionFile(ROOT))) }),
  answer: (key, id, d) => answerApproval(key, id, d, "ssh"),
};

export async function cmdRemote(sub: string | undefined, a: string | undefined, b: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  try {
    switch (sub) {
      case undefined:
      case "status": {
        const s = readRemote();
        if (flags.json) return void console.log(JSON.stringify(s));
        console.log(`R1 Claude Remote Control: ${s.remoteControlAccounts.length ? `on for ${s.remoteControlAccounts.join(", ")}` : "off"} — Anthropic's channel decides devices and revocation`);
        console.log(`R2 SSH (agent-switch remote rpc): ${s.ssh ? "on" : "off"} — an SSH login is the owner`);
        console.log("R3 end-to-end relay: not available");
        return;
      }
      case "rc":
        if ((a !== "on" && a !== "off") || !b) die("usage: agent-switch remote rc on|off <account>");
        setRemoteControl(b, a === "on");
        return void console.log(`Remote Control ${a} for new hosted Claude sessions of ${b}`);
      case "ssh":
        if (a !== "on" && a !== "off") die("usage: agent-switch remote ssh on|off");
        setSsh(a === "on");
        return void console.log(`remote rpc over SSH ${a}`);
      case "rpc": {
        const rl = readline.createInterface({ input: process.stdin });
        for await (const line of rl) {
          if (!line.trim()) continue;
          // Read the setting per request: turning SSH off stops an open connection too.
          process.stdout.write(JSON.stringify(await rpc(line.slice(0, 64 * 1024), rpcDeps, readRemote())) + "\n");
        }
        return;
      }
      default:
        die("usage: agent-switch remote [status] [--json] | remote rc on|off <account> | remote ssh on|off | remote rpc");
    }
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdNeedsAnswer(decision: "allow" | "deny", key: string | undefined, approvalId: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  if (!key || !approvalId) die(`usage: agent-switch needs ${decision} <session> <approval>`);
  let r;
  try {
    r = await answerApproval(key, approvalId, decision, "cli");
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
  if (flags.json) console.log(JSON.stringify(r));
  else console.log(r.status === "applied" ? `${decision === "allow" ? "Allowed once" : "Denied"}.` : `Not applied: ${r.reason}`);
  if (r.status !== "applied") process.exitCode = 2;
}
