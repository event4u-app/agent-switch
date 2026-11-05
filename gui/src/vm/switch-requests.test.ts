import { describe, expect, it } from "vitest";
import type { SwitchRequestRow } from "../ipc.js";
import { answeredElsewhere, askedByAgentConfig, cliAccount, cliSession, openRequestFor } from "./switch-requests.js";

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
