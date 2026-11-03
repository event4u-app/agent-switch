import cap from "../src-tauri/capabilities/default.json?raw";
import { describe, expect, it } from "vitest";
import { bridgeArgs, type BridgeSpec } from "./ipc.js";

type Arg = string | { validator: string };
const spawn = (JSON.parse(cap).permissions as ({ identifier: string; allow: { name: string; cmd: string; args: Arg[] }[] } | string)[]).find(
  (p): p is { identifier: string; allow: { name: string; cmd: string; args: Arg[] }[] } => typeof p === "object" && p.identifier === "shell:allow-spawn",
)!;

/** What tauri-plugin-shell checks: the named entry, same length, each position fixed or matching ^validator$. */
function allowed(name: string, args: string[]): boolean {
  const e = spawn.allow.find((x) => x.name === name);
  if (!e || e.args.length !== args.length) return false;
  return e.args.every((a, i) => (typeof a === "string" ? a === args[i] : new RegExp(`^(?:${a.validator})$`).test(args[i])));
}

describe("bridge spawn scope", () => {
  it.each<BridgeSpec>([
    { key: "claude/work/9f640d3b-0a51-47b5-944c-934d3148a098", mode: "default" },
    { key: "codex/Matze1/01a19e25-3b5a-71d0-a44b-f4aca10cc111", mode: "plan", model: "gpt-5.5" },
    { new: { profile: "work", provider: "claude", cwd: "/Users/you/code/my app" }, mode: "acceptEdits" },
    { new: { profile: "MatneX", provider: "codex", cwd: "C:\\code\\x" }, mode: "default", model: "o4" },
  ])("allows %j", (spec) => {
    const { scope, args } = bridgeArgs(spec);
    expect(allowed(scope, args)).toBe(true);
  });

  it("refuses a bypass mode, another command, a key that is not a session, a folder with a newline", () => {
    expect(allowed("as-bridge", ["bridge", "claude/work/abcd1234", "--mode", "bypassPermissions"])).toBe(false);
    expect(allowed("as-bridge", ["host", "claude/work/abcd1234", "--mode", "default"])).toBe(false);
    expect(allowed("as-bridge", ["bridge", "../../etc/passwd", "--mode", "default"])).toBe(false);
    expect(allowed("as-bridge-new", ["bridge", "--new", "work", "--provider", "claude", "--cwd", "/x\n--mode", "--mode", "default"])).toBe(false);
    expect(allowed("as-bridge-model", ["bridge", "claude/w/abcd1234", "--mode", "default", "--model", "x; rm -rf /"])).toBe(false);
  });

  it("only the bridge can be spawned; everything else stays execute-only", () => {
    expect(spawn.allow.every((e) => e.cmd === "agent-switch" && e.args[0] === "bridge")).toBe(true);
  });
});
