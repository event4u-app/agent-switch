#!/usr/bin/env node
/**
 * Design comparison: renders the real v3 window (design.html → V3Window with the
 * reference boards' demo data) in the same 25 states as the reference boards,
 * so every screen can be laid next to its board.
 *
 * Run it from gui/ (Tailwind resolves its content paths from the working directory):
 *   cd gui && node scripts/screenshots/design-scenes.mjs        # darcula, 1×
 *   DS_THEME=github-light DS_DSF=2 DS_OUT=/tmp/ds node gui/scripts/screenshots/design-scenes.mjs
 *   DS_ONLY=main,summary node gui/scripts/screenshots/design-scenes.mjs
 *
 * Writes <scene>.png plus findings.json (step failures and page errors) to DS_OUT.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.DS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "as-design-"));
const THEME = process.env.DS_THEME || "darcula";
const DSF = Number(process.env.DS_DSF || 1);

const ROW = [["click", "text=v3 engine: event store + ingest"], ["wait", 900]];
const CHECKOUT = [["click", "text=Checkout flow accessibility"], ["wait", 900]];
/** scene → [extra query, steps]. Names match the reference boards (view ids). */
const SCENES = {
  main: ["", ROW],
  summary: ["", [...CHECKOUT, ["click", "[aria-label^=Summary]"]]],
  conflict: ["", CHECKOUT],
  // ⌘J on macOS; elsewhere the focused terminal keeps Ctrl, so the app key becomes Ctrl+Shift+J (keys.ts).
  needs: ["", [...ROW, ["press", process.platform === "darwin" ? "Meta+j" : "Control+Shift+j"]]],
  inbox: ["", [...ROW, ["click", "[aria-label^=Sessions]"], ["wait", 300], ["click", "[title^='Needs you']"]]],
  focus: ["", [...ROW, ["click", "[aria-label^=Sessions]"]]],
  palette: ["", [...ROW, ["click", "text=Go to session"]]],
  new: ["", [...ROW, ["click", "text=Start session"]]],
  decide: ["", [...ROW, ["click", "text=Decide"]]],
  menu: ["", [...ROW, ["click", "[aria-label^='Session actions']"]]],
  openin: ["", [...ROW, ["click", "[aria-label='Open in…']"], ["click", "role=menuitem[name=/Agent app/]"]]],
  limits: ["", [...ROW, ["click", "text=side >> nth=-1"]]],
  peek: ["", [...ROW, ["hover", "text=Release plan agent-config 1.9"], ["wait", 600]]],
  model: ["", [...ROW, ["click", "[title='Model for the next turn']"]]],
  tree: ["", [...ROW, ["click", "[aria-label='Show 3 subagents']"], ["click", "[aria-label^=Children]"]]],
  changes: ["", [...ROW, ["click", "[aria-label^=Changes]"]]],
  external: ["", [["click", "text=as-hook p95 benchmark"], ["wait", 900]]],
  accounts: ["", [["click", "[aria-label^=Accounts]"]]],
  library: ["", [["click", "[aria-label^=Library]"]]],
  tools: ["", [["click", "[aria-label^=Tools]"]]],
  table: ["", [["click", "text=Go to session"], ["click", "text=All sessions"]]],
  appearance: ["", [["click", "[aria-label^=Settings]"], ["click", "role=button[name=Appearance]"]]],
  editors: ["", [["click", "[aria-label^=Settings]"], ["click", "role=button[name='Open in']"]]],
  offline: ["&health=down", ROW],
  morning: ["&away=1", ROW],
  tray: ["&view=tray", []],
};
/** Scenes with their own viewport (the board size). */
const VIEWPORT = { tray: { width: 480, height: 700 } };

const only = process.env.DS_ONLY ? new Set(process.env.DS_ONLY.split(",")) : null;
fs.mkdirSync(OUT, { recursive: true });
const vite = await createServer({ root: GUI, configFile: path.join(GUI, "vite.config.ts"), logLevel: "warn", server: { port: 0, host: "127.0.0.1", hmr: false } });
await vite.listen();
const base = vite.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch();
const findings = {};
try {
  for (const [name, [query, steps]] of Object.entries(SCENES)) {
    if (only && !only.has(name)) continue;
    const page = await browser.newPage({ viewport: VIEWPORT[name] ?? { width: 1440, height: 900 }, deviceScaleFactor: DSF });
    const errs = [];
    page.on("pageerror", (e) => errs.push(`page error: ${e.message}`));
    await page.goto(`${base}/design.html?theme=${THEME}${query}${process.env.DS_QUERY ?? ""}`);
    await page.waitForTimeout(1500);
    for (const [kind, arg] of steps) {
      try {
        if (kind === "click") await page.locator(arg).first().click({ timeout: 3000 });
        else if (kind === "hover") await page.locator(arg).first().hover({ timeout: 3000 });
        else if (kind === "press") await page.keyboard.press(arg);
        else if (kind === "wait") await page.waitForTimeout(arg);
      } catch (e) {
        errs.push(`step ${kind} ${arg}: ${String(e.message).split("\n")[0]}`);
      }
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    findings[name] = errs;
    console.log(`[design] ${name}: ${errs.length ? errs.join(" | ") : "ok"}`);
    await page.close();
  }
} finally {
  await browser.close();
  await vite.close();
}
fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2) + "\n");
console.log(`[design] wrote ${OUT}`);
