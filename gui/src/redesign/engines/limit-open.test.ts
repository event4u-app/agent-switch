import { describe, expect, it } from "vitest";
import type { Account, Attention } from "../../vm/types.js";
import { nearLimitToOpen } from "./limit-open.js";

const acct = (over: Partial<Account>): Account =>
  ({ id: "claude:side", tool: "claude", name: "side", state: "near-limit", threshold: 98, windows: [{ key: "five_hour", label: "5h", utilization: 94, resetsAt: "2026-11-04T13:00:00Z" }], liveSessions: 1, ...over }) as Account;
const item: Attention = { id: "limit:claude:side", kind: "near-limit", title: "t", detail: "d", accountId: "claude:side", primary: "Decide", at: 1 };

describe("2.11 limit auto-open", () => {
  it("opens only at the limit (the protection threshold), not merely near it", () => {
    expect(nearLimitToOpen([item], [acct({})], new Set())).toBeNull();
    const hit = nearLimitToOpen([item], [acct({ windows: [{ key: "five_hour", label: "5h", utilization: 98, resetsAt: "2026-11-04T13:00:00Z" }] })], new Set());
    expect(hit?.item.id).toBe("limit:claude:side");
    expect(hit?.mark).toEqual({ id: "limit:claude:side", version: "five_hour:2026-11-04T13:00:00Z" });
  });

  it("once per reset cycle", () => {
    const limited = acct({ state: "limited", windows: [{ key: "five_hour", label: "5h", utilization: 100, resetsAt: "2026-11-04T13:00:00Z" }] });
    expect(nearLimitToOpen([item], [limited], new Set(["limit:claude:side@five_hour:2026-11-04T13:00:00Z"]))).toBeNull();
    const next = acct({ state: "limited", windows: [{ key: "five_hour", label: "5h", utilization: 100, resetsAt: "2026-11-04T18:00:00Z" }] });
    expect(nearLimitToOpen([item], [next], new Set(["limit:claude:side@five_hour:2026-11-04T13:00:00Z"]))).not.toBeNull();
  });

  it("stays closed when agent-config already answered this account's limit", () => {
    const limited = acct({ state: "limited", windows: [{ key: "five_hour", label: "5h", utilization: 100, resetsAt: "2026-11-04T13:00:00Z" }] });
    expect(nearLimitToOpen([item], [limited], new Set(), { answered: () => true })).toBeNull();
    expect(nearLimitToOpen([item], [limited], new Set(), { answered: () => false })).not.toBeNull();
  });

  it("opens before the limit when agent-config asked, once per request", () => {
    const near = acct({});
    const hit = nearLimitToOpen([item], [near], new Set(), { requested: () => "req1" });
    expect(hit?.mark).toEqual({ id: "limit:claude:side", version: "request:req1" });
    expect(nearLimitToOpen([item], [near], new Set(["limit:claude:side@request:req1"]), { requested: () => "req1" })).toBeNull();
  });

  it("never opens a pace suggestion by itself — it waits in the list, even at the limit", () => {
    const pace: Attention = { ...item, id: "pace:p1", kind: "pace" };
    const limited = acct({ state: "limited", windows: [{ key: "five_hour", label: "5h", utilization: 100, resetsAt: "2026-11-04T13:00:00Z" }] });
    expect(nearLimitToOpen([pace], [limited], new Set(), { requested: () => "p1" })).toBeNull();
  });
});
