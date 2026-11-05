#!/usr/bin/env node
/**
 * Render check for the v3 window on real CLI output (spec §14):
 *
 *   npm --prefix gui run v3-render     (runs from gui/, where Tailwind finds its config)
 *
 * Three themes (darcula, github-light, github-dark-hc) × three data shapes
 * (the seeded demo home; 40 sessions with long names; no sessions) at
 * the window's own size from tauri.conf.json (V3_SIZE overrides), each with a session tab open where one exists. The engine is not
 * running in the seeded home, so every frame also shows the engine-down state.
 *
 * Per frame it checks: no page scroll, no text clipped without an ellipsis, no
 * button, tab or menu entry wrapped onto a second line, nothing outside the
 * window, no text drawn over other text. Findings and PNGs go to V3_OUT (default: a temp dir); a finding
 * fails the run. `V3_CLICKS="Settings ⌘,|Agents"` opens a page first by the
 * accessible names of its buttons. The PNGs show the seeded temp home's paths and are not for
 * publishing.
 *
 * Other switches: V3_REAL=1 renders the user's own data through a read-only
 * allowlist (nothing that writes ever runs; PNGs then hold real names — local
 * only). V3_TRAY=1 renders tray.html (V3_TRAY_W, default 360). V3_SIZE=WxH,
 * V3_THEMES=a,b, V3_WAIT=ms (real data loads slower), V3_STACK=1 (stacks for
 * page errors), V3_CALLS=1 (log every CLI call).
 */

import { execFile, spawnSync } from "node:child_process";
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
const OUT = process.env.V3_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "as-v3-render-"));
/** The window's own size from tauri.conf.json, so the check sees what the app opens with. `V3_SIZE=1440x900` overrides. */
const MAIN_WINDOW = JSON.parse(fs.readFileSync(path.join(GUI, "src-tauri", "tauri.conf.json"), "utf8")).app.windows[0];
const [W, H] = (process.env.V3_SIZE ?? `${MAIN_WINDOW.width}x${MAIN_WINDOW.height}`).split("x").map(Number);
/** V3_TRAY=1: the tray popover in a window of the tray's widest card (spec §10). */
const TRAY = !!process.env.V3_TRAY;
const VIEWPORT = TRAY ? { width: Number(process.env.V3_TRAY_W || 360), height: 720 } : { width: W, height: H };
const THEMES = [
  ["darcula", { mode: "dark", dark: "darcula", light: "github-light" }],
  ["github-light", { mode: "light", dark: "darcula", light: "github-light" }],
  ["github-dark-hc", { mode: "dark", dark: "github-dark-hc", light: "github-light" }],
];
const ONLY_THEMES = process.env.V3_THEMES ? process.env.V3_THEMES.split(",") : null;
const CASES = process.env.V3_REAL ? ["real"] : process.env.V3_CASES ? process.env.V3_CASES.split(",") : ["seeded", "forty", "empty"];
const log = (...a) => console.log("[v3-render]", ...a);

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/** The calls that would read the real machine answer from fixtures; the rest run for real in the temp home. */
const FIXED = new Set(["status", "auth-status", "tooling", "doctor", "apps", "providers"]);
/** Never run here: network (gh), the user's terminal or editor, anything that starts or ends a process. */
const NEVER = new Set(["pr", "open", "focus", "host-start", "web", "update", "run", "takeover", "rebind", "compact", "engine-restart"]);

/**
 * V3_REAL=1: the user's own data. Only these read-only call shapes reach the
 * real CLI in the real home; every other call (anything that writes, starts,
 * switches or activates) answers empty and never runs.
 */
const READ_ONLY = [
  (a) => a[0] === "status",
  (a) => a[0] === "sessions" && (a[1] === "--recent" || a[1] === "library"),
  (a) => a[0] === "notifications" && a[1] === "--json",
  (a) => ["tooling", "remote", "open-targets", "needs", "mappings", "list", "doctor", "desktop", "auth-status", "apps", "agents", "protection"].includes(a[0]) && a.slice(1).every((x) => x.startsWith("--")),
  (a) => ["providers status", "pool list", "launcher list", "host list", "engine status"].includes(`${a[0]} ${a[1]}`),
  (a) => (a[0] === "gui-settings" || a[0] === "guard") && a.slice(1).every((x) => x === "--json"),
  (a) => a[0] === "activity" && a[1] === "--limit",
  (a) => a[0] === "timeline",
];
const REAL = !!process.env.V3_REAL;

