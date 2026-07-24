import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the ipc layer — the keepalive's contract is which calls it makes when,
// not what Rust does with them.
const { acApi, acEnsure } = vi.hoisted(() => ({ acApi: vi.fn(), acEnsure: vi.fn() }));
vi.mock("./ipc.js", () => ({ acApi, acEnsure }));

import { startKeepalive, stopKeepalive, KEEPALIVE_INTERVAL_MS } from "./ac-keepalive.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  acApi.mockResolvedValue({ status: 200, body: "{}" });
  acEnsure.mockResolvedValue({ status: "live", port: 41000, pid: 1, version: null });
});

afterEach(() => {
  stopKeepalive();
  vi.useRealTimers();
});

describe("ac-keepalive", () => {
  it("pings immediately on start, then once per interval, via GET /api/v1/ping", async () => {
    startKeepalive();
    await vi.advanceTimersByTimeAsync(0); // flush the immediate ping
    expect(acApi).toHaveBeenCalledTimes(1);
    expect(acApi).toHaveBeenCalledWith("GET", "/api/v1/ping");

    await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL_MS);
    expect(acApi).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL_MS);
    expect(acApi).toHaveBeenCalledTimes(3);
    expect(acEnsure).not.toHaveBeenCalled(); // healthy pings never respawn
  });

  it("stop() ends the pinging (hidden view must not hold the server open)", async () => {
    startKeepalive();
    await vi.advanceTimersByTimeAsync(0);
    stopKeepalive();
    await vi.advanceTimersByTimeAsync(3 * KEEPALIVE_INTERVAL_MS);
    expect(acApi).toHaveBeenCalledTimes(1); // only the immediate ping
  });

  it("a rejected ping triggers exactly one acEnsure (transparent respawn path)", async () => {
    acApi.mockRejectedValue({ kind: "notRunning" });
    startKeepalive();
    await vi.advanceTimersByTimeAsync(0);
    expect(acEnsure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL_MS);
    expect(acEnsure).toHaveBeenCalledTimes(2); // one per failed ping, not a loop
  });

  it("a non-200 ping also falls back to acEnsure", async () => {
    acApi.mockResolvedValue({ status: 503, body: "" });
    startKeepalive();
    await vi.advanceTimersByTimeAsync(0);
    expect(acEnsure).toHaveBeenCalledTimes(1);
  });

  it("an acEnsure failure is swallowed (surfaced by the section UI, not here)", async () => {
    acApi.mockRejectedValue({ kind: "notRunning" });
    acEnsure.mockRejectedValue({ kind: "spawnFailed", exitCode: 1, stderr: "boom" });
    startKeepalive();
    await expect(vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL_MS)).resolves.not.toThrow();
    expect(acEnsure).toHaveBeenCalledTimes(2);
  });

  it("restarting does not stack timers", async () => {
    startKeepalive();
    startKeepalive();
    await vi.advanceTimersByTimeAsync(0);
    expect(acApi).toHaveBeenCalledTimes(2); // two immediate pings…
    await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL_MS);
    expect(acApi).toHaveBeenCalledTimes(3); // …but only ONE interval tick
  });

  it("accepts a custom interval", async () => {
    startKeepalive(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(acApi).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(acApi).toHaveBeenCalledTimes(2);
  });
});
