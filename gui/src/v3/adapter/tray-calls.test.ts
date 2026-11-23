import { describe, expect, it, vi } from "vitest";

// Every shell call the tray window makes while it loads, with the window label "tray".
const { create, calls } = vi.hoisted(() => {
  const calls: { name: string; args: string[] }[] = [];
  const create = vi.fn((name: string, args: string[]) => {
    calls.push({ name, args });
    // Every call fails: the loader tolerates that, and only which calls are made matters here.
    return { execute: async () => ({ code: 1, stdout: "", stderr: "fake" }), spawn: async () => ({}) };
  });
  return { create, calls };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create }, open: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "tray", onFocusChanged: async () => () => {} }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn(async () => false) }));

import trayCapability from "../../../src-tauri/capabilities/tray.json?raw";
import { reportVisibility } from "../../ipc.js";
import { loadViewModel } from "../../vm/load.js";
import { TRAY_DEPS, readPicks } from "./V3TrayApp.js";

const allowedNames = new Set(
  (JSON.parse(trayCapability).permissions as ({ identifier: string; allow: { name: string }[] } | string)[]).flatMap((p) => (typeof p === "object" && p.identifier === "shell:allow-execute" ? p.allow.map((a) => a.name) : [])),
);

describe("readPicks", () => {
  it("names each tool's plain-start account and keeps its why; a failed read leaves that tool out", async () => {
    const picks = await readPicks(async (t) => {
      if (t === "codex") throw new Error("down");
      return { profile: "claude/side", configDir: "/c", why: ["Picked claude/side"] };
    });
    expect(picks).toEqual({ claude: { name: "side", why: ["Picked claude/side"] } });
    expect(await readPicks(async () => ({ profile: null, configDir: null, why: ["No active profile"] }))).toEqual({
      claude: { name: null, why: ["No active profile"] },
      codex: { name: null, why: ["No active profile"] },
    });
  });
});

describe("the tray window stays inside its capability", () => {
  it("loading the view model, the v3 feeds and a visibility change make only scoped calls", async () => {
    await loadViewModel();
    await Promise.allSettled([TRAY_DEPS.needs(), TRAY_DEPS.host(), TRAY_DEPS.engine(), TRAY_DEPS.library(), TRAY_DEPS.openTargets(), TRAY_DEPS.codexRows(), readPicks()]);
    expect(calls.filter((c) => c.name === "as-read-plain-start").map((c) => c.args[2]).sort()).toEqual(["claude", "codex"]);
    await reportVisibility(true);
    expect(calls.length).toBeGreaterThan(5);
    const outside = calls.filter((c) => !allowedNames.has(c.name)).map((c) => `${c.name}: ${c.args.join(" ")}`);
    expect(outside).toEqual([]);
  });
});
