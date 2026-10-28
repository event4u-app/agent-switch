import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppNotification } from "../../notifications.js";
import type { UsageSnapshot } from "../../transforms.js";
import type { ReleaseInfo, UpdateCheck } from "../../updates.js";
import type { Actions } from "../../vm/actions.js";
import { emptyViewModel } from "../../vm/load.js";
import type { Account, ViewModel } from "../../vm/types.js";
import { loadUsage, type UsageDeps } from "../../vm/usage-loader.js";
import { getUsageAttempts, loadUsageCache, markUsageAttempt, saveUsageSnapshot } from "../../usage-cache.js";
import { nearLimitMessage } from "./near-limit.js";
import { deliver, freshSince, toastFor, type FireContext, type FireSinks } from "./notifications.js";
import { petRoute, petStartup } from "./pet.js";
import { reconcileShare } from "./startup.js";
import { withSwitchEffects } from "./switch-effects.js";
import { checkAgentConfigUpdate, DAY_MS, runAutoUpdateCheck, updateDue, type AgentConfigWatchDeps, type AutoUpdateDeps } from "./updates.js";
import { installMemoryStorage } from "./test-storage.js";
import { usageTick } from "./usage-refresh.js";

beforeEach(installMemoryStorage);

const n = (id: string, ts: number, over: Partial<AppNotification> = {}): AppNotification => ({
  id,
  ts,
  kind: "warning",
  title: `T${id}`,
  message: `M${id}`,
  ...over,
});

function sinks(desktopShown = true) {
  const log = { pet: [] as string[], desktop: [] as string[], toast: [] as string[] };
  const s: FireSinks = {
    pet: (x) => void log.pet.push(x.id),
    desktop: async (title) => {
      log.desktop.push(title);
      return desktopShown;
    },
    toast: (x) => void log.toast.push(x.id),
  };
  return { s, log };
}

const ctx = (over: Partial<FireContext> = {}): FireContext => ({
  petEnabled: false,
  petTier: "hybrid",
  petKinds: [],
  muted: [],
  osNotify: true,
  ...over,
});

describe("notification fire path", () => {
  it("delivers only events newer than the high-water mark (nothing from before the window opened)", () => {
    const r = freshSince([n("a", 5), n("b", 10), n("c", 15)], 10);
    expect(r.fresh.map((x) => x.id)).toEqual(["c"]);
    expect(r.since).toBe(15);
    expect(freshSince([n("a", 5)], 10)).toEqual({ fresh: [], since: 10 });
  });

  it("shows an in-window toast when a fresh event cannot reach the desktop", async () => {
    const { s, log } = sinks(false);
    await deliver([n("a", 1)], ctx(), s);
    expect(log.desktop).toEqual(["Ta"]);
    expect(log.toast).toEqual(["a"]);
  });

  it("does not toast when the desktop notification was delivered", async () => {
    const { s, log } = sinks(true);
    await deliver([n("a", 1)], ctx(), s);
    expect(log.toast).toEqual([]);
  });

  it("skips desktop + toast for events the daemon already showed, and for muted kinds", async () => {
    const { s, log } = sinks(false);
    await deliver([n("a", 1, { osNotified: true }), n("b", 2, { kind: "info" })], ctx({ muted: ["info"] }), s);
    expect(log.desktop).toEqual([]);
    expect(log.toast).toEqual([]);
  });

  it("with Desktop notifications OFF never desktop-notifies — the toast stands in", async () => {
    const { s, log } = sinks(true);
    await deliver([n("a", 1)], ctx({ osNotify: false }), s);
    expect(log.desktop).toEqual([]);
    expect(log.toast).toEqual(["a"]);
  });

  it("routes to the pet by the pet's own kinds; pet-only replaces desktop + toast", async () => {
    const hybrid = sinks(false);
    await deliver([n("a", 1), n("b", 2, { kind: "info" })], ctx({ petEnabled: true, petKinds: ["warning"] }), hybrid.s);
    expect(hybrid.log.pet).toEqual(["a"]);
    expect(hybrid.log.toast).toEqual(["a", "b"]);
    const only = sinks(false);
    await deliver([n("a", 1)], ctx({ petEnabled: true, petTier: "pet-only", petKinds: ["warning"] }), only.s);
    expect(only.log.pet).toEqual(["a"]);
    expect(only.log.toast).toEqual([]);
  });

  it("delivers at most five per sync and tones the toast by kind", async () => {
    const { s, log } = sinks(false);
    await deliver(["1", "2", "3", "4", "5", "6"].map((id, i) => n(id, i)), ctx(), s);
    expect(log.toast).toHaveLength(5);
    expect(toastFor(n("x", 1, { kind: "error" }))).toEqual({ text: "Tx — Mx", tone: "alert" });
  });
});

