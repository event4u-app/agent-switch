// Property tests for src/dir-resolve.ts (roadmap 4.4, v15 plan AS-003).
// Generated inputs from a seeded PRNG — no dependency, reproducible: a failure
// names the seed and the case index, and FUZZ_SEED re-runs one seed.
import { test } from "node:test";
import assert from "node:assert/strict";

const R = await import("../src/dir-resolve.js");
import type { ProviderId } from "../src/providers.js";
import type { GuardPolicy } from "../src/single-load.js";
import type { UsageSnapshot } from "../src/usage.js";
import type { Pool } from "../src/pools.js";

const CASES = 1500;
const SEED = Number(process.env.FUZZ_SEED ?? 0x5eed_4a4);
const NOW = Date.parse("2026-11-01T12:00:00Z");

/** mulberry32 — 32-bit state, good enough to spread cases. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const chance = (p: number) => next() < p;
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const subset = <T>(xs: readonly T[], p: number) => xs.filter(() => chance(p));
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let k = out.length - 1; k > 0; k--) {
      const j = int(0, k);
      [out[k], out[j]] = [out[j], out[k]];
    }
    return out;
  };
  return { next, int, chance, pick, subset, shuffle };
}
type Rng = ReturnType<typeof prng>;

/** What the generator knows about one profile — the test's own model of the world. */
interface Prof {
  exists: boolean;
  disabled: boolean;
  shares: boolean;
  signedIn: boolean;
  live: boolean;
  threshold: number;
  usage: { kind: "unknown" } | { kind: "stale" | "fresh"; utils: (number | null)[]; ageMs: number };
}

const NAMES = ["a", "b", "c", "d", "e", "f", "work", "priv"];

function genProf(r: Rng): Prof {
  const kind = r.pick(["unknown", "stale", "fresh", "fresh"] as const);
  const threshold = r.pick([95, 95, 80, 50]);
  const utils = Array.from({ length: r.int(1, 3) }, () => (r.chance(0.1) ? null : r.int(0, 100)));
  const usage: Prof["usage"] =
    kind === "unknown"
      ? { kind }
      : {
          kind,
          utils,
          ageMs: kind === "fresh" ? r.int(0, R.FRESH_USAGE_MS) : r.int(R.FRESH_USAGE_MS + 1, 3 * 24 * 3_600_000),
        };
  return {
    exists: r.chance(0.85),
    disabled: r.chance(0.15),
    shares: r.chance(0.08),
    signedIn: r.chance(0.8),
    live: r.chance(0.3),
    threshold,
    usage,
  };
}

function snapshotOf(p: Prof): { snapshot: UsageSnapshot | null; capturedMs: number | null } {
  if (p.usage.kind === "unknown") return { snapshot: null, capturedMs: null };
  const at = NOW - p.usage.ageMs;
  const keys = ["five_hour", "seven_day", "seven_day_opus"];
  return {
    snapshot: {
      windows: p.usage.utils.map((u, k) => ({
        key: keys[k],
        label: keys[k],
        utilization: u,
        resetsAt: new Date(NOW + (k + 1) * 3 * 3_600_000).toISOString(),
      })),
      routines: null,
      capturedAt: new Date(at).toISOString(),
    },
    capturedMs: at,
  };
}

// Independent oracles, from the generator's model — not from the code under test.
const exists = (w: World, n: string) => w.profs[n]?.exists ?? false;
const takesWork = (w: World, n: string) => {
  const p = w.profs[n];
  return !!p && p.exists && !p.disabled && !p.shares && p.signedIn;
};
const usable = (w: World, n: string) => takesWork(w, n) && !(w.guard === "block" && w.profs[n].live);
/** Fresh numbers that leave room: the only usage that may count as capacity. */
const freshRoom = (w: World, n: string) => {
  const u = w.profs[n]?.usage;
  if (!u || u.kind !== "fresh") return false;
  const nums = u.utils.filter((x): x is number => typeof x === "number");
  return nums.length > 0 && nums.every((x) => x < w.profs[n].threshold);
};

interface World {
  providerId: ProviderId;
  profs: Record<string, Prof>;
  names: string[] | undefined;
  active: string | null;
  guard: GuardPolicy | undefined;
  mapping: { path: string; name: string } | null;
  pools: Record<string, Pool>;
}

