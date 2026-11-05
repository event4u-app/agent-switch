import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// profiles.ts / daemon.ts read AGENT_SWITCH_HOME once at module load — set it
// before importing (each test file runs in its own process).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-cswap-"));
process.env.AGENT_SWITCH_HOME = HOME;
const C = await import("../src/cswap-list.js");

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function snap(capturedAt: string, five: number | null, seven: number | null) {
  const windows = [];
  if (five !== null) windows.push({ key: "five_hour", label: "5h", utilization: five, resetsAt: "2026-11-01T15:00:00.000Z" });
  if (seven !== null) windows.push({ key: "seven_day", label: "All", utilization: seven, resetsAt: "2026-11-05T09:00:00.000Z" });
  windows.push({ key: "weekly_fable", label: "Fable", utilization: 99, resetsAt: null });
  return { windows, routines: null, capturedAt };
}

// ---------- pure builder: field by field ----------

test("buildCswapList emits schema v1 field by field", () => {
  const list = C.buildCswapList(
    [
      { name: "work", email: "w@example.com", active: true, disabled: false, snapshot: snap(iso(60_000), 42, 17) },
      { name: "private", email: null, active: false, disabled: true, snapshot: null },
    ],
    { work: 1, private: 2 },
    NOW,
    6 * 60_000,
  );
  assert.deepEqual(list, {
    schemaVersion: 1,
    supportsAccountSwitching: false,
    activeAccountNumber: 1,
    accounts: [
      {
        number: 1,
        email: "w@example.com",
        alias: "work",
        active: true,
        disabled: false,
        usageStatus: "ok",
        usage: {
          fiveHour: { pct: 42, resetsAt: "2026-11-01T15:00:00.000Z" },
          sevenDay: { pct: 17, resetsAt: "2026-11-05T09:00:00.000Z" },
        },
        usageFetchedAt: iso(60_000),
        usageAgeSeconds: 60,
      },
      {
        number: 2,
        email: null,
        alias: "private",
        active: false,
        disabled: true,
        usageStatus: "unavailable",
        usage: null,
        usageFetchedAt: null,
        usageAgeSeconds: null,
      },
    ],
  });
});

test("a snapshot older than the threshold is stale but still reported", () => {
  const list = C.buildCswapList(
    [{ name: "a", email: null, active: false, disabled: false, snapshot: snap(iso(10 * 60_000), 5, 6) }],
    { a: 3 },
    NOW,
    6 * 60_000,
  );
  const a = list.accounts[0];
  assert.equal(a.usageStatus, "stale");
  assert.deepEqual(a.usage?.fiveHour, { pct: 5, resetsAt: "2026-11-01T15:00:00.000Z" });
  assert.equal(a.usageAgeSeconds, 600);
  assert.equal(list.activeAccountNumber, null);
});

test("unknown usage is usage:null with usageStatus unavailable", () => {
  const cases = [
    null,
    snap(iso(0), null, null), // no 5h / 7d window at all
    { windows: [], routines: null, capturedAt: "not-a-date" },
  ];
  for (const s of cases) {
    const a = C.buildCswapList([{ name: "x", email: null, active: false, disabled: false, snapshot: s as any }], { x: 1 }, NOW, 60_000).accounts[0];
    assert.equal(a.usageStatus, "unavailable");
    assert.equal(a.usage, null);
    assert.equal(a.usageFetchedAt, null);
    assert.equal(a.usageAgeSeconds, null);
  }
});

test("a missing window is null, not a fabricated zero", () => {
  const a = C.buildCswapList([{ name: "x", email: null, active: false, disabled: false, snapshot: snap(iso(0), 30, null) }], { x: 1 }, NOW, 60_000).accounts[0];
  assert.deepEqual(a.usage, { fiveHour: { pct: 30, resetsAt: "2026-11-01T15:00:00.000Z" }, sevenDay: null });
});

test("accounts are ordered by number", () => {
  const list = C.buildCswapList(
    [
      { name: "b", email: null, active: false, disabled: false, snapshot: null },
      { name: "a", email: null, active: false, disabled: false, snapshot: null },
    ],
    { a: 5, b: 2 },
    NOW,
    60_000,
  );
  assert.deepEqual(list.accounts.map((a: any) => a.number), [2, 5]);
});

