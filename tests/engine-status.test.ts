import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { EngineBusy, EngineUnreachable, helloEngine } from "../src/engine/client.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-st-"));
const sockIn = (dir: string) => (process.platform === "win32" ? `\\\\.\\pipe\\asw-st-${path.basename(dir)}` : path.join(dir, "e.sock"));

/** An engine whose answer to connection n waits `delays[n]` ms (Infinity: never). */
async function slowEngine(addr: string, delays: number[]): Promise<{ server: net.Server; connections: () => number }> {
  let n = 0;
  const server = net.createServer((c) => {
    const wait = delays[Math.min(n, delays.length - 1)];
    n++;
    c.setEncoding("utf8");
    c.once("data", (line: string) => {
      const { id } = JSON.parse(line.trim().split("\n")[0]);
      if (!Number.isFinite(wait)) return;
      setTimeout(() => c.writable && c.write(JSON.stringify({ id, ok: true, result: { protocol: 1, pid: 42, driver: "test" } }) + "\n"), wait);
    });
    c.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(addr, r));
  return { server, connections: () => n };
}

test("a busy engine that answers the second ask is running, not stopped", async () => {
  const addr = sockIn(tmp());
  const { server, connections } = await slowEngine(addr, [400, 0]);
  try {
    const hello = await helloEngine(addr, 150, 1500);
    assert.equal((hello as { pid: number }).pid, 42);
    assert.equal(connections(), 2, "asked twice: the first ask timed out on a live socket");
  } finally {
    server.close();
  }
});

test("an engine that never answers is reported busy after the second ask", async () => {
  const addr = sockIn(tmp());
  const { server, connections } = await slowEngine(addr, [Infinity]);
  try {
    await assert.rejects(helloEngine(addr, 100, 200), (e) => e instanceof EngineBusy && /no answer/.test((e as Error).message));
    assert.equal(connections(), 2);
  } finally {
    server.close();
  }
});

test("no engine listening is reported at once, without the long second ask", async () => {
  const addr = sockIn(tmp());
  const t0 = Date.now();
  await assert.rejects(helloEngine(addr, 800, 3000), (e) => e instanceof EngineUnreachable && !(e instanceof EngineBusy));
  assert.ok(Date.now() - t0 < 2500, "a missing socket does not wait out the 3 s second ask");
});

test("no second ask when it has no time left", async () => {
  const addr = sockIn(tmp());
  const { server, connections } = await slowEngine(addr, [Infinity]);
  try {
    await assert.rejects(helloEngine(addr, 100, 0), (e) => e instanceof EngineBusy);
    assert.equal(connections(), 1, "a caller with its own deadline asks once");
  } finally {
    server.close();
  }
});
