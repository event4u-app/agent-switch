import { describe, expect, it, vi } from "vitest";
import { cleanText, createDebugLog, describeCall, errorLine, installDebugLog, keyOf, recordDebug, type DebugEntry, type DebugLogDeps } from "./debug-log.js";

function fakeDeps(stored: string | null = null) {
  const written: DebugEntry[][] = [];
  const timers: { f: () => void; ms: number }[] = [];
  let saved = stored;
  const deps: DebugLogDeps = {
    write: async (b) => void written.push(b),
    now: () => new Date("2026-11-24T08:00:00Z"),
    schedule: (f, ms) => (timers.push({ f, ms }), timers.length),
    cancel: () => {},
    load: () => saved,
    save: (v) => void (saved = v),
  };
  return { deps, written, timers, saved: () => saved };
}

describe("describeCall", () => {
  it("names a call by verb and a known subcommand, never by the values it carries", () => {
    expect(describeCall(["sessions", "name", "claude/w/abcd1234", "My secret title", "--json"])).toEqual({ what: "sessions name", key: "claude/w/abcd1234", read: false });
    expect(describeCall(["view", "claude/w/abcd1234", "terminal", "--json"])).toEqual({ what: "view", key: "claude/w/abcd1234", read: false });
    expect(describeCall(["rename", "work", "private"]).what, "a profile name is a value").toBe("rename");
    expect(describeCall(["use", "acme-client", "--provider", "claude"]).what).toBe("use");
    expect(describeCall(["pool", "add", "client-x"]).what).toBe("pool add");
  });
  it("a subcommand after the session key is named, and is not taken for a read", () => {
    expect(describeCall(["diff", "claude/w/abcd1234", "stage", "--file", "src/a.ts"])).toEqual({ what: "diff stage", key: "claude/w/abcd1234", read: false });
    expect(describeCall(["diff", "claude/w/abcd1234", "--json"]).read).toBe(true);
  });
  it("reads that poll are reads; changes are not", () => {
    expect(describeCall(["sessions", "--recent", "50", "--json"]).read).toBe(true);
    expect(describeCall(["timeline", "claude/w/abcd1234", "--json"]).read).toBe(true);
    expect(describeCall(["engine", "status", "--json"]).read, "polled every 10 s").toBe(true);
    expect(describeCall(["pool", "list", "--json"]).read).toBe(true);
    expect(describeCall(["pool", "create", "x"]).read).toBe(false);
    expect(describeCall(["use", "work"]).read).toBe(false);
  });
});

describe("cleanText / keyOf", () => {
  it("cuts quoted text, paths, file names and secrets; finds the session key among values", () => {
    expect(cleanText('your draft is in the way ("hello world")')).toBe('your draft is in the way ("…")');
    expect(cleanText("refused acquisition-plan.pdf: not a regular file")).toBe("refused <file .pdf>: not a regular file");
    expect(cleanText("failed in /Users/me/acme-merger/src")).toBe("failed in <path>");
    expect(cleanText("password=hunter2")).toBe("password=[redacted]");
    expect(cleanText(`sk-ant-${"a".repeat(30)}`)).toBe("[redacted]");
    expect(keyOf(["x", 3, "codex/me/0a1b2c3d"])).toBe("codex/me/0a1b2c3d");
    expect(keyOf(["codex/private/plan"]), "a title shaped like a key").toBeUndefined();
    expect(keyOf(["/Users/me/p"])).toBeUndefined();
  });
});

describe("errorLine", () => {
  it("the line that says what went wrong, not Node's trailer or a stack frame", () => {
    expect(errorLine("file:///x/dist/index.js:12\n        throw e;\n        ^\n\nError: Cannot find module '/x/dist/commands/a.js'\n    at resolve (node:internal)\n\nNode.js v26.7.0\n")).toBe("Error: Cannot find module '/x/dist/commands/a.js'");
    expect(errorLine("warning: slow\nerror: no such account\n")).toBe("error: no such account");
    expect(errorLine("just text\n")).toBe("just text");
    expect(errorLine(undefined)).toBe("");
  });
});

