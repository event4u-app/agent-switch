import { describe, expect, it, vi } from "vitest";
import { reconcileAutostart, setAutostartPreference, type AutostartPref } from "./autostart.js";

function deps(pref: AutostartPref, os: { on: boolean; enableWorks?: boolean }, legacy = false) {
  const d = {
    readPref: vi.fn(async () => pref),
    writePref: vi.fn(async (_s: "enabled" | "disabled", _b: "first-run" | "user") => {}),
    markDegraded: vi.fn(async (_r: string) => {}),
    osEnable: vi.fn(async () => {
      if (os.enableWorks !== false) os.on = true;
    }),
    osDisable: vi.fn(async () => {
      os.on = false;
    }),
    osIsEnabled: vi.fn(async () => os.on),
    legacyDefaulted: vi.fn(() => legacy),
  };
  return d;
}

describe("reconcileAutostart", () => {
  it("fresh install: enables, reads the OS state back, then persists enabled(first-run)", async () => {
    const d = deps({ state: "unset" }, { on: false });
    expect(await reconcileAutostart(d)).toBe("enabled");
    expect(d.osEnable).toHaveBeenCalled();
    expect(d.osIsEnabled).toHaveBeenCalled();
    expect(d.writePref).toHaveBeenCalledWith("enabled", "first-run");
    expect(d.osEnable.mock.invocationCallOrder[0]).toBeLessThan(d.writePref.mock.invocationCallOrder[0]);
  });

  it("OS does not confirm: nothing persisted, degraded, retried next launch", async () => {
    const d = deps({ state: "unset" }, { on: false, enableWorks: false });
    expect(await reconcileAutostart(d)).toBe("degraded");
    expect(d.writePref).not.toHaveBeenCalled();
    expect(d.markDegraded).toHaveBeenCalled();
  });

  it("a user's off survives every launch/update — the OS is never touched", async () => {
    const d = deps({ state: "disabled", by: "user" }, { on: false });
    expect(await reconcileAutostart(d)).toBe("disabled");
    expect(d.osEnable).not.toHaveBeenCalled();
  });

  it("legacy 2.1.0 flag + OS off: recorded as the user's off, not re-enabled", async () => {
    const d = deps({ state: "unset" }, { on: false }, true);
    expect(await reconcileAutostart(d)).toBe("disabled");
    expect(d.osEnable).not.toHaveBeenCalled();
    expect(d.writePref).toHaveBeenCalledWith("disabled", "user");
  });

  it("legacy 2.1.0 flag + OS on: recorded as enabled(first-run)", async () => {
    const d = deps({ state: "unset" }, { on: true }, true);
    expect(await reconcileAutostart(d)).toBe("enabled");
    expect(d.writePref).toHaveBeenCalledWith("enabled", "first-run");
  });

  it("stored enabled but the login item vanished: degraded, not silently re-created", async () => {
    const d = deps({ state: "enabled", by: "first-run" }, { on: false });
    expect(await reconcileAutostart(d)).toBe("degraded");
    expect(d.osEnable).not.toHaveBeenCalled();
  });

  it("preference unreadable (CLI missing): touches nothing", async () => {
    const d = { ...deps({ state: "unset" }, { on: false }), readPref: vi.fn(async () => { throw new Error("no cli"); }) };
    expect(await reconcileAutostart(d)).toBe("degraded");
    expect(d.osEnable).not.toHaveBeenCalled();
    expect(d.writePref).not.toHaveBeenCalled();
  });
});

describe("setAutostartPreference", () => {
  it("persists the user's choice in both directions", async () => {
    const d = deps({ state: "unset" }, { on: true });
    await setAutostartPreference(false, d);
    expect(d.osDisable).toHaveBeenCalled();
    expect(d.writePref).toHaveBeenLastCalledWith("disabled", "user");
    await setAutostartPreference(true, d);
    expect(d.writePref).toHaveBeenLastCalledWith("enabled", "user");
  });
});
