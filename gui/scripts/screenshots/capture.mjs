#!/usr/bin/env node
/**
 * README screenshot pipeline for the agent-switch GUI.
 *
 *   npm --prefix gui run screenshots      (or: task gui:screenshots)
 *
 * Starts the GUI's Vite dev server on a free port, opens it in headless
 * Chromium (Playwright from the repo root) with a fake Tauri runtime, and
 * answers the GUI's CLI calls from the REAL built CLI (dist/index.js) running
 * against a freshly seeded temp home — except the calls that would read the
 * real machine (keychain, network, PATH binaries), which come from anonymised
 * fixtures. Every PNG is scanned for real-user data before it is written.
 *
 * Output: .github/assets/screenshots/*.png (1600x1000 @1x, dark theme) and
 * tray.png (360 wide, clipped to the content-sized card, transparent corners).
 *
 * Env: SHOTS_ONLY=overview,tray  capture a subset · SHOTS_HEADED=1  show the browser ·
 *      SHOTS_DEBUG=1  log every CLI call the GUI makes ·
 *      SHOTS_LANG=de  capture the GUI in that language (default en). A non-en run writes to
 *      SHOTS_OUT (default: a temp dir) and never touches the README/docs captures; it also
 *      captures the pet bubble with a full-length title plus action line (pet-bubble*.png).
 */

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

import * as fx from "./fixtures.mjs";
import { seedHome } from "./seed.mjs";
import { installTauriShim } from "./tauri-shim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI = path.resolve(HERE, "../..");
const ROOT = path.resolve(GUI, "..");
const CLI = path.join(ROOT, "dist", "index.js");
let OUT = path.join(ROOT, ".github", "assets", "screenshots");
// The docs site shows the same app views; mirrored so README and docs never drift.
const DOCS_OUT = path.join(ROOT, "starlight", "public", "screenshots");
const DOCS_MIRROR = { overview: "app-overview.png", sessions: "app-sessions.png", "session-sheet": "app-session.png" };
const VIEWPORT = { width: 1600, height: 1000 };
// The tray window is content-sized: render in a tall viewport, then clip to the card.
const TRAY_VIEWPORT = { width: 360, height: 900 };
const LANG = process.env.SHOTS_LANG || "en";
if (process.env.SHOTS_OUT || LANG !== "en") OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), `agent-switch-shots-${LANG}-`));
const ONLY = process.env.SHOTS_ONLY ? new Set(process.env.SHOTS_ONLY.split(",").map((s) => s.trim())) : null;

const log = (...a) => console.log("[shots]", ...a);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function ensureCli() {
  if (fs.existsSync(CLI)) return;
  log("dist/index.js missing — building the CLI (npm run build)");
  const r = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error("CLI build failed");
}

// ---------------------------------------------------------------------------
// CLI bridge: which commands run for real in the temp home, which are fixtures.
// ---------------------------------------------------------------------------