function genWorld(r: Rng): World {
  const providerId = r.pick(["claude", "claude", "codex"] as const);
  const profs: Record<string, Prof> = {};
  for (const n of NAMES) profs[n] = genProf(r);
  const known = NAMES.filter((n) => profs[n].exists);
  const names = r.chance(0.8) ? r.shuffle(r.subset(known, 0.8)) : undefined;
  const active = r.chance(0.15) ? null : r.pick(NAMES);
  const guard = r.pick([undefined, "off", "warn", "block", "block"] as const);
  const otherProvider = providerId === "claude" ? "codex" : "claude";
  const memberPool = [
    ...NAMES.map((n) => `${providerId}/${n}`),
    `${otherProvider}/a`,
    `${otherProvider}/zz`,
    `${providerId}/ghost`, // a member key whose profile does not exist
  ];
  const pools: Record<string, Pool> = {};
  for (const id of ["work", "home"]) {
    if (r.chance(0.8)) pools[id] = { id, name: id, members: r.shuffle(r.subset(memberPool, 0.4)), createdAt: "" };
  }
  const shape = r.int(0, 2);
  const mapping =
    shape === 0
      ? null
      : shape === 1
        ? { path: "/home/u/proj", name: r.pick([...NAMES, "ghost"]) }
        : { path: "/home/u/proj", name: `pool:${r.pick(["work", "home", "gone"])}` };
  return { providerId, profs, names, active, guard, mapping, pools };
}

function inputsOf(w: World): Parameters<typeof R.resolveForDir>[0] {
  return {
    providerId: w.providerId,
    mapping: w.mapping,
    active: w.active,
    exists: (n) => exists(w, n),
    signedIn: (n) => w.profs[n]?.signedIn ?? false,
    disabled: (n) => w.profs[n]?.disabled ?? false,
    sharesDefaultLogin: (n) => w.profs[n]?.shares ?? false,
    names: w.names,
    threshold: (n) => w.profs[n]?.threshold ?? R.DEFAULT_LIMIT_PCT,
    pool: (id) => w.pools[id] ?? null,
    usage: (n) => (w.profs[n] ? snapshotOf(w.profs[n]) : { snapshot: null, capturedMs: null }),
    live: (n) => w.profs[n]?.live ?? false,
    guard: w.guard,
    now: NOW,
  };
}

function poolMembers(w: World, id: string): string[] {
  const p = w.pools[id];
  if (!p) return [];
  return p.members
    .map((m) => /^([a-z]+)\/([A-Za-z0-9_-]+)$/.exec(m))
    .filter((m): m is RegExpExecArray => !!m && m[1] === w.providerId)
    .map((m) => m[2]);
}

/** Every invariant for one world. Returns the resolution for follow-up checks. */
function check(w: World): ReturnType<typeof R.resolveForDir> {
  const res = R.resolveForDir(inputsOf(w));
  // Deterministic: same world, same answer.
  assert.deepEqual(R.resolveForDir(inputsOf(w)), res, "resolution is not deterministic");
  // `blocked` and a name are mutually exclusive.
  if (res.blocked !== undefined) assert.equal(res.name, null, "a refusal still carried a profile");

  if (w.mapping && w.mapping.name.startsWith("pool:")) {
    const id = w.mapping.name.slice(5);
    const members = poolMembers(w, id);
    const anyUsable = members.some((n) => usable(w, n));
    if (!anyUsable && members.some((n) => takesWork(w, n))) {
      // Every working member is busy: one is shared, never a refusal.
      assert.equal(res.blocked, undefined, `pool ${id} refused though a busy member could be shared`);
      assert.ok(res.name !== null && members.includes(res.name) && takesWork(w, res.name), `pool ${id} shared ${res.name}, not a working member`);
      assert.ok(res.note?.includes(`sharing ${w.providerId}/${res.name}`), "pool shared a busy member silently");
      return res;
    }
    if (!anyUsable) {
      // Fail-closed: a pool that cannot serve refuses, never runs outside itself.
      assert.equal(res.name, null, `pool ${id} cannot serve but resolved to ${res.name}`);
      assert.ok(res.blocked, `pool ${id} cannot serve but did not refuse`);
      return res;
    }
    assert.ok(res.name !== null, "a pool with a usable member refused");
    assert.ok(members.includes(res.name!), `pool rule left its pool: ${res.name} ∉ [${members}]`);
    assert.ok(usable(w, res.name!), `pool rule picked an unusable member ${res.name}`);
    // Unknown or stale usage is never capacity: a member with fresh room wins over one without.
    if (members.some((n) => usable(w, n) && freshRoom(w, n)))
      assert.ok(freshRoom(w, res.name!), `pool picked ${res.name} without fresh room over a member that has it`);
    return res;
  }

  if (w.mapping) {
    const bound = w.mapping.name;
    if (!exists(w, bound) || w.profs[bound]?.disabled) {
      assert.equal(res.name, null, `a missing/disabled rule account resolved to ${res.name}`);
      assert.ok(res.blocked, "a missing/disabled rule account did not refuse");
      return res;
    }
    assert.equal(res.blocked, undefined, "an enabled rule account was refused");
    if (res.name === bound) {
      // Staying on a busy bound account means nobody else was free — and it is said.
      if (w.guard === "block" && w.profs[bound].live) {
        assert.ok(!(w.names ?? []).some((n) => n !== bound && usable(w, n)), `rule shared busy ${bound} though a free account exists`);
        assert.ok(res.note?.includes(`sharing ${w.providerId}/${bound}`), "rule shared its busy account silently");
      }
      return res;
    }
    // The one way off a one-account rule: guard `block`, the bound account is
    // busy, and the start moves to a FREE account — said out loud in `note`.
    // (Deliberate since c63a357; see the roadmap note on 4.4.)
    assert.equal(w.guard, "block", `rule left ${bound} for ${res.name} without guard block`);
    assert.ok(w.profs[bound].live, `rule left ${bound} for ${res.name} though ${bound} is free`);
    assert.ok(res.note && res.note.includes(`/${res.name} instead`), "rule left its account silently");
    assert.ok(res.name !== null && usable(w, res.name) && !w.profs[res.name].live, `rule gave way to a non-free account ${res.name}`);
    assert.ok(w.names?.includes(res.name!), `rule gave way to ${res.name}, not one of the provider's profiles`);
    return res;
  }

  // No rule: a plain start never refuses, and never picks outside the known accounts.
  assert.equal(res.blocked, undefined, "a plain start was refused");
  if (res.name !== null) assert.ok(w.names?.includes(res.name) || res.name === w.active, `plain start picked a stranger ${res.name}`);
  if (w.names && w.names.some((n) => usable(w, n) && freshRoom(w, n))) {
    assert.ok(res.name !== null && usable(w, res.name) && freshRoom(w, res.name), `plain start picked ${res.name} without fresh room over an account that has it`);
  }
  return res;
}

