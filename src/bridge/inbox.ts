/**
 * One decision per approval, made by the bridge that owns the session
 * (spec §13.5; v3.2 Phase 2–3). An answer from outside the chat view — the CLI,
 * `remote rpc` over SSH — is a request file in that bridge's inbox; the bridge
 * alone decides whether it applies and writes an acknowledgement:
 *
 *   `applied`  — the approval was still open in this bridge; it is now answered.
 *   `rejected` — already answered (chat card, terminal, another device), not
 *                open in this bridge, stale, or not allowed from outside.
 *
 * A written request means queued, never approved. Only allow-once and deny
 * come through here: "always allow" widens a rule and stays in the chat view.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type InboxDecision = "allow" | "deny";

export interface InboxRequest {
  approvalId: string;
  decision: InboxDecision;
  /** Who asked: `cli`, `ssh`. Shown in the chat, never trusted for authority. */
  source: string;
  at: string;
}

export interface InboxAck {
  status: "applied" | "rejected";
  reason: string;
}

/** A request older than this is refused, never applied late. */
export const INBOX_MAX_AGE_MS = 120_000;
const ACK_KEEP_MS = 10 * 60_000;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const NONCE = /^[0-9a-f]{32}$/;

export const inboxDir = (root: string, key: string) => path.join(root, "bridge", "inbox", crypto.createHash("sha256").update(key).digest("hex").slice(0, 32));

/** Queue an answer for the bridge of `key`. Returns the nonce its acknowledgement is filed under. */
export function submitAnswer(root: string, key: string, r: Omit<InboxRequest, "at">, now: Date = new Date()): string {
  if (!ID.test(r.approvalId)) throw new Error("not a valid approval id");
  if (r.decision !== "allow" && r.decision !== "deny") throw new Error("decision is allow or deny");
  const dir = inboxDir(root, key);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const nonce = crypto.randomBytes(16).toString("hex");
  const tmp = path.join(dir, `.${nonce}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ ...r, at: now.toISOString() }), { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, path.join(dir, `${nonce}.json`));
  return nonce;
}

export function readAck(root: string, key: string, nonce: string): InboxAck | null {
  if (!NONCE.test(nonce)) return null;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(inboxDir(root, key), `${nonce}.ack`), "utf8"));
    return a && (a.status === "applied" || a.status === "rejected") ? { status: a.status, reason: String(a.reason ?? "") } : null;
  } catch {
    return null;
  }
}

/** Wait for the bridge's answer to one request; null when no bridge took it in time. */
export async function waitAck(root: string, key: string, nonce: string, timeoutMs = 5_000, stepMs = 100): Promise<InboxAck | null> {
  for (let t = 0; t <= timeoutMs; t += stepMs) {
    const a = readAck(root, key, nonce);
    if (a) return a;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return null;
}

function readRequest(file: string): InboxRequest | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    if (!fs.fstatSync(fd).isFile()) return null;
    const o = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (!o || !ID.test(o.approvalId) || (o.decision !== "allow" && o.decision !== "deny") || typeof o.at !== "string") return null;
    return { approvalId: o.approvalId, decision: o.decision, source: typeof o.source === "string" ? o.source.slice(0, 20) : "unknown", at: o.at };
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Take every waiting request of one bridge, oldest first. `apply` is the
 * bridge's own decision: it runs only for a fresh, well-formed request and
 * says whether the approval was still open. Each request is removed and
 * acknowledged exactly once. Old acknowledgements are swept.
 */
export function drainInbox(root: string, key: string, apply: (r: InboxRequest) => InboxAck, now: number = Date.now()): number {
  const dir = inboxDir(root, key);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let n = 0;
  const reqs = names.filter((f) => /^[0-9a-f]{32}\.json$/.test(f)).map((f) => ({ f, at: fs.lstatSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.at - b.at);
  for (const { f } of reqs) {
    const file = path.join(dir, f);
    const r = readRequest(file);
    fs.rmSync(file, { force: true });
    const age = r ? now - Date.parse(r.at) : Infinity;
    const ack: InboxAck = !r ? { status: "rejected", reason: "not a valid request" } : !(age >= -5_000 && age <= INBOX_MAX_AGE_MS) ? { status: "rejected", reason: "too old" } : apply(r);
    fs.writeFileSync(path.join(dir, f.replace(/\.json$/, ".ack")), JSON.stringify(ack), { mode: 0o600 });
    n++;
  }
  for (const f of names.filter((x) => x.endsWith(".ack"))) {
    const file = path.join(dir, f);
    try {
      if (now - fs.lstatSync(file).mtimeMs > ACK_KEEP_MS) fs.rmSync(file, { force: true });
    } catch {
      /* gone */
    }
  }
  return n;
}

/** The bridge's half: answer through `send` only what is open in it right now. */
export function bridgeApplier(open: () => readonly string[], send: (c: { cmd: "approve" | "deny"; id: string }) => void): (r: InboxRequest) => InboxAck {
  return (r) => {
    if (!open().includes(r.approvalId)) return { status: "rejected", reason: "not open in this chat (already answered?)" };
    send({ cmd: r.decision === "allow" ? "approve" : "deny", id: r.approvalId });
    return { status: "applied", reason: r.decision === "allow" ? "allowed once" : "denied" };
  };
}
