import trayCapability from "../src-tauri/capabilities/tray.json?raw";
// Vitest runs from gui/.
import { describe, expect, it } from "vitest";
import { trayScope } from "./ipc.js";

type Arg = string | { validator: string };
interface Entry {
  name: string;
  cmd: string;
  args: Arg[] | boolean;
}

const cap = JSON.parse(trayCapability) as {
  description: string;
  permissions: (string | { identifier: string; allow: Entry[] })[];
};
const entries = cap.permissions.flatMap((p) => (typeof p === "object" && p.identifier === "shell:allow-execute" ? p.allow : []));

/** What tauri-plugin-shell's scope does: the first entry with the name, then
 *  every position fixed or matching its validator (wrapped as ^…$, as the plugin does), same length. */
function allowed(name: string, args: string[]): boolean {
  const e = entries.find((x) => x.name === name);
  if (!e || !Array.isArray(e.args) || e.args.length !== args.length) return false;
  return e.args.every((a, i) => (typeof a === "string" ? a === args[i] : new RegExp(`^${a.validator}$`).test(args[i])));
}

/** Every CLI call the tray popover makes (loadViewModel + usage). */
const TRAY_CALLS: string[][] = [
  ["list", "--json"],
  ["sessions", "--recent", "50", "--json"],
  ["tooling", "--json"],
  ["notifications", "--json"],
  ["providers", "status", "--json"],
  ["apps", "--json"],
  ["protection", "--json"],
  ["auth-status", "--json"],
  ["pool", "list", "--json"],
  ["mappings", "--json"],
  ["doctor", "--json"],
  ["activity", "--limit", "200", "--json"],
  ["guard", "--json"],
  ["status", "--provider", "claude", "work.1", "--json"],
];

describe("tray capability: read-only agent-switch calls only", () => {
  it("every call the tray makes maps to a scope entry that allows exactly it", () => {
    for (const args of TRAY_CALLS) {
      const name = trayScope(args);
      expect(name, args.join(" ")).not.toBeNull();
      expect(allowed(name!, args), args.join(" ")).toBe(true);
      expect(entries.find((e) => e.name === name)!.cmd).toBe("agent-switch");
    }
  });

  it("no blanket agent-switch entry, no agent-config, no args:true", () => {
    expect(entries.some((e) => e.args === true)).toBe(false);
    expect(entries.some((e) => e.name === "agent-switch")).toBe(false);
    expect(entries.some((e) => e.cmd !== "agent-switch")).toBe(false);
    expect(cap.description).not.toMatch(/same scoped shell entries as main/);
  });

  it("writes and odd arguments get no tray scope", () => {
    for (const args of [
      ["use", "work", "--provider", "claude"],
      ["uninstall", "--force"],
      ["tooling", "install", "rtk"],
      ["notify", "--kind", "info", "--title", "t", "--message", "m"],
      ["status", "--provider", "claude", "--evil", "--json"],
      ["status", "--provider", "claude", "a b", "--json"],
      ["sessions", "--recent", "x", "--json"],
    ]) {
      expect(trayScope(args), args.join(" ")).toBeNull();
    }
  });
});