describe("createDebugLog", () => {
  it("knows whether the person acted a moment ago (an action or a view switch), for calls that succeed", () => {
    let t = 0;
    const f = fakeDeps();
    const log = createDebugLog({ ...f.deps, now: () => new Date(t) });
    expect(log.recentAction()).toBe(false);
    log.record({ kind: "call", what: "sessions", ok: false });
    expect(log.recentAction(), "a call is not the person acting").toBe(false);
    log.record({ kind: "action", what: "view" });
    t = 4_000;
    expect(log.recentAction()).toBe(true);
    t = 6_000;
    expect(log.recentAction()).toBe(false);
  });

  it("batches entries; a failure is written soon, the rest within a couple of seconds", async () => {
    const f = fakeDeps();
    const log = createDebugLog(f.deps);
    log.record({ kind: "action", what: "view", key: "claude/w/0a1b2c3d" });
    expect(f.timers.at(-1)!.ms).toBe(2000);
    log.record({ kind: "call", what: "view", key: "claude/w/0a1b2c3d", ok: false, error: 'refused "draft"' });
    expect(f.timers.at(-1)!.ms).toBe(200);
    await log.flush();
    expect(f.written).toHaveLength(1);
    expect(f.written[0].map((e) => [e.src, e.kind, e.what, e.error])).toEqual([["app", "action", "view", undefined], ["app", "call", "view", 'refused "…"']]);
    await log.flush();
    expect(f.written, "nothing new: nothing written").toHaveLength(1);
  });
  it("a failure that repeats is written once, then as a count", async () => {
    const f = fakeDeps();
    const log = createDebugLog(f.deps);
    for (let i = 0; i < 5; i++) log.record({ kind: "call", what: "sessions", ok: false, error: "timeout" });
    log.record({ kind: "action", what: "need" });
    await log.flush();
    expect(f.written[0].map((e) => [e.what, e.detail?.repeated])).toEqual([["sessions", undefined], ["sessions", 4], ["need", undefined]]);
  });
  it("off: nothing is kept or written, and it stays off across restarts", async () => {
    const f = fakeDeps();
    const log = createDebugLog(f.deps);
    log.record({ kind: "action", what: "a" });
    log.setEnabled(false);
    log.record({ kind: "action", what: "b" });
    await log.flush();
    expect(f.written).toEqual([]);
    expect(f.saved()).toBe("off");
    expect(createDebugLog(fakeDeps("off").deps).enabled()).toBe(false);
    expect(createDebugLog(fakeDeps(null).deps).enabled(), "on by default").toBe(true);
  });
  it("one write at a time: what arrives during a slow write goes in the next batch", async () => {
    const f = fakeDeps();
    let release: () => void = () => {};
    let inFlight = 0;
    let most = 0;
    const log = createDebugLog({
      ...f.deps,
      write: (b) => {
        inFlight++;
        most = Math.max(most, inFlight);
        f.written.push(b);
        return new Promise<void>((r) => (release = () => (inFlight--, r())));
      },
    });
    log.record({ kind: "action", what: "a" });
    const first = log.flush();
    log.record({ kind: "action", what: "b" });
    const second = log.flush();
    await Promise.resolve();
    expect(f.written.map((b) => b.map((e) => e.what))).toEqual([["a"]]);
    release();
    await first;
    await Promise.resolve();
    release();
    await second;
    expect(f.written.map((b) => b.map((e) => e.what))).toEqual([["a"], ["b"]]);
    expect(most).toBe(1);
  });
  it("a write that fails never reaches the app", async () => {
    const f = fakeDeps();
    const log = createDebugLog({ ...f.deps, write: async () => Promise.reject(new Error("no shell")) });
    log.record({ kind: "action", what: "a" });
    await expect(log.flush()).resolves.toBeUndefined();
  });
});

describe("installDebugLog", () => {
  it("follows the CLI's switch: off there (`agent-switch debug-log off`) is off here", async () => {
    const f = fakeDeps(null);
    const log = installDebugLog({ ...f.deps, readEnabled: async () => false }, { addEventListener: () => {} } as unknown as Pick<Window, "addEventListener">);
    await Promise.resolve();
    await Promise.resolve();
    expect(log.enabled()).toBe(false);
    expect(f.saved()).toBe("off");
  });

  it("records window errors and unhandled rejections, and flushes when the window closes", async () => {
    const f = fakeDeps();
    const handlers = new Map<string, (e: Event) => void>();
    const target = { addEventListener: vi.fn((type: string, h: (e: Event) => void) => void handlers.set(type, h)) } as unknown as Pick<Window, "addEventListener">;
    installDebugLog(f.deps, target);
    handlers.get("error")!({ message: "x is undefined", filename: "http://localhost/assets/V3App.tsx", lineno: 12 } as unknown as Event);
    handlers.get("unhandledrejection")!({ reason: new Error("spawn failed") } as unknown as Event);
    recordDebug({ kind: "action", what: "view" });
    handlers.get("beforeunload")!(new Event("beforeunload"));
    await Promise.resolve();
    expect(f.written[0].map((e) => [e.kind, e.what, e.error, e.detail?.at])).toEqual([
      ["error", "window error", "x is undefined", "V3App.tsx:12"],
      ["error", "unhandled rejection", "spawn failed", undefined],
      ["action", "view", undefined, undefined],
    ]);
  });
});
