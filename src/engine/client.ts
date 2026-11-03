/**
 * A short-lived protocol client: one connection, one or more requests, close.
 * Used by the CLI, the hook relay and tests. When no engine listens it rejects
 * with `EngineUnreachable`, so callers can fall back to files.
 */

import * as net from "node:net";

import type { Op, Request, Response } from "../protocol/messages.js";

export class EngineUnreachable extends Error {}

export interface Call {
  op: Op;
  params?: Record<string, unknown>;
  idem?: string;
}

export function callEngine(address: string, calls: Call[], timeoutMs = 2000): Promise<Response[]> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(address);
    const out: Response[] = [];
    let buf = "";
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      err ? reject(err) : resolve(out);
    };
    const timer = setTimeout(() => done(new EngineUnreachable(`no answer from the engine within ${timeoutMs} ms`)), timeoutMs);
    sock.setEncoding("utf8");
    sock.once("connect", () => {
      const reqs: Request[] = calls.map((c, i) => ({ id: i, op: c.op, ...(c.params ? { params: c.params } : {}), ...(c.idem ? { idem: c.idem } : {}) }));
      sock.write(reqs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    });
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        out.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
        if (out.length === calls.length) done();
      }
    });
    sock.once("error", (err: NodeJS.ErrnoException) => done(new EngineUnreachable(`engine not reachable at ${address} (${err.code ?? err.message})`)));
    sock.once("close", () => done(out.length === calls.length ? undefined : new EngineUnreachable("the engine closed the connection")));
  });
}