function realBridge() {
  return async ({ program, args = [], options }) => {
    if (process.env.V3_CALLS) console.log("[real]", program, args.join(" "));
    if (program !== "agent-switch") return { code: 1, signal: null, stdout: "", stderr: "not in the harness" };
    if (!READ_ONLY.some((ok) => ok(args))) { if (process.env.V3_CALLS) console.log("[blocked]", program, args.join(" ")); return { code: 0, signal: null, stdout: "", stderr: "" }; }
    // Async, so calls run side by side as they do in the app; a sync spawn queues them all.
    return new Promise((resolve) =>
      execFile(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: options?.cwd || os.homedir(), timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, signal: null, stdout: stdout ?? "", stderr: stderr ?? "" }),
      ),
    );
  };
}

function bridge(seed) {
  const ok = (stdout) => ({ code: 0, signal: null, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "" });
  return async ({ program, args = [], options }) => {
    if (program === "agent-config-version") return ok("18.2.0\n");
    if (program !== "agent-switch" && !program.startsWith("as-read-")) return { code: 1, signal: null, stdout: "", stderr: "not in the harness" };
    const [cmd, sub] = args;
    if (process.env.V3_CALLS) console.log("[call]", args.join(" "));
    const key = cmd === "host" && sub !== "list" ? `host-${sub}` : cmd === "engine" && sub === "restart" ? "engine-restart" : cmd;
    if (FIXED.has(cmd)) {
      const now = Date.now();
      if (cmd === "status") return ok(fx.statusJson(args[args.indexOf("--provider") + 1] || "claude", args[3] ?? "work", now));
      if (cmd === "auth-status") return ok([]);
      if (cmd === "tooling") return ok(fx.TOOLING);
      if (cmd === "doctor") return ok(fx.DOCTOR);
      if (cmd === "apps") return ok(fx.APPS);
      return ok(fx.PROVIDERS_STATUS);
    }
    if (NEVER.has(key)) return ok("");
    const r = spawnSync(process.execPath, [CLI, ...args], { env: seed.env, encoding: "utf8", cwd: options?.cwd || seed.home, timeout: 20_000 });
    return { code: r.status ?? 1, signal: null, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

const LONG = [
  "Refactor the account routing so a pool member that is signed out never wins a plain start",
  "Investigate why the hook relay drops a SubagentStop event when two helpers end in the same millisecond",
  "Write the migration that moves every library entry into the event store without losing tags",
];

/** Shape the seeded home for a case. */
function shape(seed, kind) {
  const projects = (provider, name) => path.join(seed.ash, provider, name, "config", "projects");
  if (kind === "empty") {
    for (const p of ["work", "side", "personal"]) fs.rmSync(projects("claude", p), { recursive: true, force: true });
    for (const p of ["work", "personal"]) fs.rmSync(path.join(seed.ash, "codex", p, "config", "sessions"), { recursive: true, force: true });
  }
  if (kind === "forty") {
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
      const profile = ["work", "side", "personal"][i % 3];
      const dir = path.join(projects("claude", profile), "-dev-long-project-name-that-keeps-going");
      fs.mkdirSync(dir, { recursive: true });
      const id = `4${String(i).padStart(7, "0")}-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`;
      const cwd = path.join(seed.home, "dev", "a-very-long-project-folder-name-for-the-render-check", `worktree-${i}`);
      const summary = `${LONG[i % LONG.length]} (${i + 1})`;
      const file = path.join(dir, `${id}.jsonl`);
      fs.writeFileSync(file, JSON.stringify({ type: "summary", summary, cwd }) + "\n" + JSON.stringify({ type: "user", cwd, timestamp: new Date(now - i * 60_000).toISOString(), message: { role: "user", content: summary } }) + "\n");
      const t = new Date(now - i * 10 * 60_000);
      fs.utimesSync(file, t, t);
    }
  }
}

/** Runs in the page: everything that looks clipped, wrapped or out of bounds. */
export function inspect() {
  const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > innerWidth + 1 || de.scrollHeight > innerHeight + 1) out.push(`page scrolls: ${de.scrollWidth}×${de.scrollHeight}`);
  // The chosen theme reaches the window: the `.as-ac` root's stylesheet defaults must not win.
  const root = document.querySelector(".as-ac");
  const want = getComputedStyle(de).getPropertyValue("--ac-bg").trim();
  const got = root ? getComputedStyle(root).getPropertyValue("--ac-bg").trim() : "";
  if (want && got.toLowerCase() !== want.toLowerCase()) out.push(`theme not applied: window root --ac-bg ${got || "missing"}, theme ${want}`);
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // Screen-reader-only text is clipped to 1px on purpose.
    const srOnly = el.classList.contains("sr-only") || (r.width <= 1 && r.height <= 1);
    if (ownText && !srOnly && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis" && !el.closest("[role=log],.xterm"))
      out.push(`clipped without ellipsis: <${el.tagName.toLowerCase()}> "${label(el)}"`);
    // Past the edge inside a sideways-scrolling box is reachable; past the window itself is not.
    const inScroller = (() => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (["auto", "scroll"].includes(getComputedStyle(a).overflowX)) return a.getBoundingClientRect().right <= innerWidth + 1;
      return false;
    })();
    if (r.right > innerWidth + 1 && !inScroller && !el.closest("[aria-hidden=true]")) out.push(`outside the window: <${el.tagName.toLowerCase()}> "${label(el)}" right=${Math.round(r.right)}`);
  }
  // Text whose glyphs run past the edge of a clipping ancestor: the element itself
  // may be wide enough, so the check above cannot see it.
  // A scrolling box keeps what is past its edge reachable; only hidden/clip cut it off.
  const clips = (a) => ["hidden", "clip"].includes(getComputedStyle(a).overflowX);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const host = n.parentElement;
    if (!n.textContent.trim() || !host || host.closest(".sr-only,[role=log],.xterm,[aria-hidden=true]")) continue;
    if (getComputedStyle(host).visibility === "hidden") continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((x) => x.width > 1);
    if (!rects.length) continue;
    const right = Math.max(...rects.map((x) => x.right));
    // An ellipsis on the way up means the cut is planned and drawn.
    for (let a = host; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.textOverflow === "ellipsis" && cs.overflowX !== "visible" && a.getBoundingClientRect().right <= right) break;
      if (clips(a) && a.getBoundingClientRect().right < right - 1) {
        out.push(`runs past a clipping edge: <${host.tagName.toLowerCase()}> "${label(host)}"`);
        break;
      }
    }
  }
  // Text drawn over other text: two visible text runs whose boxes intersect. A
  // layer (popover, menu, sticky head) that covers text is fine, so a run counts
  // only where it is the topmost thing at its own centre.
  const runs = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const host = n.parentElement;
    if (!n.textContent.trim() || !host || host.closest(".sr-only,[role=log],.xterm,[aria-hidden=true]")) continue;
    const cs = getComputedStyle(host);
    if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    // Only the drawn part counts: a truncated run's box spans its hidden tail too.
    let box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (let a = host; a && a !== document.body; a = a.parentElement)
      if (getComputedStyle(a).overflowX !== "visible") {
        const c = a.getBoundingClientRect();
        box = { left: Math.max(box.left, c.left), top: Math.max(box.top, c.top), right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom) };
      }
    for (const raw of range.getClientRects()) {
      const r = { left: Math.max(raw.left, box.left), top: Math.max(raw.top, box.top), right: Math.min(raw.right, box.right), bottom: Math.min(raw.bottom, box.bottom) };
      r.width = r.right - r.left;
      r.height = r.bottom - r.top;
      if (r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || !(top === host || host.contains(top) || top.contains(host))) continue;
      runs.push({ r, host, text: n.textContent.trim().slice(0, 30) });
    }
  }
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i].r;
      const b = runs[j].r;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > Math.min(a.height, b.height) / 3 && runs[i].host !== runs[j].host) out.push(`overlaps: "${runs[i].text}" × "${runs[j].text}"`);
    }
  for (const el of document.querySelectorAll("button, [role=tab], [role=menuitem], [role=radio]")) {
    // Text nodes only: an icon beside the label sits on its own box and is not a second line.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let lines = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      lines = Math.max(lines, new Set([...range.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size);
    }
    if (lines > 1) out.push(`wrapped: <${el.tagName.toLowerCase()}> "${label(el)}"`);
  }
  return [...new Set(out)];
}