test("cswapError has the schema-v1 error shape", () => {
  assert.deepEqual(C.cswapError("unsupported_format", "nope"), { schemaVersion: 1, error: { code: "unsupported_format", message: "nope" } });
});

// ---------- stable numbering ----------

test("assignNumbers keeps numbers, appends new names, never reuses a removed number", () => {
  let m = C.assignNumbers(C.emptyNumberMap(), ["b", "a"]);
  assert.deepEqual(m.numbers, { a: 1, b: 2 });
  m = C.assignNumbers(m, ["a", "b", "c"]);
  assert.deepEqual(m.numbers, { a: 1, b: 2, c: 3 });
  m = C.assignNumbers(m, ["a", "c"]); // b removed
  assert.deepEqual(m.numbers, { a: 1, c: 3 });
  m = C.assignNumbers(m, ["a", "c", "d", "b"]); // b re-added: a fresh number, 2 stays retired
  assert.deepEqual(m.numbers, { a: 1, c: 3, b: 4, d: 5 }); // new names in sorted order
  assert.equal(m.next, 6);
});

test("assignNumbers survives a corrupt map", () => {
  const m = C.assignNumbers({ schema: 1, next: "x", numbers: { a: 7, b: "y" } } as any, ["a", "b"]);
  assert.equal(m.numbers.a, 7);
  assert.equal(m.numbers.b, 8);
  assert.equal(m.next, 9);
});

// ---------- cache-only read ----------

function seedProfile(home: string, name: string, email: string | null): void {
  const dir = path.join(home, "claude", name, "config");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify(email ? { oauthAccount: { emailAddress: email } } : {}));
}

/** Five Claude profiles: daemon cache, usage-latest, stale, none, disabled. */
function seedFive(home: string, now: number): void {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  for (const [n, e] of [["alpha", "a@example.com"], ["bravo", "b@example.com"], ["charlie", null], ["delta", "d@example.com"], ["echo", "e@example.com"]] as const) {
    seedProfile(home, n, e);
  }
  fs.mkdirSync(path.join(home, "codex", "cx", "config"), { recursive: true }); // other providers are excluded
  fs.writeFileSync(path.join(home, "state.json"), JSON.stringify({ active: { claude: "bravo" }, disabled: ["claude/echo"] }));
  fs.writeFileSync(
    path.join(home, "daemon-state.json"),
    JSON.stringify({
      lastPoll: ago(30_000),
      pollIntervalMs: 120_000,
      profiles: {
        "claude/alpha": { windows: [{ key: "five_hour", label: "5h", utilization: 12, resetsAt: "2026-11-01T15:00:00Z" }, { key: "seven_day", label: "All", utilization: 34, resetsAt: "2026-11-05T09:00:00Z" }], routines: null, capturedAt: ago(30_000) },
        "claude/bravo": { windows: [{ key: "five_hour", label: "5h", utilization: 1, resetsAt: null }], routines: null, capturedAt: ago(3 * 60 * 60_000) },
        "claude/charlie": { windows: [{ key: "five_hour", label: "5h", utilization: 80, resetsAt: "2026-11-01T13:00:00Z" }], routines: null, capturedAt: ago(2 * 60 * 60_000) },
      },
      lastError: null,
    }),
  );
  // bravo has a newer snapshot from the app's own read: the newer source wins.
  fs.writeFileSync(
    path.join(home, "claude", "bravo", "usage-latest.json"),
    JSON.stringify({ windows: [{ key: "five_hour", label: "5h", utilization: 55, resetsAt: "2026-11-01T14:00:00Z" }], routines: null, capturedAt: ago(60_000) }),
  );
}

