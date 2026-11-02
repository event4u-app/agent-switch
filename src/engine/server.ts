/**
 * The engine's protocol server (ADR-006): one listener per user, line-delimited
 * JSON (src/protocol/messages.ts). The socket file is created with mode 0600
 * and lives in the agent-switch root (itself 0700), so only the user reaches
 * it; there is no port. A second engine finds the socket alive and refuses to
 * start; a socket left by a crashed engine is taken over.
 */

import * as fs from "node:fs";
import * as net from "node:net";

import { MAX_LINE_BYTES, PROTOCOL_VERSION, ProtocolError, parseRequest, type Request, type Response } from "../protocol/messages.js";
import { IngestRejected, sessionKey, type Store } from "../store/store.js";

export type Handler = (req: Request) => unknown;

export class EngineRunning extends Error {}

/** Answers `hello`, `ingest`, `sessions`, `children` from one store. */
export function storeHandler(store: Store): Handler {
  return (req) => {
    const p = req.params ?? {};
    switch (req.op) {
      case "hello":
        return { protocol: PROTOCOL_VERSION, pid: process.pid, driver: store.db.name };
      case "ingest": {
        const { producer, seq, provider, account, record } = p as any;
        try {
          return { stored: store.ingest({ producer, seq, provider, account, record }) };
        } catch (err) {
          if (err instanceof IngestRejected) throw new ProtocolError("rejected", err.message);
          throw err;
        }
      }
      case "sessions":
        return store.sessions();
      case "children": {
        const { provider, account, sessionId } = p as Record<string, unknown>;
        if (typeof provider !== "string" || typeof account !== "string" || typeof sessionId !== "string") {
          throw new ProtocolError("bad_request", "children needs provider, account and sessionId");
        }
        return store.children(sessionKey(provider, account, sessionId));
      }
    }
  };
}

/** Remembers the last answers by idempotency key. */
class IdemCache {
  private readonly map = new Map<string, Response>();
  constructor(private readonly max = 1000) {}
  get(k: string) {
    return this.map.get(k);
  }
  set(k: string, v: Response) {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

function canConnect(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(address);
    c.once("connect", () => (c.destroy(), resolve(true)));
    c.once("error", () => resolve(false));
  });
}

/** Start listening on `address`. Resolves with the server once it accepts connections. */
export async function startEngineServer(address: string, handler: Handler): Promise<net.Server> {
  const isPipe = address.startsWith("\\\\.\\pipe\\");
  if (!isPipe && fs.existsSync(address)) {
    if (await canConnect(address)) throw new EngineRunning(`an engine already listens on ${address}`);
    fs.unlinkSync(address); // left behind by an engine that did not shut down
  }
  const idem = new IdemCache();
  const answer = (line: string): Response => {
    let req: Request;
    try {
      req = parseRequest(line);
    } catch (err) {
      const e = err as ProtocolError;
      return { id: null, ok: false, error: { code: e.code ?? "bad_request", message: e.message } };
    }
    if (req.idem) {
      const seen = idem.get(`${req.op}:${req.idem}`);
      if (seen) return { ...seen, id: req.id };
    }
    let res: Response;
    try {
      res = { id: req.id, ok: true, result: handler(req) ?? null };
    } catch (err) {
      res = err instanceof ProtocolError
        ? { id: req.id, ok: false, error: { code: err.code, message: err.message } }
        : { id: req.id, ok: false, error: { code: "internal", message: "the engine could not answer" } };
    }
    if (req.idem && res.ok) idem.set(`${req.op}:${req.idem}`, res);
    return res;
  };

  const server = net.createServer((sock) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) sock.write(JSON.stringify(answer(line)) + "\n");
      }
      if (Buffer.byteLength(buf) > MAX_LINE_BYTES) {
        sock.end(JSON.stringify({ id: null, ok: false, error: { code: "too_large", message: `a request line is limited to ${MAX_LINE_BYTES} bytes` } }) + "\n");
        buf = "";
      }
    });
    sock.on("error", () => {
      // a client that went away mid-answer is not the engine's problem
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // The umask makes the socket 0600 from its first moment, before any chmod could.
    const old = isPipe ? undefined : process.umask(0o177);
    server.listen(address, () => {
      if (old !== undefined) process.umask(old);
      server.off("error", reject);
      resolve();
    });
  });
  if (!isPipe) fs.chmodSync(address, 0o600);
  return server;
}
