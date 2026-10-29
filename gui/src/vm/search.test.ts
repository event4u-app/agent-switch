import { describe, it, expect } from "vitest";
import { buildSearchIndex, filterSearch, SEARCH_LIMIT } from "./search.js";
import { accountFromProfile, sessionFromRow } from "./build.js";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const accounts = [
  accountFromProfile({ provider: "claude", name: "work", identity: "w@x.example", label: "Work", active: true, liveSessions: 1 }, null),
];
const sessions = [
  sessionFromRow(
    { provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "/p", cwd: "/Users/m/dev/agent-config", mtimeMs: NOW, live: true, summary: "Edge filter" },
    NOW,
  ),
];
const index = buildSearchIndex({ accounts, sessions, rules: [], tools: [] });

describe("command search", () => {
  it("needs two characters at the top level", () => {
    expect(filterSearch(index, [], "a", "all").all).toEqual([]);
  });
  it("matches text and meta, counts per kind and keeps the kind order", () => {
    const r = filterSearch(index, [], "work", "all");
    expect(r.order).toEqual(["account", "session"]);
    expect(r.counts).toEqual({ account: 1, session: 1 });
  });
  it("drills into an account's sessions without a query", () => {
    const acc = index.find((i) => i.kind === "account")!;
    const r = filterSearch(index, [{ crumb: acc.text, kids: acc.kids!, q: "work", kind: "all", index: 0 }], "", "all");
    expect(r.shown.map((i) => i.text)).toEqual(["agent-config · Edge filter"]);
  });
  it("falls back to all when the chosen kind has no hits, and caps the list", () => {
    expect(filterSearch(index, [], "work", "tool").kind).toBe("all");
    expect(filterSearch(index, [], "se", "all").shown.length).toBeLessThanOrEqual(SEARCH_LIMIT);
  });
  it("groups sessions by folder as projects", () => {
    expect(index.find((i) => i.kind === "project")).toMatchObject({ text: "agent-config", meta: "~/dev/agent-config" });
  });
  it("offers no project start for a session whose folder is unknown, but keeps the session", () => {
    const unknown = sessionFromRow(
      { provider: "claude", profile: "work", sessionId: "def67890", projectDir: "-Users-m-dev-x", cwd: null, mtimeMs: NOW, live: false, summary: "Old" },
      NOW,
    );
    const idx = buildSearchIndex({ accounts, sessions: [unknown], rules: [], tools: [] });
    expect(idx.filter((i) => i.kind === "project")).toEqual([]);
    expect(idx.some((i) => i.kind === "session" && i.text.includes("Old"))).toBe(true);
  });
});
