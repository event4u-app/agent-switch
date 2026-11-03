#!/usr/bin/env node
/**
 * End-to-end check of the v3.1 chat view (spec §10.8), offline:
 *
 *   npm --prefix gui run v31-chat
 *
 * A seeded home, the real CLI (`agent-switch bridge`) and a stand-in Claude
 * that replays a recorded session (fake-claude.mjs). In the browser: the
 * palette's "New session in chat view", a message, the approval card, "Allow
 * once", the answer. Then the chat board at 1440×900 in three themes with the
 * render checks of v3-render.mjs. A finding or a missing step fails the run.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
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
import { inspect } from "./v3-render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI = path.resolve(HERE, "../..");
const CLI = path.resolve(GUI, "..", "dist", "index.js");
const OUT = process.env.V31_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "as-v31-chat-"));
const THEMES = [
  ["darcula", { mode: "dark", dark: "darcula", light: "github-light" }],
  ["github-light", { mode: "light", dark: "darcula", light: "github-light" }],
  ["github-dark-hc", { mode: "dark", dark: "github-dark-hc", light: "github-light" }],
];
const log = (...a) => console.log("[v31-chat]", ...a);

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

function seed() {
  const s = seedHome(CLI, Date.now());
  const wrapper = path.join(s.home, "fake-claude");
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, "fake-claude.mjs")}" "$@"\n`, { mode: 0o755 });
  const stateFile = path.join(s.ash, "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.binaryPaths = { ...(state.binaryPaths ?? {}), claude: wrapper };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return s;
}

/** A small repository with a committed feature, a staged, an unstaged and a new file — what the Review page reads. */
function reviewRepo(home) {
  const r = path.join(home, "repo");
  fs.mkdirSync(path.join(r, "src", "engine"), { recursive: true });
  const g = (...a) => spawnSync("git", ["-C", r, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(r, "src", "engine", "ingest.ts"), "export function ingest(lines: string[]) {\n  return lines.map((l) => l.trim());\n}\n");
  fs.writeFileSync(path.join(r, "src", "engine", "store.ts"), "export const store = new Map<string, string>();\n");
  g("add", ".");
  g("commit", "-qm", "base");
  g("checkout", "-qb", "feat/ingest");
  fs.writeFileSync(path.join(r, "src", "engine", "ingest.ts"), "export function ingest(lines: string[]) {\n  return lines.map((l) => l.trim()).filter(Boolean);\n}\n");
  g("commit", "-qam", "skip blank lines");
  fs.writeFileSync(path.join(r, "src", "engine", "store.ts"), "export const store = new Map<string, string>();\nexport const size = () => store.size;\n");
  g("add", "src/engine/store.ts");
  fs.writeFileSync(path.join(r, "src", "engine", "ingest.ts"), "export function ingest(lines: string[]) {\n  // Blank lines carry no event.\n  return lines.map((l) => l.trim()).filter(Boolean);\n}\n");
  fs.writeFileSync(path.join(r, "hello.txt"), "hi\n");
  return r;
}

/** `diff <key> …` against the prepared repository: the real review code; only the session → folder lookup is replaced. */
function diffInRepo(repo, args, env) {
  const [, key, action] = args;
  const flag = (n) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : undefined);
  const t = { key, provider: "claude", account: "work", sessionId: "x", cwd: repo, transcript: null };
  const mod = path.resolve(GUI, "..", "dist", "commands", "diff.js");
  const body = action && !action.startsWith("--")
    ? `const r = action === "undo" ? { done: d.undo(t) } : action === "commit" ? { commit: d.commitStaged(t, flag.message) } : d.act(t, action, flag.file, flag.hunk ?? null); console.log(JSON.stringify({ ok: true, ...r }));`
    : `console.log(JSON.stringify({ key: t.key, scope: flag.scope, shared: [], ...d.review(t, flag.scope ?? "worktree") }));`;
  const code = `const d = await import(${JSON.stringify(mod)}); const t = ${JSON.stringify(t)}; const action = ${JSON.stringify(action)}; const flag = ${JSON.stringify({ scope: flag("scope"), file: flag("file"), hunk: flag("hunk"), message: flag("message") })}; try { ${body} } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 2; }`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, encoding: "utf8", timeout: 20_000 });
}

const FIXED = new Set(["status", "auth-status", "tooling", "doctor", "apps", "providers"]);