test("readCswapList reads only the cache: never fetch, never a credential", async () => {
  seedFive(HOME, NOW);
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    throw new Error("network forbidden");
  }) as typeof fetch;
  try {
    const list = C.readCswapList(NOW);
    assert.equal(fetched, 0);
    assert.equal(list.supportsAccountSwitching, false);
    assert.deepEqual(list.accounts.map((a: any) => a.alias), ["alpha", "bravo", "charlie", "delta", "echo"]);
    assert.deepEqual(list.accounts.map((a: any) => a.number), [1, 2, 3, 4, 5]);
    const by = Object.fromEntries(list.accounts.map((a: any) => [a.alias, a]));
    assert.equal(list.activeAccountNumber, by.bravo.number);
    assert.equal(by.alpha.email, "a@example.com");
    assert.equal(by.alpha.usageStatus, "ok");
    assert.deepEqual(by.alpha.usage.sevenDay, { pct: 34, resetsAt: "2026-11-05T09:00:00Z" });
    assert.equal(by.bravo.usage.fiveHour.pct, 55); // usage-latest beat the older daemon entry
    assert.equal(by.bravo.usageStatus, "ok");
    assert.equal(by.charlie.email, null);
    assert.equal(by.charlie.usageStatus, "stale");
    assert.equal(by.delta.usageStatus, "unavailable");
    assert.equal(by.delta.usage, null);
    assert.equal(by.echo.disabled, true);
    const text = JSON.stringify(list);
    assert.doesNotMatch(text, /token|sk-ant/i);
  } finally {
    globalThis.fetch = realFetch;
  }
  // The number map is persisted next to the other agent-switch state.
  const stored = JSON.parse(fs.readFileSync(path.join(HOME, C.CSWAP_NUMBERS_FILE), "utf8"));
  assert.equal(stored.numbers.alpha, 1);
});

test("the module imports nothing that can reach the network or a credential", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../src/cswap-list.js", import.meta.url)), "utf8");
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const bad of ["node:http", "node:https", "node:net", "./api.js", "./token-freshen.js", "./credentials.js", "./keychain.js"]) {
    assert.ok(!imports.includes(bad), `cswap-list must not import ${bad}`);
  }
  assert.doesNotMatch(src, /\bfetch\s*\(/);
});

// ---------- e2e over the built CLI ----------

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function cli(home: string, args: string[]) {
  return spawnSync("node", [CLI, ...args], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8" });
}

test("e2e: `--list --json` and `list --json --format cswap-v1` agree, under 300 ms", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-cswap-e2e-"));
  try {
    seedFive(home, Date.now());
    cli(home, ["--list", "--json"]); // warm the OS file cache once
    // The budget is for agent-switch's own work, so a bare `node` start on the
    // same machine is subtracted: on a slow Windows runner the process start
    // alone takes most of 300 ms, on every attempt. Fastest of three each.
    let r!: ReturnType<typeof cli>;
    let total = Infinity;
    let bare = Infinity;
    for (let i = 0; i < 3; i++) {
      let t0 = performance.now();
      spawnSync("node", ["-e", ""]);
      bare = Math.min(bare, performance.now() - t0);
      t0 = performance.now();
      r = cli(home, ["--list", "--json"]);
      total = Math.min(total, performance.now() - t0);
      assert.equal(r.status, 0, r.stderr);
    }
    const ms = total - bare;
    const a = JSON.parse(r.stdout);
    assert.equal(a.schemaVersion, 1);
    assert.equal(a.accounts.length, 5);
    const took = `${ms.toFixed(0)} ms (${total.toFixed(0)} ms total, ${bare.toFixed(0)} ms bare node start)`;
    assert.ok(ms < 300, `took ${took}`);
    console.log(`# cswap --list --json on five profiles: ${took}`);
    const b = JSON.parse(cli(home, ["list", "--json", "--format", "cswap-v1"]).stdout);
    for (const x of [...a.accounts, ...b.accounts]) delete x.usageAgeSeconds; // seconds tick between runs
    assert.deepEqual(b, a);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("e2e: plain `list --json` keeps the GUI contract", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-cswap-e2e-"));
  try {
    seedProfile(home, "work", "w@example.com");
    const rows = JSON.parse(cli(home, ["list", "--json", "--provider", "claude"]).stdout);
    assert.ok(Array.isArray(rows));
    assert.deepEqual(Object.keys(rows[0]).sort(), ["active", "color", "disabled", "identity", "label", "liveSessions", "name", "provider"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("e2e: an unknown --format is a schema-v1 error with a non-zero exit", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-cswap-e2e-"));
  try {
    const r = cli(home, ["list", "--json", "--format", "cswap-v9"]);
    assert.notEqual(r.status, 0);
    const e = JSON.parse(r.stdout);
    assert.equal(e.schemaVersion, 1);
    assert.equal(e.error.code, "unsupported_format");
    assert.equal(typeof e.error.message, "string");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("e2e: `--version` prints a semver", gate, () => {
  const out = execFileSync("node", [CLI, "--version"], { encoding: "utf8" }).trim();
  assert.match(out, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});
