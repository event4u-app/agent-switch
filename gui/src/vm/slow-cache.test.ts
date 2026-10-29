import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  listProfiles: vi.fn(async () => []),
  listSessions: vi.fn(async () => []),
  toolingStatus: vi.fn(async () => [{ id: "rtk", present: true, version: "0.1.0" }]),
  listNotifications: vi.fn(async () => []),
  getProviders: vi.fn(async () => ({})),
  acDiscover: vi.fn(async () => null),
  getAutostart: vi.fn(async () => false),
  listApps: vi.fn(async () => []),
  listProtection: vi.fn(async () => []),
  authStatus: vi.fn(async () => []),
  listPools: vi.fn(async () => []),
  listMappings: vi.fn(async () => []),
  doctor: vi.fn(async () => ({ readiness: "ready", checks: [] })),
  listActivity: vi.fn(async () => []),
  getGuard: vi.fn(async () => null),
  desktopInstances: vi.fn(async () => []),
}));
const latest = vi.hoisted(() => vi.fn(async () => "0.2.0"));

vi.mock("../ipc.js", () => ipc);
vi.mock("../tool-updates.js", async (orig) => ({
  ...(await orig<typeof import("../tool-updates.js")>()),
  latestToolVersion: latest,
}));
vi.mock("./usage-loader.js", () => ({ loadUsage: async () => [] }));

import { loadViewModel } from "./load.js";
import {
  cachedLatest,
  FOCUS_RESWEEP_MS,
  forceDoctorOnNextLoad,
  forceToolsOnNextLoad,
  LATEST_TTL_MS,
  resetSlowCache,
  resweepToolsIfStale,
} from "./slow-cache.js";

describe("slow parts of a load are cached", () => {
  beforeEach(() => {
    resetSlowCache();
    vi.clearAllMocks();
  });

  it("a reload after an action reuses the tooling sweep, the latest lookups and doctor", async () => {
    await loadViewModel();
    await loadViewModel();
    await loadViewModel();
    expect(ipc.toolingStatus).toHaveBeenCalledTimes(1);
    expect(ipc.doctor).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
    // The fast readouts still run every time.
    expect(ipc.listProfiles).toHaveBeenCalledTimes(3);
    expect(ipc.listSessions).toHaveBeenCalledTimes(3);
  });

  it("Check now re-sweeps tooling but keeps the hourly latest-version lookup", async () => {
    const v = await loadViewModel();
    forceToolsOnNextLoad();
    const w = await loadViewModel();
    expect(ipc.toolingStatus).toHaveBeenCalledTimes(2);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(w.tools[0].latest).toBe(v.tools[0].latest);
  });

  it("Health asks doctor again only when told to", async () => {
    await loadViewModel();
    forceDoctorOnNextLoad();
    await loadViewModel();
    await loadViewModel();
    expect(ipc.doctor).toHaveBeenCalledTimes(2);
  });

  it("a focus re-sweeps only when the last sweep is a minute old", async () => {
    const t0 = Date.now();
    await loadViewModel();
    resweepToolsIfStale(t0 + 5_000);
    await loadViewModel();
    expect(ipc.toolingStatus).toHaveBeenCalledTimes(1);
    resweepToolsIfStale(t0 + FOCUS_RESWEEP_MS + 1_000);
    await loadViewModel();
    expect(ipc.toolingStatus).toHaveBeenCalledTimes(2);
  });

  it("a failed sweep or doctor run is retried on the next load", async () => {
    ipc.toolingStatus.mockRejectedValueOnce(new Error("boom"));
    ipc.doctor.mockRejectedValueOnce(new Error("boom"));
    await loadViewModel();
    await loadViewModel();
    expect(ipc.toolingStatus).toHaveBeenCalledTimes(2);
    expect(ipc.doctor).toHaveBeenCalledTimes(2);
  });

  it("latest-version lookups run at most hourly, a failure included", async () => {
    let now = 1_000;
    const lookup = vi.fn(async () => null);
    await cachedLatest("rtk", lookup, () => now);
    now += LATEST_TTL_MS - 1;
    await cachedLatest("rtk", lookup, () => now);
    expect(lookup).toHaveBeenCalledTimes(1);
    now += 2;
    await cachedLatest("rtk", lookup, () => now);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
