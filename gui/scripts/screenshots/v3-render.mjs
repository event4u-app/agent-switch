#!/usr/bin/env node
/**
 * Render check for the v3 window on real CLI output (spec §14):
 *
 *   npm --prefix gui run v3-render     (runs from gui/, where Tailwind finds its config)
 *
 * Three themes (darcula, github-light, github-dark-hc) × three data shapes
 * (the seeded demo home; 40 sessions with long names; no sessions) at
 * 1440×900, each with a session tab open where one exists. The engine is not
 * running in the seeded home, so every frame also shows the engine-down state.
 *
 * Per frame it checks: no page scroll, no text clipped without an ellipsis, no
 * button, tab or menu entry wrapped onto a second line, nothing outside the
 * window. Findings and PNGs go to V3_OUT (default: a temp dir); a finding
 * fails the run. The PNGs show the seeded temp home's paths and are not for
 * publishing.
 */

import { spawnSync } from "node:child_process";
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
const VIEWPORT = { width: 1440, height: 900 };
const THEMES = [
  ["darcula", { mode: "dark", dark: "darcula", light: "github-light" }],
  ["github-light", { mode: "light", dark: "darcula", light: "github-light" }],
  ["github-dark-hc", { mode: "dark", dark: "github-dark-hc", light: "github-light" }],
];
const CASES = process.env.V3_CASES ? process.env.V3_CASES.split(",") : ["seeded", "forty", "empty"];
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

function bridge(seed) {
  const ok = (stdout) => ({ code: 0, signal: null, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "" });
  return async ({ program, args = [], options }) => {
    if (program === "agent-config-version") return ok("18.2.0\n");
    if (program !== "agent-switch" && !program.startsWith("as-read-")) return { code: 1, signal: null, stdout: "", stderr: "not in the harness" };
    const [cmd, sub] = args;
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
function inspect() {
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
    if (r.right > innerWidth + 1 && !el.closest("[aria-hidden=true]")) out.push(`outside the window: <${el.tagName.toLowerCase()}> "${label(el)}" right=${Math.round(r.right)}`);
  }
  // Text whose glyphs run past the edge of a clipping ancestor: the element itself
  // may be wide enough, so the check above cannot see it.
  const clips = (a) => ["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(a).overflowX);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const host = n.parentElement;
    if (!n.textContent.trim() || !host || host.closest(".sr-only,[role=log],.xterm")) continue;
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
      const seed = seedHome(CLI, Date.now());
      shape(seed, kind);
      const handle = bridge(seed);
      for (const [theme, a] of THEMES) {
        const name = `${kind}-${theme}`;
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: Number(process.env.V3_DSF || 1), colorScheme: a.mode === "light" ? "light" : "dark", locale: "en-US", timezoneId: "Europe/Berlin" });
        await context.route(/^(?!http:\/\/127\.0\.0\.1).*/, (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.exposeFunction("__asHost", handle);
        await page.exposeFunction("__asLog", () => {});
        const appearance = JSON.stringify({ ...a, accent: "theme", terminalFollows: true });
        await page.addInitScript(installTauriShim, { statics, windowLabel: "main", storage: { "agent-switch-ui-window": "v3", "agent-switch-appearance": appearance } });
        await page.goto(`http://127.0.0.1:${port}/index.html`);
        await page.waitForTimeout(6000);
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
        if (process.env.V3_EVAL) log(JSON.stringify(await page.evaluate(process.env.V3_EVAL)));
        if (process.env.V3_PROBE)
          log(JSON.stringify(await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(); return { text: e.textContent.slice(0, 50), box: e.getBoundingClientRect().width, client: e.clientWidth, scroll: e.scrollWidth, textWidth: t.width }; }), process.env.V3_PROBE)));
        const findings = [...(await page.evaluate(inspect)), ...errors.map((e) => `page error: ${e}`)];
        report[name] = findings;
        failed += findings.length;
        await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!process.env.V3_FULL });
        log(`${name}: ${findings.length ? findings.length + " finding(s)" : "clean"}`);
        await context.close();
      }
      seed.cleanup?.();
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

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