/** Read/write only inside AGENT_SWITCH_HOME (+ the fake HOME) — safe to run for real. */
const REAL = new Set([
  "list", "ls", "current", "sessions", "share", "guard", "mappings", "map", "unmap", "activity",
  "protection", "pool", "pools", "gui-settings", "notifications", "notify", "os-notify", "alerts",
  "autoswitch", "usage", "dir", "label", "rename", "use", "deactivate", "remove", "rm", "hooks",
]);

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--") && ["--provider", "--from", "--recent", "--limit", "--threshold"].includes(a)) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function makeBridge(seed) {
  const { home, env, liveFiles } = seed;
  const unknown = new Set();
  const ok = (stdout) => ({ code: 0, signal: null, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout, null, 2), stderr: "" });
  const fail = (stderr) => ({ code: 1, signal: null, stdout: "", stderr });
  const tilde = (s) => s.split(home).join("~");
  // Session folders stay absolute, like real output — the start dialog offers
  // them as folders and refuses a `~/…` one; the GUI still shows them as `~/…`.
  const absolute = (s) => s.split(home).join(fx.DEMO_HOME);
  const untilde = (s) =>
    typeof s !== "string" ? s : s.startsWith(fx.DEMO_HOME) ? home + s.slice(fx.DEMO_HOME.length) : s.startsWith("~") ? home + s.slice(1) : s;

  const profiles = () =>
    JSON.parse(execFileSync(process.execPath, [CLI, "list", "--json"], { env, encoding: "utf8", cwd: home })).map((r) => ({ provider: r.provider, name: r.name }));

  function activeOf(provider) {
    const state = JSON.parse(fs.readFileSync(path.join(seed.ash, "state.json"), "utf8"));
    return state.active?.[provider] ?? null;
  }

  function runReal(args, options) {
    // Keep the live sessions "working" (touched within the last minute).
    if (args[0] === "sessions" || args[0] === "list") {
      const now = Date.now();
      for (const f of liveFiles) fs.utimesSync(f.file, new Date(now - f.lagMs), new Date(now - f.lagMs));
    }
    const r = spawnSync(process.execPath, [CLI, ...args.map(untilde)], {
      env,
      encoding: "utf8",
      cwd: untilde(options?.cwd) || home,
      timeout: 20_000,
    });
    const shown = args[0] === "sessions" ? absolute : tilde;
    return { code: r.status ?? 1, signal: null, stdout: shown(r.stdout ?? ""), stderr: tilde(r.stderr ?? "") };
  }

  function agentSwitch(args, options) {
    const now = Date.now();
    const [cmd, sub] = args;
    const { positional, flags } = parseFlags(args.slice(1));
    switch (cmd) {
      case "status": {
        const provider = flags.provider ?? "claude";
        const name = positional[0] ?? activeOf(provider);
        if (!name) return fail(`no active ${provider} profile for --json`);
        const status = fx.statusJson(provider, name, now);
        // Like the real CLI: every read also lands in the latest snapshot `dir` balances on.
        if (status?.usage) fs.writeFileSync(path.join(seed.ash, provider, name, "usage-latest.json"), JSON.stringify(status.usage));
        return ok(status);
      }
      case "auth-status": {
        const all = profiles();
        return ok(fx.authStatus(flags.provider ? all.filter((p) => p.provider === flags.provider) : all, now));
      }
      case "tooling":
        if (sub === "--json" || sub === undefined) return ok(fx.TOOLING);
        return ok(""); // install / upgrade / notes: never touch the real machine
      case "doctor":
        return ok(fx.DOCTOR);
      case "apps":
        return ok(fx.APPS);
      case "providers":
        return sub === "status" ? ok(fx.PROVIDERS_STATUS) : ok("");
    }
    if (REAL.has(cmd)) return runReal(args, options);
    unknown.add(`agent-switch ${args.join(" ")}`);
    return ok(""); // rebind, web, open, update, run, takeover, … — stubbed success
  }

  const traffic = { inflight: 0, last: Date.now() };
  return {
    unknown,
    traffic,
    async handle(req) {
      traffic.inflight++;
      traffic.last = Date.now();
      try {
        return await this.dispatch(req);
      } finally {
        traffic.inflight--;
        traffic.last = Date.now();
      }
    },
    async dispatch({ program, args, options }) {
      if (process.env.SHOTS_DEBUG) log(`exec ${program} ${(args ?? []).join(" ")}`);
      // The tray window runs read-only commands under its own scope names (as-read-*).
      if (program === "agent-switch" || program.startsWith("as-read-")) return agentSwitch(args ?? [], options);
      if (program === "agent-config-version") return ok("18.2.0\n");
      unknown.add(`${program} ${(args ?? []).join(" ")}`);
      return fail(`${program}: not available in the screenshot harness`);
    },
  };
}

// ---------------------------------------------------------------------------
// Privacy gate
// ---------------------------------------------------------------------------

