import { describe, expect, it } from "vitest";
import type { SwitchRequestRow } from "../ipc.js";
import { answeredElsewhere, askedByAgentConfig, cliAccount, cliSession, openRequestFor, resumeArgs, serviceOutcomes } from "./switch-requests.js";

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

describe("serviceOutcomes (road-to-service-executed-moves 3.2)", () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const gui = (decidedAt: string) => ({ kind: "approve", target: "claude/home", how: "now", by: "as-gui", at: decidedAt });
  it("lists requests answered in the app and finished by the service, since a moment", () => {
    const rows = [
      row({ id: "done", state: "done", decision: gui(at(0)), outcome: { at: at(4_000), ok: true, detail: "moved" } }),
      row({ id: "failed", state: "failed", decision: gui(at(0)), outcome: { at: at(4_000), ok: false, detail: "refused" } }),
      // Carried out by the app itself (--executed): one write, one timestamp.
      row({ id: "app", state: "done", decision: gui(at(0)), outcome: { at: at(0), ok: true, detail: "moved in the app" } }),
      // Answered in agent-config: agent-config tells the user.
      row({ id: "ac", state: "done", decision: { ...gui(at(0)), by: "ac:claude" }, outcome: { at: at(4_000), ok: true, detail: "moved" } }),
      // Still running, or finished before the window started.
      row({ id: "running", state: "executing", decision: gui(at(0)) }),
      row({ id: "old", state: "done", decision: gui(at(-90_000)), outcome: { at: at(-60_000), ok: true, detail: "moved" } }),
    ];
    expect(serviceOutcomes(rows, NOW).map((r) => r.id)).toEqual(["done", "failed"]);
  });
});

describe("resumeArgs", () => {
  it("turns the service's resume command into agent-switch args, quotes included", () => {
    expect(resumeArgs("agent-switch run b -- --resume sid-1")).toEqual(["run", "b", "--", "--resume", "sid-1"]);
    expect(resumeArgs("agent-switch run two --provider codex -- resume sid-2 'Continue where you left off.'")).toEqual(["run", "two", "--provider", "codex", "--", "resume", "sid-2", "Continue where you left off."]);
    expect(resumeArgs("agent-switch run b -- 'it'\\''s'")).toEqual(["run", "b", "--", "it's"]);
  });
  it("refuses anything that is not an agent-switch command", () => {
    expect(resumeArgs("rm -rf ~")).toBeNull();
    expect(resumeArgs("agent-switch run 'unclosed")).toBeNull();
    expect(resumeArgs("agent-switch")).toBeNull();
  });
});
