#!/usr/bin/env node
/**
 * Reach check for the session bar's two menus (roadmap 7.5): with a right panel
 * open, or in a narrow window, the Open-in caret and the ⋯ button stay clickable
 * and each menu opens under its own trigger, whole and clickable.
 *
 *   npx vite --port 5199 --strictPort        (from gui/, in another shell)
 *   node scripts/screenshots/v3-reach.mjs    (V3_URL overrides the server)
 *
 * Uses the design embed (`embed.html?view=…`) on fixture data; nothing real runs.
 * Each case asks the browser what is under the centre of every control and menu
 * row (elementFromPoint), so a control painted over or clipped away fails. Any
 * failure exits 1.
 */

import { chromium } from "playwright";

const BASE = process.env.V3_URL ?? "http://localhost:5199";
const CASES = [
  { view: "summary", width: 1440 },
  { view: "main", width: 1440, click: "Changes" },
  { view: "main", width: 1440, click: "Children" },
  { view: "summary", width: 1100 },
  { view: "main", width: 1100 },
  { view: "main", width: 1280 },
];
const TRIGGERS = [
  { name: "Open in…", menu: "Open in" },
  { name: "Session actions", menu: "Session actions" },
];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let failed = 0;
for (const c of CASES) {
  await page.setViewportSize({ width: c.width, height: 900 });
  await page.goto(`${BASE}/embed.html?view=${c.view}&theme=darcula`);
  await page.waitForSelector("[data-v3-shell]");
  if (c.click) await page.getByRole("button", { name: c.click, exact: true }).first().click();
  await page.waitForTimeout(800);
  for (const t of TRIGGERS) {
    const r = await page.evaluate(async ({ name, menu }) => {
      const hit = (el) => {
        const b = el.getBoundingClientRect();
        const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { ok: b.width > 0 && !!at && (at === el || el.contains(at)), b };
      };
      const btn = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") ?? "").startsWith(name));
      if (!btn) return { error: "trigger missing" };
      const trig = hit(btn);
      if (!trig.ok) return { error: `trigger not clickable at x=${Math.round(trig.b.x)}` };
      btn.click();
      await new Promise((res) => setTimeout(res, 100));
      const m = document.querySelector(`[role="menu"][aria-label="${menu}"]`);
      if (!m) return { error: "menu did not open" };
      const mb = m.getBoundingClientRect();
      const rows = [...m.querySelectorAll('[role="menuitem"]')];
      const blocked = rows.filter((row) => !hit(row).ok).map((row) => row.textContent);
      const under = mb.top >= trig.b.bottom - 1 && mb.top <= trig.b.bottom + 12 && Math.abs(mb.right - trig.b.right) <= 2;
      const focused = m.contains(document.activeElement);
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await new Promise((res) => setTimeout(res, 50));
      return { blocked, under, focused, rows: rows.length };
    }, t);
    const bad = r.error ?? (r.blocked.length ? `rows not clickable: ${r.blocked.join(", ")}` : !r.under ? "menu not under its trigger" : !r.focused ? "menu did not take focus" : null);
    console.log(`${bad ? "FAIL" : "ok  "} ${c.view}${c.click ? ` + ${c.click}` : ""} ${c.width}px · ${t.name}${bad ? ` — ${bad}` : ` (${r.rows} rows)`}`);
    if (bad) failed++;
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