function privacyPatterns(home) {
  const user = os.userInfo().username;
  return [
    { name: "macOS home path", re: /\/Users\//i },
    { name: "linux home path", re: /\/home\/[a-z]/i },
    { name: "temp home path", re: new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) },
    { name: "temp dir", re: /as-shots-|\/var\/folders\/|\/private\/var\//i },
    { name: "real username", re: new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") },
  ];
}

async function assertAnonymous(page, home, shot) {
  const shown = await page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const el of document.querySelectorAll("[title],[aria-label],[placeholder],input,textarea")) {
      for (const a of ["title", "aria-label", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v) parts.push(v);
      }
      if ("value" in el && el.value) parts.push(String(el.value));
    }
    return parts.join("\n");
  });
  // The demo home is a stand-in by construction (fixtures.DEMO_HOME), not a leak.
  const text = shown.split(fx.DEMO_HOME).join("~");
  const problems = [];
  for (const p of privacyPatterns(home)) {
    const m = text.match(p.re);
    if (m) problems.push(`${p.name}: "${m[0]}"`);
  }
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    if (!/@example\.(com|org|net)$/i.test(m[0])) problems.push(`real-looking email: "${m[0]}"`);
  }
  if (problems.length) throw new Error(`privacy gate failed for ${shot}:\n  ${problems.join("\n  ")}`);
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function settle(page, ms = 450) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

/** Until the GUI has made no CLI call for `quietMs` (usage fetches are staggered). */
async function waitQuiet(traffic, quietMs = 2500, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (traffic.inflight === 0 && Date.now() - traffic.last >= quietMs) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  log(`CLI traffic did not settle within ${timeoutMs} ms — capturing anyway`);
}

