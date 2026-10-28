import { describe, expect, it } from "vitest";
import tauriConf from "../src-tauri/tauri.conf.json?raw";
import mainRs from "../src-tauri/src/main.rs?raw";
import mainTsx from "./main.tsx?raw";

// Silent start: an autostart (login) launch must not pop the main window. The
// window is created hidden and only an explicit user action shows it (tray
// click, Dock reopen, a clicked notification) — nothing on the startup path.

describe("silent start", () => {
  it("the main window is created hidden", () => {
    const conf = JSON.parse(tauriConf);
    const main = conf.app.windows.find((w: { label?: string }) => (w.label ?? "main") === "main");
    expect(main.visible).toBe(false);
  });

  it("the startup path never shows it", () => {
    expect(mainTsx).not.toMatch(/showWindow|show_window|\.show\(/);
    const rust = mainRs;
    // Everything in setup before the tray is wired runs unconditionally at launch;
    // show_main calls after that point sit inside click handlers.
    const setup = rust.slice(rust.indexOf(".setup(|app|"), rust.indexOf("TrayIconBuilder::with_id"));
    expect(setup.length).toBeGreaterThan(0);
    expect(setup).not.toMatch(/show_main\(|\.show\(\)/);
  });
});