async function main() {
  if (!fs.existsSync(CLI)) throw new Error("dist/index.js missing — npm run build first");
  fs.mkdirSync(OUT, { recursive: true });
  const port = await freePort();
  const vite = await createServer({ root: GUI, configFile: path.join(GUI, "vite.config.ts"), logLevel: "warn", clearScreen: false, server: { port, strictPort: true, host: "127.0.0.1", hmr: false } });
  await vite.listen();
  const browser = await chromium.launch();
  const statics = fx.invokeStatic(Date.now());
  delete statics._now;
  const report = {};
  let failed = 0;
  try {
    for (const kind of CASES) {
      const seed = REAL ? null : seedHome(CLI, Date.now());
      if (seed) shape(seed, kind);
      const handle = REAL ? realBridge() : bridge(seed);
      for (const [theme, a] of THEMES.filter(([t]) => !ONLY_THEMES || ONLY_THEMES.includes(t))) {
        const name = `${kind}-${theme}`;
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: Number(process.env.V3_DSF || 1), colorScheme: a.mode === "light" ? "light" : "dark", locale: "en-US", timezoneId: "Europe/Berlin" });
        await context.route(/^(?!http:\/\/127\.0\.0\.1).*/, (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
        const page = await context.newPage();
        const errors = [];
        if (process.env.V3_CALLS) page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log("[console]", m.type(), m.text().slice(0, 300)));
        page.on("pageerror", (e) => errors.push(process.env.V3_STACK ? e.stack : e.message));
        await page.exposeFunction("__asHost", handle);
        await page.exposeFunction("__asLog", () => {});
        const appearance = JSON.stringify({ ...a, accent: "theme", terminalFollows: true });
        await page.addInitScript(installTauriShim, { statics, windowLabel: TRAY ? "tray" : "main", storage: { "agent-switch-ui-window": "v3", "agent-switch-appearance": appearance } });
        await page.goto(`http://127.0.0.1:${port}/${TRAY ? "tray.html" : "index.html"}`);
        // The window marks when its first read settled; wait for that, not a fixed time:
        // a slow first load used to be photographed as an empty home and pass as clean.
        const missing = [];
        if (TRAY) await page.waitForTimeout(Number(process.env.V3_WAIT || 6000));
        else {
          await page
            .waitForSelector('[aria-label="Sessions window"][data-loaded="true"]', { timeout: Number(process.env.V3_WAIT || 60_000) })
            .catch(() => missing.push("first read never settled (Sessions window stays data-loaded=false)"));
          await page.waitForTimeout(1000);
          // A home with sessions must show them: an empty list there is a regression, not a clean frame.
          if (kind !== "empty" && !(await page.locator('[aria-label="Sessions"] [role="button"]').count())) missing.push("no session rows on a home that has sessions");
        }
        const first = page.locator("[aria-label='Sessions'] button, nav button").filter({ hasText: /\w/ }).first();
        const row = page.getByRole("button").filter({ hasText: kind === "forty" ? /Refactor|Investigate|Write/ : /Knowledge|agent|data|galawork/ }).first();
        // Forty: the long names sit under "Done today"; open it so they are on screen.
        if (kind === "forty") {
          await page.getByRole("button", { name: /^Done today/ }).first().click().catch(() => {});
          await page.waitForTimeout(500);
        }
        if (kind !== "empty" && (await row.count())) {
          await row.click().catch(() => {});
          await page.waitForTimeout(1200);
        } else void first;
        // V3_CLICKS="Settings ⌘,|Agents": open a page by the accessible names of its buttons.
        for (const name of (process.env.V3_CLICKS ?? "").split("|").filter(Boolean)) {
          await page.getByRole("button", { name, exact: true }).first().click().catch(() => {});
          await page.waitForTimeout(800);
        }
        if (process.env.V3_EVAL) log(JSON.stringify(await page.evaluate(process.env.V3_EVAL)));
        if (process.env.V3_PROBE)
          log(JSON.stringify(await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(); return { text: e.textContent.slice(0, 50), box: e.getBoundingClientRect().width, client: e.clientWidth, scroll: e.scrollWidth, textWidth: t.width }; }), process.env.V3_PROBE)));
        const findings = [...missing, ...(await page.evaluate(inspect)), ...errors.map((e) => `page error: ${e}`)];
        report[name] = findings;
        failed += findings.length;
        await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!process.env.V3_FULL });
        log(`${name}: ${findings.length ? findings.length + " finding(s)" : "clean"}`);
        await context.close();
      }
      seed?.cleanup?.();
    }
  } finally {
    await browser.close();
    await vite.close();
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  log(`wrote ${OUT}`);
  if (failed) {
    for (const [k, v] of Object.entries(report)) for (const f of v) console.log(`  ${k}: ${f}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