async function waitLoaded(page, traffic, loading = ["Reading accounts"]) {
  await page.waitForFunction((needles) => needles.every((n) => !document.body.innerText.includes(n)), loading, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await waitQuiet(traffic);
  await settle(page, 600);
}


async function closeOverlay(page) {
  await page.keyboard.press("Escape");
  await settle(page, 350);
}

async function main() {
  ensureCli();
  fs.mkdirSync(OUT, { recursive: true });

  const now = Date.now();
  const seed = seedHome(CLI, now);
  log("seeded temp home");
  const bridge = makeBridge(seed);
  const port = await freePort();
  const vite = await createServer({
    root: GUI,
    configFile: path.join(GUI, "vite.config.ts"),
    logLevel: "warn",
    clearScreen: false,
    server: { port, strictPort: true, host: "127.0.0.1", hmr: false },
  });
  await vite.listen();
  const base = `http://127.0.0.1:${port}`;
  log(`vite on ${base}`);

  // Selectors stay in English; in another language they also accept the
  // translation of the same English string (looked up in the GUI's own tables).
  const { tables } = await vite.ssrLoadModule("/src/i18n/index.ts");
  const dict = tables();
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** Regex source matching `text` or its translations (same English value, any key). */
  const alt = (text) => {
    const forms = new Set([text]);
    if (LANG !== "en") for (const [k, v] of Object.entries(dict.en)) if (v === text && dict[LANG]?.[k]) forms.add(dict[LANG][k]);
    return `(?:${[...forms].map(esc).join("|")})`;
  };
  const L = (text, { prefix = false, exact = false, flags = "" } = {}) =>
    new RegExp(`${prefix || exact ? "^" : ""}${alt(text)}${exact ? "$" : ""}`, flags);
  const loadingTexts = [...new Set(["Reading accounts", ...Object.entries(dict.en).filter(([, v]) => v.startsWith("Reading accounts")).map(([k]) => dict[LANG]?.[k]?.replace(/[ …]+$/, "")).filter(Boolean)])];

  async function nav(page, label) {
    await page.getByRole("navigation", { name: L("Places", { exact: true }) }).getByRole("button", { name: L(label, { prefix: true }) }).click();
    await settle(page);
  }

  const browser = await chromium.launch({ headless: !process.env.SHOTS_HEADED });
  const produced = [];
  const statics = fx.invokeStatic(now);
  delete statics._now;

  async function openPage(file, viewport, windowLabel) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark", locale: "en-US", timezoneId: "Europe/Berlin" });
    await context.route(/^(?!http:\/\/127\.0\.0\.1).*/, async (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
      const npm = url.match(/registry\.npmjs\.org\/(.+)\/latest/);
      if (npm) {
        const v = fx.LATEST[decodeURIComponent(npm[1])];
        return v ? json(200, { version: v }) : json(404, {});
      }
      if (/api\.github\.com\/repos\/[^/]+\/rtk\/releases\/latest/.test(url)) return json(200, { tag_name: fx.LATEST.rtkTag, name: fx.LATEST.rtkTag, html_url: "https://github.com/", body: "", published_at: new Date(now - 3 * 864e5).toISOString() });
      if (/api\.github\.com\/repos\/.+\/releases\/latest/.test(url)) return json(200, { tag_name: fx.LATEST.appTag, name: fx.LATEST.appTag, html_url: "https://github.com/", body: "", published_at: new Date(now - 864e5).toISOString() });
      if (/api\.github\.com\/repos\/.+\/releases/.test(url)) return json(200, []);
      log(`blocked network request: ${url}`);
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => log(`page error (${windowLabel}): ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") log(`console error (${windowLabel}): ${m.text().slice(0, 300)}`);
    });
    await page.exposeFunction("__asHost", (req) => bridge.handle(req));
    await page.exposeFunction("__asLog", (msg) => log(msg));
    await page.addInitScript(installTauriShim, {
      statics,
      windowLabel,
      storage: { "agent-switch-theme": "dark", ...(LANG !== "en" ? { "agent-switch-language": LANG } : {}) },
    });
    await page.goto(`${base}/${file}`);
    return { context, page };
  }

  async function shot(page, name, { clip, omitBackground } = {}) {
    if (ONLY && !ONLY.has(name)) return;
    await settle(page);
    await assertAnonymous(page, seed.home, name);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, clip, omitBackground, animations: "disabled" });
    produced.push(file);
    log(`wrote ${file}`);
  }

  try {
    const { context, page } = await openPage("index.html", VIEWPORT, "main");
    await waitLoaded(page, bridge.traffic, loadingTexts);

    await nav(page, "Overview");
    await shot(page, "overview");

    // Near-limit decision for `side` (94 %), opened from the attention queue.
    const decide = page.getByRole("button", { name: L("Decide", { exact: true }) }).first();
    if (await decide.count()) {
      await decide.click();
      await settle(page, 600);
      await shot(page, "near-limit");
      await closeOverlay(page);
    } else log("no Decide button on Overview — near-limit.png skipped");

    await page.getByRole("button", { name: L("Start session", { exact: true }) }).first().click();
    await settle(page, 600);
    await shot(page, "start-session");
    await closeOverlay(page);

    await nav(page, "Sessions");
    // "All" shows the finished sessions next to the two running ones.
    const all = page.getByRole("radio", { name: new RegExp(`^${alt("All")} \\d`) });
    if (await all.count()) {
      await all.first().click();
      await settle(page);
    }
    await shot(page, "sessions");

    // Open the live agent-config session.
    await page.getByText("Knowledge map: edge filter for stale links").first().click();
    await settle(page, 700);
    const preview = page.getByRole("button", { name: L("Preview", { flags: "i" }) });
    if (await preview.count()) {
      await preview.first().click();
      await waitQuiet(bridge.traffic, 800);
      await settle(page, 400);
    }
    await shot(page, "session-sheet");
    await closeOverlay(page);

    await nav(page, "Accounts");
    await shot(page, "accounts");

    await nav(page, "Tools");
    await shot(page, "tools");

    await page.getByRole("button", { name: L("Health", { prefix: true }) }).click();
    await settle(page);
    await shot(page, "health");

    await page.locator("header").getByRole("button", { name: L("Settings", { exact: true }) }).click();
    await settle(page);
    await shot(page, "settings");
    const prot = L("Protection", { prefix: true });
    const protection = page.getByRole("button", { name: prot }).or(page.getByRole("link", { name: prot })).or(page.getByRole("tab", { name: prot }));
    if (await protection.count()) {
      await protection.first().click();
      await settle(page);
      await shot(page, "settings-protection");
    } else log("no Protection entry in Settings — settings-protection.png skipped");
    await context.close();

    const tray = await openPage("tray.html", TRAY_VIEWPORT, "tray");
    await waitLoaded(tray.page, bridge.traffic, loadingTexts);
    const box = await tray.page.evaluate(() => {
      const root = document.getElementById("root");
      const card = root?.firstElementChild ?? root;
      const r = card.getBoundingClientRect();
      return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    });
    await shot(tray.page, "tray", { clip: box.height > 0 ? box : undefined, omitBackground: true });
    await tray.context.close();

    // Pet bubble: the window is 240 wide (sprite 192 + 48) and grows in height
    // to fit the bubble (pet-main layoutWindow), so render tall and clip to the
    // stage. Titles: the longest pet-bound copy in this language, plus the
    // 140-char cap, each with an action line ("→ click to switch").
    if (!ONLY || [...ONLY].some((n) => n.startsWith("pet-bubble"))) {
      const pet = await openPage("pet.html", { width: 240, height: 640 }, "pet");
      await settle(pet.page, 800);
      const fill = (v) => v.replace(/\{(\w+)\}/g, (_, n) => ({ count: "3", pct: "94", percent: "94", name: "personal-backup", account: "personal-backup", target: "personal-backup", from: "work", to: "personal-backup", provider: "Claude", version: "2.6.3", minutes: "45", tool: "claude", threshold: "90", tag: "v2.6.4", window: "5h" })[n] ?? n);
      const pool = Object.entries(dict[LANG] ?? dict.en).filter(([k]) => /^(engines|vm)\./.test(k)).map(([, v]) => fill(v));
      const longest = pool.sort((a, b) => b.length - a.length).slice(0, 3);
      const cap = longest[0] ? (longest[0] + " " + longest[1]).slice(0, 139) + "…" : "x".repeat(140);
      const cases = [...longest.map((title, i) => ({ name: `pet-bubble-${i + 1}`, title })), { name: "pet-bubble-cap", title: cap }];
      for (const c of cases) {
        await pet.page.evaluate((title) => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "pet-notification", payload: { kind: "warning", title, action: "switch", force: true } }), c.title);
        await settle(pet.page, 500);
        const m = await pet.page.evaluate(() => {
          const b = document.getElementById("bubble");
          const st = document.getElementById("stage").getBoundingClientRect();
          return { scrollW: b.scrollWidth, clientW: b.clientWidth, bubbleH: b.offsetHeight, bubbleTop: b.getBoundingClientRect().top, stageTop: st.top, w: st.width };
        });
        log(`${c.name}: ${JSON.stringify(m)} title=${JSON.stringify(c.title)}`);
        const top = Math.max(0, Math.floor(m.bubbleTop) - 8);
        await shot(pet.page, c.name, { clip: { x: 0, y: top, width: 240, height: 640 - top }, omitBackground: false });
      }
      await pet.context.close();
    }
  } finally {
    await browser.close();
    await vite.close();
    seed.cleanup();
  }

  if (LANG === "en" && !process.env.SHOTS_OUT) for (const [name, docsName] of Object.entries(DOCS_MIRROR)) {
    const src = path.join(OUT, `${name}.png`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DOCS_OUT, docsName));
  }
  if (bridge.unknown.size) log(`stubbed (not run): ${[...bridge.unknown].join(" · ")}`);
  log(`done — ${produced.length} PNGs:\n  ${produced.join("\n  ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
