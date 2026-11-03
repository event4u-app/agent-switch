import { describe, expect, it } from "vitest";
import { parseChanges, parseEngine, parseHistory, parseHostList, parseLibrary, parseOpenTargets, parsePrStatus } from "./feeds.js";

const junk = [null, undefined, 3, "x", [], { unrelated: true }];

describe("feed parsers", () => {
  it.each(junk)("never throw and return the empty state for %j", (v) => {
    expect(parseEngine(v)).toEqual({ running: false, reason: null, hostedRunning: 0 });
    expect(parseHostList(v)).toEqual({ mode: "ephemeral", hosted: [] });
    expect(parsePrStatus(v)).toEqual({ problem: null, byKey: {} });
    expect(parseOpenTargets(v)).toEqual({ default: null, perRepo: {}, targets: [] });
    expect(parseLibrary(v)).toEqual({ autoKeep: true, vaultBytes: 0, entries: [] });
    expect(parseChanges(v)).toEqual([]);
    expect(parseHistory(v)).toEqual([]);
  });

  it("engine: the CLI's status", () => {
    expect(parseEngine({ running: false, address: "/s", reason: "ECONNREFUSED", hostedRunning: 2, extra: 1 })).toEqual({ running: false, reason: "ECONNREFUSED", hostedRunning: 2 });
  });

  it("host list: keeps rows with a key, fills the rest", () => {
    const h = parseHostList({ mode: "persistent", hosted: [{ key: "claude/w/1", alive: true, cwd: "/r" }, { nokey: 1 }], legacy: [] });
    expect(h.mode).toBe("persistent");
    expect(h.hosted).toEqual([{ key: "claude/w/1", provider: "", account: "", sessionId: "", cwd: "/r", startedAt: "", alive: true }]);
  });

  it("pr status: by session key, a PR without a number is dropped, the problem is kept", () => {
    const s = parsePrStatus({
      problem: { message: "gh is not signed in", fix: "gh auth login" },
      sessions: [{ key: "claude/w/1", prs: [{ number: 7, url: "u", lifecycle: "OPEN", mergeable: "CONFLICTING", review: "APPROVED", ci: "FAILURE", failingChecks: ["lint", 3] }, { url: "x" }] }],
    });
    expect(s.problem).toEqual({ message: "gh is not signed in", fix: "gh auth login" });
    expect(s.byKey["claude/w/1"]).toEqual([{ number: 7, url: "u", lifecycle: "OPEN", mergeable: "CONFLICTING", review: "APPROVED", ci: "FAILURE", failingChecks: ["lint"] }]);
  });

  it("open targets: an unknown kind is dropped", () => {
    const o = parseOpenTargets({ default: "vscode", perRepo: { "/r": "finder", bad: 1 }, targets: [{ target: "vscode", label: "VS Code", kind: "editor", installed: true }, { target: "x", kind: "agent-app" }] });
    expect(o).toEqual({ default: "vscode", perRepo: { "/r": "finder" }, targets: [{ target: "vscode", label: "VS Code", kind: "editor", installed: true }] });
  });

  it("library: kept states and a PR", () => {
    const l = parseLibrary({
      autoKeep: false,
      vaultBytes: 42,
      entries: [
        { key: "a", pinned: true, kept: { state: "kept", bytes: 9 }, pr: { number: 3, lifecycle: "OPEN" }, tags: ["x", 1], lastMs: 5 },
        { key: "b", kept: { state: "at-risk", daysLeft: 4 } },
        { key: "c", kept: { state: "weird" } },
      ],
    });
    expect(l.autoKeep).toBe(false);
    expect(l.vaultBytes).toBe(42);
    expect(l.entries.map((e) => e.kept)).toEqual([{ state: "kept", bytes: 9 }, { state: "at-risk", daysLeft: 4 }, { state: "lost" }]);
    expect(l.entries[0]).toMatchObject({ pinned: true, pr: { number: 3, lifecycle: "OPEN" }, tags: ["x"], lastMs: 5 });
  });

  it("changes: only known statuses", () => {
    expect(parseChanges({ files: [{ status: "M", path: "a", added: 1, removed: 2 }, { status: "Z", path: "b" }] })).toEqual([{ status: "M", path: "a", added: 1, removed: 2 }]);
  });

  it("history: rows need an id and a time", () => {
    expect(parseHistory([{ id: "1", kind: "approval", who: "w", what: "x", doneAt: "2026-11-03T08:00:00Z" }, { id: "2" }])).toEqual([{ id: "1", kind: "approval", who: "w", what: "x", doneAt: "2026-11-03T08:00:00Z" }]);
  });
});