const snap = (pct: number, capturedAt = "2026-10-01T00:00:00Z", resetsAt: string | null = null): UsageSnapshot => ({
  windows: [{ key: "seven_day", label: "Week", utilization: pct, resetsAt } as UsageSnapshot["windows"][number]],
  routines: null,
  capturedAt,
});

describe("usage loading (cache + cooldown)", () => {
  beforeEach(() => localStorage.clear());

  function deps(result: (p: string, name: string) => UsageSnapshot | null) {
    const calls: string[] = [];
    const failures: string[] = [];
    const d: UsageDeps = {
      fetch: async (p, name) => {
        calls.push(`${p}/${name}`);
        return result(p, name);
      },
      onFailure: async (p, name) => void failures.push(`${p}/${name}`),
      sleep: async () => {},
      now: () => 1_000_000,
    };
    return { d, calls, failures };
  }

  it("fetches due accounts, caches the snapshot and records the attempt", async () => {
    const { d, calls } = deps(() => snap(40));
    const out = await loadUsage([{ provider: "claude", name: "a" }, { provider: "antigravity", name: "g" }], { force: false, cooldownMs: 600_000 }, d);
    expect(calls).toEqual(["claude/a"]); // no readout for antigravity
    expect(out[0]?.windows[0].utilization).toBe(40);
    expect(out[1]).toBeNull();
    expect(loadUsageCache()["claude/a"].snap.windows[0].utilization).toBe(40);
    expect(getUsageAttempts()["claude/a"]).toBe(1_000_000);
  });

  it("serves the cached snapshot inside the cooldown; a manual refresh (force) fetches anyway", async () => {
    saveUsageSnapshot("claude/a", snap(10));
    markUsageAttempt("claude/a", 999_000);
    const { d, calls } = deps(() => snap(70));
    const cached = await loadUsage([{ provider: "claude", name: "a" }], { force: false, cooldownMs: 600_000 }, d);
    expect(calls).toEqual([]);
    expect(cached[0]?.windows[0].utilization).toBe(10);
    const forced = await loadUsage([{ provider: "claude", name: "a" }], { force: true, cooldownMs: 600_000 }, d);
    expect(calls).toEqual(["claude/a"]);
    expect(forced[0]?.windows[0].utilization).toBe(70);
  });

  it("records a warning per failed fetch and keeps the last snapshot (with its own age)", async () => {
    saveUsageSnapshot("claude/a", snap(10));
    const { d, failures } = deps(() => null);
    const out = await loadUsage([{ provider: "claude", name: "a" }], { force: true }, d);
    expect(failures).toEqual(["claude/a"]);
    expect(out[0]?.windows[0].utilization).toBe(10);
  });

  it("never loses a reset time once seen", async () => {
    saveUsageSnapshot("claude/a", snap(10, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"));
    const { d } = deps(() => snap(20));
    const out = await loadUsage([{ provider: "claude", name: "a" }], { force: true }, d);
    expect(out[0]?.windows[0].resetsAt).toBe("2026-10-02T00:00:00Z");
  });

  it("spaces consecutive Claude fetches; local readouts run alongside", async () => {
    const order: string[] = [];
    const { d } = deps(() => snap(1));
    d.sleep = async (ms) => void order.push(`sleep${ms}`);
    const fetch = d.fetch;
    d.fetch = async (p, name) => {
      order.push(`${p}/${name}`);
      return fetch(p, name);
    };
    await loadUsage(
      [{ provider: "claude", name: "a" }, { provider: "claude", name: "b" }, { provider: "codex", name: "c" }],
      { force: true, staggerMs: 7 },
      d,
    );
    expect(order.filter((x) => x.startsWith("claude") || x.startsWith("sleep"))).toEqual(["claude/a", "sleep7", "claude/b"]);
    expect(order).toContain("codex/c");
  });
});

describe("usage auto-refresh tick", () => {
  it("reloads when the deadline passed and auto-refresh is on, then pushes it a full interval", () => {
    const st = { minutes: 10 };
    expect(usageTick(st, 1000, { minutes: 10, autoRefresh: true, deadline: 500 })).toEqual({ deadline: 1000 + 600_000, reload: true });
    expect(usageTick(st, 1000, { minutes: 10, autoRefresh: false, deadline: 500 })).toEqual({ deadline: null, reload: false });
    expect(usageTick(st, 1000, { minutes: 10, autoRefresh: true, deadline: 5000 })).toEqual({ deadline: null, reload: false });
  });

  it("re-bases the deadline when the interval changes, and seeds a missing one", () => {
    const st = { minutes: 10 };
    expect(usageTick(st, 1000, { minutes: 5, autoRefresh: true, deadline: 500 })).toEqual({ deadline: 1000 + 300_000, reload: false });
    expect(st.minutes).toBe(5);
    expect(usageTick(st, 1000, { minutes: 5, autoRefresh: true, deadline: 0 })).toEqual({ deadline: 1000 + 300_000, reload: false });
  });
});

const release = (tag: string, notes = ""): ReleaseInfo => ({ tag, name: tag, url: `https://x/${tag}`, notes, publishedAt: "2026-10-01T00:00:00Z" });

describe("agent-switch auto-update loop", () => {
  function deps(check: UpdateCheck, ok = true, kinds: AutoUpdateDeps["kinds"] = () => ["patch", "minor"]) {
    const calls = { install: 0, notified: "" as string, notes: [] as string[] };
    const d: AutoUpdateDeps = {
      check: async () => check,
      install: async () => {
        calls.install++;
        return { ok, output: "" };
      },
      kinds,
      notified: () => calls.notified,
      markNotified: (t) => void (calls.notified = t),
      notify: async (kind, title) => void calls.notes.push(`${kind}:${title}`),
    };
    return { d, calls };
  }

  it("installs an enabled bump kind and announces it once", async () => {
    const { d, calls } = deps({ kind: "available", current: "1.0.0", release: release("v1.0.1") });
    await runAutoUpdateCheck(d);
    expect(calls.install).toBe(1);
    expect(calls.notes).toEqual(["success:Updated to v1.0.1"]);
    await runAutoUpdateCheck(d);
    expect(calls.install).toBe(1);
  });

  it("a failed install is not marked handled, so the next check retries", async () => {
    const { d, calls } = deps({ kind: "available", current: "1.0.0", release: release("v1.0.1") }, false);
    await runAutoUpdateCheck(d);
    await runAutoUpdateCheck(d);
    expect(calls.install).toBe(2);
    expect(calls.notes[0]).toBe("warning:Update to v1.0.1 failed");
  });

  it("a disabled kind only notifies, once", async () => {
    const { d, calls } = deps({ kind: "available", current: "1.0.0", release: release("v2.0.0") });
    await runAutoUpdateCheck(d);
    await runAutoUpdateCheck(d);
    expect(calls.install).toBe(0);
    expect(calls.notes).toEqual(["info:Update available — v2.0.0"]);
  });

  it("runs on open, when the toggle comes on, and then once a day", () => {
    const st = { wasOn: false, lastRun: null as number | null };
    expect(updateDue(st, true, 0)).toBe(true);
    expect(updateDue(st, true, 1000)).toBe(false);
    expect(updateDue(st, true, DAY_MS)).toBe(true);
    expect(updateDue(st, false, DAY_MS + 1)).toBe(false);
    expect(updateDue(st, true, DAY_MS + 2)).toBe(true);
  });
});

describe("agent-config update watch", () => {
  function deps(over: Partial<AgentConfigWatchDeps>) {
    const notes: string[] = [];
    let notified = "";
    const d: AgentConfigWatchDeps = {
      current: async () => "1.0.0",
      releases: async () => [release("1.2.0", "## Highlights\n- Faster audits\n"), release("1.1.0")],
      latest: async () => release("1.2.0"),
      notified: () => notified,
      markNotified: (v) => void (notified = v),
      notify: async (_k, title, message) => void notes.push(`${title}|${message}`),
      ...over,
    };
    return { d, notes };
  }

  it("notifies once per version when installed and outdated, with the release's own highlight", async () => {
    const { d, notes } = deps({});
    await checkAgentConfigUpdate(d);
    await checkAgentConfigUpdate(d);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^agent-config update available\|v1\.0\.0 → v1\.2\.0 — Faster audits/);
  });

  it("does not notify when agent-config is not installed", async () => {
    const { d, notes } = deps({ current: async () => null });
    await checkAgentConfigUpdate(d);
    expect(notes).toEqual([]);
  });

  it("falls back to the single-release check when the list fails", async () => {
    const { d, notes } = deps({ releases: async () => Promise.reject(new Error("rate limited")) });
    await checkAgentConfigUpdate(d);
    expect(notes[0]).toMatch(/v1\.0\.0 → v1\.2\.0 · read/);
  });
});

function account(name: string, over: Partial<Account> = {}): Account {
  return {
    id: `claude:${name}`,
    tool: "claude",
    name,
    identity: null,
    plan: null,
    label: null,
    color: "blue",
    isDefault: false,
    state: "ready",
    windows: [{ key: "seven_day", label: "Week", utilization: 20, resetsAt: null }],
    checkedAt: 0,
    resetCredits: null,
    threshold: 98,
    protection: null,
    auth: null,
    surfaces: [],
    liveSessions: 0,
    pools: [],
    ...over,
  } as Account;
}

describe("near-limit threshold test fire", () => {
  const accounts = [
    account("work", { isDefault: true, windows: [{ key: "seven_day", label: "Week", utilization: 92, resetsAt: null }] }),
    account("side", { windows: [{ key: "seven_day", label: "Week", utilization: 30, resetsAt: null }] }),
  ];
  it("fires the daemon's message when the active account already sits past the new threshold", () => {
    expect(nearLimitMessage(accounts, "claude", 90)).toBe(
      "claude/work hit ≥90% — suggested profile: claude/side. Run `agent-switch rebind` to switch (no automatic switch).",
    );
  });
  it("stays silent above current usage, without a target, or for a tag no one carries", () => {
    expect(nearLimitMessage(accounts, "claude", 95)).toBeNull();
    expect(nearLimitMessage(accounts.slice(0, 1), "claude", 90)).toBeNull();
    expect(nearLimitMessage(accounts, "claude", 90, "Work")).toBeNull();
  });
});

describe("account switch side effects", () => {
  function wrap(notifyOn: boolean) {
    const notes: string[] = [];
    const relinks: number[] = [];
    const base: Actions = { setDefault: vi.fn(async () => {}), deactivate: vi.fn(async () => {}), rebind: vi.fn(async () => {}) };
    const vm: ViewModel = { ...emptyViewModel(), accounts: [account("work", { isDefault: true })] };
    const a = withSwitchEffects(base, () => vm, {
      notifyOnSwitch: () => notifyOn,
      relink: async () => void relinks.push(1),
      notify: async (kind, title, message) => void notes.push(`${kind}|${title}|${message}`),
    });
    return { a, base, notes, relinks };
  }

  it("activating records a switch notification and relinks the shared setup", async () => {
    const { a, base, notes, relinks } = wrap(true);
    await a.setDefault!("claude:side");
    expect(base.setDefault).toHaveBeenCalledWith("claude:side");
    expect(relinks).toHaveLength(1);
    expect(notes).toEqual(["success|Account switched|Claude is now using side."]);
  });

  it("records nothing when notify-on-switch is off", async () => {
    const { a, notes } = wrap(false);
    await a.setDefault!("claude:side");
    expect(notes).toEqual([]);
  });

  it("deactivating names the account that was active", async () => {
    const { a, notes } = wrap(true);
    await a.deactivate!("claude");
    expect(notes).toEqual(["success|Account deactivated|Deactivated the active Claude account (work)."]);
  });

  it("a live rebind relinks too", async () => {
    const { a, relinks } = wrap(true);
    await a.rebind!("claude:s1", "claude:side");
    expect(relinks).toHaveLength(1);
  });
});

describe("shared setup reconcile", () => {
  function deps(profiles: { name: string; shared: boolean }[], active: boolean, pref: boolean) {
    const ran: string[] = [];
    return {
      ran,
      d: {
        status: async () => ({ active, source: "default", profiles }),
        on: async (src: string) => void ran.push(`on:${src}`),
        off: async () => void ran.push("off"),
        pref: () => pref,
        source: () => "work",
      },
    };
  }
  it("links unlinked profiles when the preference is on", async () => {
    const { d, ran } = deps([{ name: "a", shared: true }, { name: "b", shared: false }], true, true);
    expect(await reconcileShare(d)).toBe("linked");
    expect(ran).toEqual(["on:work"]);
  });
  it("removes the links when the preference is off", async () => {
    const { d, ran } = deps([{ name: "a", shared: true }], true, false);
    expect(await reconcileShare(d)).toBe("unlinked");
    expect(ran).toEqual(["off"]);
  });
  it("does nothing when already in line", async () => {
    const { d, ran } = deps([{ name: "a", shared: true }], true, true);
    expect(await reconcileShare(d)).toBe("none");
    expect(ran).toEqual([]);
  });
});

describe("pet", () => {
  afterEach(() => localStorage.clear());

  it("routes bubble clicks to the matching place — navigation only", () => {
    const limit = { id: "limit:claude:work", kind: "near-limit" as const, title: "", detail: "", primary: "", at: 0 };
    expect(petRoute("switch", [limit])).toEqual({ open: { kind: "limit", attentionId: "limit:claude:work" } });
    expect(petRoute("switch", [])).toEqual({ open: { kind: "notifications" } });
    expect(petRoute("updates", [])).toEqual({ go: "settings", tab: "updates" });
    expect(petRoute("ecosystem", [])).toEqual({ go: "tools" });
    expect(petRoute("tooling", [])).toEqual({ go: "tools" });
    expect(petRoute("pet-settings", [])).toEqual({ go: "settings", tab: "pet" });
  });

  it("plays the welcome once when the pet is enabled, and nothing when it is off", async () => {
    const d = {
      claimPetWelcome: vi.fn(async () => true),
      petShow: vi.fn(async () => true),
      petEmitNotification: vi.fn(async () => {}),
      sleep: async () => {},
    };
    await petStartup(d);
    expect(d.petEmitNotification).toHaveBeenCalledWith("info", expect.stringContaining(""), "pet-settings", true);
    d.claimPetWelcome.mockResolvedValue(false);
    await petStartup(d);
    expect(d.petEmitNotification).toHaveBeenCalledTimes(1);
    localStorage.setItem("agent-switch-pet-enabled", "off");
    d.claimPetWelcome.mockClear();
    await petStartup(d);
    expect(d.claimPetWelcome).not.toHaveBeenCalled();
  });
});