function forEachCase(label: string, body: (w: World, r: Rng) => void): void {
  const r = prng(SEED);
  for (let k = 0; k < CASES; k++) {
    const w = genWorld(r);
    try {
      body(w, r);
    } catch (e) {
      throw new Error(`${label}: case ${k} (FUZZ_SEED=${SEED}) failed\nworld: ${JSON.stringify(w)}\n${(e as Error).message}`);
    }
  }
}

test(`dir property: ${CASES} generated worlds hold every resolution invariant`, () => {
  let pool = 0, rule = 0, plain = 0, blocked = 0, gaveWay = 0;
  forEachCase("invariants", (w) => {
    const res = check(w);
    if (!w.mapping) plain++;
    else if (w.mapping.name.startsWith("pool:")) pool++;
    else rule++;
    if (res.blocked) blocked++;
    if (res.note) gaveWay++;
  });
  // The generator must actually reach every branch, or the properties are vacuous.
  for (const [k, v] of Object.entries({ pool, rule, plain, blocked, gaveWay })) assert.ok(v >= 30, `branch ${k} reached only ${v} times`);
});

test(`dir property: a pool change moves the pick with the pool, never outside it`, () => {
  let moved = 0;
  forEachCase("pool change", (w, r) => {
    if (!w.mapping?.name.startsWith("pool:")) return;
    const id = w.mapping.name.slice(5);
    const first = check(w);
    const p = w.pools[id];
    if (!first.name || !p) return;
    // Remove the chosen member (and maybe more), or delete the pool outright.
    const after: World = r.chance(0.2)
      ? { ...w, pools: Object.fromEntries(Object.entries(w.pools).filter(([k]) => k !== id)) }
      : {
          ...w,
          pools: { ...w.pools, [id]: { ...p, members: p.members.filter((m) => m !== `${w.providerId}/${first.name}` && !r.chance(0.2)) } },
        };
    const second = check(after);
    assert.notEqual(second.name, first.name, "a removed member is still picked");
    moved++;
  });
  assert.ok(moved >= 30, `pool changes exercised only ${moved} times`);
});

test("dir property: making usage unknown or stale never makes a member more likely to be picked", () => {
  let flips = 0;
  forEachCase("usage decay", (w) => {
    const first = check(w);
    if (!first.name) return;
    // Every OTHER account loses its numbers: the pick must not move to one of them
    // because of it — at most it stays, or falls back to an account with no numbers
    // only when nobody has fresh room any more.
    const decayed: World = {
      ...w,
      profs: Object.fromEntries(
        Object.entries(w.profs).map(([n, p]) => [n, n === first.name ? p : { ...p, usage: { kind: "unknown" as const } }]),
      ),
    };
    const second = check(decayed);
    if (freshRoom(w, first.name) && usable(w, first.name)) {
      assert.equal(second.name, first.name, `${first.name} had fresh room, others lost theirs, yet the pick moved to ${second.name}`);
      flips++;
    }
  });
  assert.ok(flips >= 30, `usage decay exercised only ${flips} times`);
});