async function main() {
  if (!fs.existsSync(CLI)) throw new Error("dist/index.js missing — npm run build first");
  fs.mkdirSync(OUT, { recursive: true });
  const port = await freePort();
  const vite = await createServer({ root: GUI, configFile: path.join(GUI, "vite.config.ts"), logLevel: "warn", clearScreen: false, server: { port, strictPort: true, host: "127.0.0.1", hmr: false } });
  await vite.listen();
  const browser = await chromium.launch();
  const findings = {};
  let failed = 0;
  try {
    for (const [theme, a] of THEMES) {
      const s = seed();
      const repo = reviewRepo(s.home);
      const kids = new Map();
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: a.mode === "light" ? "light" : "dark", locale: "en-US" });
      await context.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.exposeFunction("__asLog", () => {});
      await page.exposeFunction("__asHost", async ({ program, args, options }) => {
        const ok = (stdout) => ({ code: 0, signal: null, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "" });
        if (program === "agent-config-version") return ok("18.2.0\n");
        if (FIXED.has(args[0])) {
          if (args[0] === "status") return ok(fx.statusJson("claude", args[3] ?? "work", Date.now()));
          return ok(args[0] === "tooling" ? fx.TOOLING : args[0] === "doctor" ? fx.DOCTOR : args[0] === "apps" ? fx.APPS : args[0] === "providers" ? fx.PROVIDERS_STATUS : []);
        }
        const r = args[0] === "diff" ? diffInRepo(repo, args, s.env) : spawnSync(process.execPath, [CLI, ...args], { env: s.env, encoding: "utf8", cwd: options?.cwd || s.home, timeout: 20_000 });
        return { code: r.status ?? 1, signal: null, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
      });
      await page.exposeFunction("__asSpawn", async ({ args }) => {
        const child = nodeSpawn(process.execPath, [CLI, ...args], { env: s.env, cwd: s.home, stdio: ["pipe", "pipe", "pipe"] });
        let buf = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            void page.evaluate(([pid, l]) => window.__asChild(pid, { event: "Stdout", payload: l }), [child.pid, line]).catch(() => {});
          }
        });
        child.on("exit", (code) => void page.evaluate(([pid, c]) => window.__asChild(pid, { event: "Terminated", payload: { code: c, signal: null } }), [child.pid, code]).catch(() => {}));
        kids.set(child.pid, child);
        return child.pid;
      });
      await page.exposeFunction("__asStdin", (pid, data) => void kids.get(pid)?.stdin.write(data));
      await page.exposeFunction("__asKill", (pid) => void kids.get(pid)?.kill());
      const statics = fx.invokeStatic(Date.now());
      delete statics._now;
      await page.addInitScript(installTauriShim, { statics, windowLabel: "main", storage: { "agent-switch-ui-window": "v3", "agent-switch-appearance": JSON.stringify({ ...a, accent: "theme", terminalFollows: true }) } });
      await page.goto(`http://127.0.0.1:${port}/index.html`);
      await page.waitForTimeout(5000);

      const step = async (name, fn) => {
        try {
          await fn();
        } catch (e) {
          (findings[theme] ??= []).push(`step failed: ${name} — ${String(e.message).split("\n")[0]}`);
          throw e;
        }
      };
      try {
        await step("open the palette", () => page.getByText("Go to session, account, branch, PR, or run a command…").click());
        await step("New session in chat view", async () => {
          await page.keyboard.type("New session in chat view");
          await page.getByText("New session in chat view").first().click();
        });
        await step("the chat is ready", () => page.getByLabel("Message").and(page.locator(":not([disabled])")).waitFor({ timeout: 15_000 }));
        await step("send a message", async () => {
          await page.getByLabel("Message").fill("Write hello.txt containing hi");
          await page.keyboard.press("Enter");
        });
        await step("the approval card appears", () => page.getByText("Claude wants to change a file").waitFor({ timeout: 15_000 }));
        await page.screenshot({ path: path.join(OUT, `chat-approval-${theme}.png`) });
        (findings[theme] ??= []).push(...(await page.evaluate(inspect)));
        await step("allow once", () => page.getByText("Allow once").click());
        await step("the answer arrives", () => page.getByText(/^done$/i).first().waitFor({ timeout: 15_000 }));
        await step("the card shows the decision", () => page.getByText(/Write allowed/).waitFor({ timeout: 5_000 }));
        await page.screenshot({ path: path.join(OUT, `chat-done-${theme}.png`) });
        (findings[theme] ??= []).push(...(await page.evaluate(inspect)));
        await step("open Changes", () => page.getByLabel("Changes", { exact: true }).click());
        await step("Review changes", () => page.getByText("Review changes").click());
        await step("the review lists the files", () => page.getByText("3 files changed").waitFor({ timeout: 15_000 }));
        await page.screenshot({ path: path.join(OUT, `review-${theme}.png`) });
        (findings[theme] ??= []).push(...(await page.evaluate(inspect)));
        await step("stage a hunk", () => page.getByText("Stage hunk").first().click());
        await step("git staged it", () => page.getByText(/^Staged /).first().waitFor({ timeout: 15_000 }));
        await step("split layout", () => page.getByRole("radio", { name: "Split" }).click());
        await page.screenshot({ path: path.join(OUT, `review-split-${theme}.png`) });
        (findings[theme] ??= []).push(...(await page.evaluate(inspect)), ...errors.map((e) => `page error: ${e}`));
      } catch {
        await page.screenshot({ path: path.join(OUT, `chat-failed-${theme}.png`) });
      }
      for (const k of kids.values()) k.kill();
      const f = [...new Set(findings[theme] ?? [])];
      findings[theme] = f;
      failed += f.length;
      log(`${theme}: ${f.length ? `${f.length} finding(s)` : "clean"}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await vite.close();
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(findings, null, 2) + "\n");
  log(`wrote ${OUT}`);
  if (failed) {
    for (const [k, v] of Object.entries(findings)) for (const f of v) console.log(`  ${k}: ${f}`);
    process.exitCode = 1;
  }
}

// Exposed functions and child pipes keep the loop alive; the run is over.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
