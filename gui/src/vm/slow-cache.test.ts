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
  listLaunchers: vi.fn(async () => []),
  listSwitchRequests: vi.fn(async () => []),
  storedUsage: vi.fn(async () => new Map()),
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
  SHARED_KEY,
} from "./slow-cache.js";
import { installMemoryStorage } from "../redesign/engines/test-storage.js";

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

describe("the tray and the main window read one timestamped cache", () => {
  type Mod = typeof import("./slow-cache.js");
  /** One webview: its own module state, the app's one localStorage. */
  async function window(): Promise<Mod> {
    vi.resetModules();
    return import("./slow-cache.js");
  }

  beforeEach(() => installMemoryStorage());

  it("a sweep, a doctor run and a latest lookup made in one window are reused by the other, with their time", async () => {
    const main = await window();
    const tray = await window();
    const sweep = vi.fn(async () => ["rtk"]);
    const check = vi.fn(async () => ({ readiness: "ready" }));
    const lookup = vi.fn(async () => "0.2.0");
    const a = await main.cachedTooling(sweep, () => 1_000);
    const d = await main.cachedDoctor(check, () => 1_000);
    await main.cachedLatest("rtk", lookup, () => 1_000);
    expect(await tray.cachedTooling(sweep, () => 5_000)).toEqual(a);
    expect(await tray.cachedDoctor(check, () => 5_000)).toEqual(d);
    expect(await tray.cachedLatest("rtk", lookup, () => 5_000)).toBe("0.2.0");
    expect([sweep, check, lookup].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    expect(a.at).toBe(1_000);
  });

  it("the newer entry wins: a forced run in one window replaces what the other held", async () => {
    const main = await window();
    const tray = await window();
    await tray.cachedDoctor(async () => ({ readiness: "attention" }), () => 1_000);
    main.forceDoctorOnNextLoad();
    await main.cachedDoctor(async () => ({ readiness: "ready" }), () => 2_000);
    expect(await tray.cachedDoctor(vi.fn(), () => 3_000)).toEqual({ at: 2_000, value: { readiness: "ready" } });
  });

  it("a focus in one window re-sweeps by the age of the other window's sweep", async () => {
    const main = await window();
    const tray = await window();
    const sweep = vi.fn(async () => []);
    await main.cachedTooling(sweep, () => 1_000);
    tray.resweepToolsIfStale(1_000 + main.FOCUS_RESWEEP_MS - 1);
    await tray.cachedTooling(sweep, () => 2_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    tray.resweepToolsIfStale(1_000 + main.FOCUS_RESWEEP_MS);
    await tray.cachedTooling(sweep, () => 70_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("an unreadable shared entry is a miss, never an error", async () => {
    localStorage.setItem(SHARED_KEY, "{not json");
    const tray = await window();
    const sweep = vi.fn(async () => ["rtk"]);
    expect((await tray.cachedTooling(sweep, () => 1_000)).value).toEqual(["rtk"]);
    localStorage.setItem(SHARED_KEY, JSON.stringify({ tooling: { at: "soon", value: 1 }, latest: { rtk: null } }));
    const main = await window();
    expect((await main.cachedTooling(sweep, () => 2_000)).value).toEqual(["rtk"]);
    expect(await main.cachedLatest("rtk", async () => "0.3.0", () => 2_000)).toBe("0.3.0");
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
