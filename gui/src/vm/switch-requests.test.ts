import { describe, expect, it } from "vitest";
import type { SwitchRequestRow } from "../ipc.js";
import { answeredElsewhere, askedByAgentConfig, cliAccount, cliSession, openRequestFor, paceAttention } from "./switch-requests.js";
import type { Account } from "./types.js";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const later = new Date(NOW + 3_600_000).toISOString();
const earlier = new Date(NOW - 60_000).toISOString();

function row(over: Partial<SwitchRequestRow>): SwitchRequestRow {
  return {
    id: "r1",
    rev: 1,
    session: null,
    account: "claude/work",
    reason: { window: "five_hour", fill: 92, resetsAt: later },
    raisedBy: "as-daemon",
    raisedAt: new Date(NOW).toISOString(),
    expiresAt: later,
    state: "open",
    candidates: [],
    ...over,
  };
}

describe("switch requests in the app", () => {
  it("maps app ids to CLI keys", () => {
    expect(cliAccount("claude:work")).toBe("claude/work");
    expect(cliSession("claude:work", "claude:abc-123")).toBe("claude/work/abc-123");
  });

  it("finds the session's own request before the account-wide one", () => {
    const rows = [row({ id: "acct" }), row({ id: "mine", session: "claude/work/abc" }), row({ id: "other", session: "claude/work/zzz" })];
    expect(openRequestFor(rows, "claude:work", "claude:abc", NOW)?.id).toBe("mine");
    expect(openRequestFor(rows, "claude:work", "claude:nope", NOW)?.id).toBe("acct");
    expect(openRequestFor([row({ id: "other", session: "claude/work/zzz" })], "claude:work", "claude:nope", NOW)).toBeNull();
  });

  it("ignores decided, expired and other accounts' requests", () => {
    expect(openRequestFor([row({ state: "approved" })], "claude:work", null, NOW)).toBeNull();
    expect(openRequestFor([row({ expiresAt: earlier })], "claude:work", null, NOW)).toBeNull();
    expect(openRequestFor([row({ account: "claude/home" })], "claude:work", null, NOW)).toBeNull();
  });

  it("knows when agent-config already answered this cycle, and ignores the app's own answers", () => {
    const at = new Date(NOW).toISOString();
    expect(answeredElsewhere([row({ state: "approved", decision: { kind: "approve", target: "claude/home", how: "now", by: "ac:claude-code", at } })], "claude:work", NOW)?.id).toBe("r1");
    expect(answeredElsewhere([row({ state: "done", decision: { kind: "approve", target: "claude/home", how: "now", by: "as-gui", at } })], "claude:work", NOW)).toBeNull();
    expect(answeredElsewhere([row({ state: "declined", expiresAt: earlier, decision: { kind: "decline", by: "ac:x", at } })], "claude:work", NOW)).toBeNull();
    expect(answeredElsewhere([row({})], "claude:work", NOW)).toBeNull();
  });

  it("tells an agent-config question from the app's own", () => {
    expect(askedByAgentConfig(row({ raisedBy: "ac" }))).toBe(true);
    expect(askedByAgentConfig(row({}))).toBe(false);
    expect(askedByAgentConfig(null)).toBe(false);
  });
});

describe("pace requests in the app", () => {
  const pace = (over: Partial<SwitchRequestRow> = {}) =>
    row({
      id: "p1",
      session: "claude/work/abc",
      reason: { kind: "pace", window: "seven_day", fill: 60, resetsAt: new Date(NOW + 48 * 3_600_000).toISOString(), etaFull: 6, burnPerHour: 6 },
      candidates: [{ target: "claude/home", provider: "claude", fill: 10, resetsAt: null, how: ["after-turn", "now"], spareAtReset: 80 }],
      ...over,
    });
  const acct = (id: string, over: Partial<Account> = {}) => ({ id, name: id.split(":")[1], tool: "claude", disabled: false, ...over }) as Account;
  const accounts = [acct("claude:work"), acct("claude:home")];

  it("an open pace request is an attention item that names both accounts, keyed by the request", () => {
    const [item] = paceAttention([pace()], accounts, NOW);
    expect(item.kind).toBe("pace");
    expect(item.id).toBe("pace:p1");
    expect(item.accountId).toBe("claude:work");
    expect(item.sessionId).toBe("claude:abc");
    expect(item.title).toContain("work");
    expect(item.detail).toContain("home");
    expect(item.detail).toContain("80");
  });

  it("an answered, expired or unknown-account pace request raises nothing", () => {
    expect(paceAttention([pace({ state: "declined" })], accounts, NOW)).toEqual([]);
    expect(paceAttention([pace({ expiresAt: earlier })], accounts, NOW)).toEqual([]);
    expect(paceAttention([pace({ account: "claude/gone" })], accounts, NOW)).toEqual([]);
    expect(paceAttention([row({})], accounts, NOW)).toEqual([]); // a limit request is not a pace item
  });

  it("a pace answer in agent-config does not count as answering the limit", () => {
    const at = new Date(NOW).toISOString();
    expect(answeredElsewhere([pace({ state: "declined", decision: { kind: "decline", by: "ac:claude-code", at } })], "claude:work", NOW)).toBeNull();
  });

  it("the sheet finds the request of its own kind", () => {
    const rows = [pace(), row({ id: "lim", session: "claude/work/abc" })];
    expect(openRequestFor(rows, "claude:work", "claude:abc", NOW)?.id).toBe("lim");
    expect(openRequestFor(rows, "claude:work", "claude:abc", NOW, "pace")?.id).toBe("p1");
    expect(openRequestFor([pace()], "claude:work", "claude:abc", NOW)).toBeNull();
  });
});
