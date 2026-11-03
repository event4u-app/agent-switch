/**
 * Reaching sessions from elsewhere (v3.2 Phases 2–3). Every stage is off until
 * the user turns it on, and each stage says who enforces what — the council
 * review of 2026-11-03 asked for that split instead of one promise for all:
 *
 *  - R1 Claude Remote Control: AS only adds `--remote-control <name>` when a
 *    hosted Claude session starts. Anthropic's channel decides which devices
 *    connect and how they are revoked; AS opens nothing and cannot limit it.
 *  - R2 own tunnel over SSH: `ssh <host> agent-switch remote rpc`. SSH is the
 *    authentication, and an SSH login is the owner — it could run any command.
 *    `remote rpc` is a narrow convenience surface, not a sandbox.
 *  - R3 relay, and the phone web client inside the tailnet: not built.
 *
 * What no remote path offers: changing a permission mode, model, setting,
 * agent or account; "always allow"; starting or ending a session.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, ensureRoot } from "./profiles.js";

export const REMOTE_FILE = path.join(ROOT, "remote.json");

export interface RemoteSettings {
  /** R1: accounts whose new hosted Claude sessions start with Remote Control. */
  remoteControlAccounts: string[];
  /** R2: `remote rpc` answers over SSH. */
  ssh: boolean;
}

const ACCOUNT = /^[A-Za-z0-9._-]{1,64}$/;

export function readRemote(file: string = REMOTE_FILE): RemoteSettings {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    /* absent → everything off */
  }
  const accts = Array.isArray(raw.remoteControlAccounts) ? raw.remoteControlAccounts.filter((a): a is string => typeof a === "string" && ACCOUNT.test(a)) : [];
  return { remoteControlAccounts: [...new Set(accts)], ssh: raw.ssh === true };
}

export function writeRemote(s: RemoteSettings, file: string = REMOTE_FILE): void {
  if (file === REMOTE_FILE) ensureRoot();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function setRemoteControl(account: string, on: boolean, file: string = REMOTE_FILE): RemoteSettings {
  if (!ACCOUNT.test(account)) throw new Error(`not an account name: ${account}`);
  const s = readRemote(file);
  s.remoteControlAccounts = on ? [...new Set([...s.remoteControlAccounts, account])] : s.remoteControlAccounts.filter((a) => a !== account);
  writeRemote(s, file);
  return s;
}

export function setSsh(on: boolean, file: string = REMOTE_FILE): RemoteSettings {
  const s = { ...readRemote(file), ssh: on };
  writeRemote(s, file);
  return s;
}

/** A Remote Control name from a title: letters, digits, space, `._-`, 1–60. Pure. */
export function remoteControlName(title: string): string {
  const n = title.replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  return n || "agent-switch";
}

/**
 * Extra argv for a hosted start: `--remote-control <name>` for Claude when the
 * session asked for it or its account has it on; nothing otherwise. Never a
 * permission mode. Pure.
 */
export function remoteControlArgs(provider: string, account: string, perSession: boolean, name: string, s: RemoteSettings): string[] {
  if (provider !== "claude") return [];
  if (!perSession && !s.remoteControlAccounts.includes(account)) return [];
  return ["--remote-control", remoteControlName(name)];
}

/** Every method `remote rpc` answers, with the scope it belongs to. Anything else does not exist. */
export const RPC_METHODS = {
  "needs.list": "view",
  "approval.allow_once": "approve",
  "approval.deny": "approve",
} as const;
export type RpcMethod = keyof typeof RPC_METHODS;

export interface RpcRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export type RpcResponse = { id: string | number | null; ok: true; result: unknown } | { id: string | number | null; ok: false; error: { code: "bad_request" | "not_implemented" | "rejected" | "off"; message: string } };

export interface RpcDeps {
  needs: () => unknown;
  answer: (key: string, approvalId: string, decision: "allow" | "deny") => Promise<{ status: "applied" | "rejected" | "no-bridge"; reason: string }>;
}

const SESSION_KEY = /^(claude|codex|antigravity|acp)\/[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._:-]{1,128}$/;

/** One request line → one response. Pure over `deps`. */
export async function rpc(line: string, deps: RpcDeps, settings: RemoteSettings): Promise<RpcResponse> {
  let req: RpcRequest;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, ok: false, error: { code: "bad_request", message: "not JSON" } };
  }
  const id = typeof req?.id === "string" || typeof req?.id === "number" ? req.id : null;
  if (id === null || typeof req.method !== "string") return { id, ok: false, error: { code: "bad_request", message: "id and method are required" } };
  if (!settings.ssh) return { id, ok: false, error: { code: "off", message: "remote over SSH is off (agent-switch remote ssh on)" } };
  if (!Object.hasOwn(RPC_METHODS, req.method)) return { id, ok: false, error: { code: "not_implemented", message: `no remote method ${req.method.slice(0, 60)}` } };
  const m = req.method as RpcMethod;
  if (m === "needs.list") return { id, ok: true, result: deps.needs() };
  const p = req.params ?? {};
  const key = p.session;
  const approvalId = p.approval;
  if (typeof key !== "string" || !SESSION_KEY.test(key) || typeof approvalId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(approvalId))
    return { id, ok: false, error: { code: "bad_request", message: "session and approval must be valid ids" } };
  const r = await deps.answer(key, approvalId, m === "approval.deny" ? "deny" : "allow");
  return r.status === "applied" ? { id, ok: true, result: r } : { id, ok: false, error: { code: "rejected", message: r.status === "no-bridge" ? "no chat holds this session right now" : r.reason } };
}
