/**
 * Engine protocol v1 (ADR-006): what app, CLI and hook relay send to the engine
 * and what comes back. One JSON object per line over a 0600 Unix socket (a
 * named pipe on Windows). Types and validators only — no I/O — so the app can
 * import them without pulling in the engine.
 */

export const PROTOCOL_VERSION = 1;

export const OPS = ["hello", "ingest", "hook", "sessions", "children"] as const;
export type Op = (typeof OPS)[number];

export interface Request {
  /** Echoed in the response, so a client can match answers on one connection. */
  id: string | number;
  /** Same key → same answer, without doing the work twice (retries, double clicks). */
  idem?: string;
  op: Op;
  params?: Record<string, unknown>;
}

export type Response =
  | { id: Request["id"] | null; ok: true; result: unknown }
  | { id: Request["id"] | null; ok: false; error: { code: ProtocolErrorCode; message: string } };

export type ProtocolErrorCode = "bad_json" | "bad_request" | "unknown_op" | "rejected" | "internal" | "too_large";

/** A request line longer than this is refused unread. */
export const MAX_LINE_BYTES = 64 * 1024;

export class ProtocolError extends Error {
  constructor(readonly code: ProtocolErrorCode, message: string) {
    super(message);
  }
}

/** Parse and check one request line. Pure. */
export function parseRequest(line: string): Request {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    throw new ProtocolError("bad_json", "not a JSON object");
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new ProtocolError("bad_json", "not a JSON object");
  if (typeof o.id !== "string" && typeof o.id !== "number") throw new ProtocolError("bad_request", "id must be a string or number");
  if (typeof o.op !== "string") throw new ProtocolError("bad_request", "op is required");
  if (!(OPS as readonly string[]).includes(o.op)) throw new ProtocolError("unknown_op", `unknown op ${JSON.stringify(o.op).slice(0, 40)}`);
  if (o.idem !== undefined && (typeof o.idem !== "string" || o.idem.length === 0 || o.idem.length > 128)) throw new ProtocolError("bad_request", "idem must be a string of 1–128 characters");
  if (o.params !== undefined && (typeof o.params !== "object" || o.params === null || Array.isArray(o.params))) throw new ProtocolError("bad_request", "params must be an object");
  return { id: o.id, op: o.op, ...(o.idem !== undefined ? { idem: o.idem } : {}), ...(o.params !== undefined ? { params: o.params } : {}) };
}

/** Where the engine listens: a 0600 socket in the agent-switch root, or a per-user pipe on Windows. */
export function engineAddress(root: string, platform: NodeJS.Platform = process.platform, user = process.env.USERNAME ?? process.env.USER ?? "user"): string {
  if (platform === "win32") return `\\\\.\\pipe\\agent-switch-${user.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
  return `${root.replace(/[\\/]+$/, "")}/engine.sock`;
}
