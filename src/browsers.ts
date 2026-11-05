/**
 * Which browser a provider's sign-in opens in. Claude Code opens its OAuth page
 * with `$BROWSER` when set (verified against CC 2.1.312: it spawns the value as
 * ONE executable with the URL as its only argument — `open -a X` in the
 * variable is not run). So on macOS the choice becomes a tiny wrapper script
 * that hands the URL to that app; on Linux the browser binary itself is the
 * executable. Windows is not offered: nothing here has verified an override.
 *
 * Isolated sign-in (road-to-a-chat-that-reads-well Phase 5): a Chromium-family
 * browser started normally — no automation flags, so Google SSO treats it as
 * the user's own browser — with one `--user-data-dir` per account. Each
 * account then keeps its own Google login, and `agent-switch web` uses the
 * same folder, so web and CLI are one identity. Never an embedded webview:
 * Google refuses OAuth there (`disallowed_useragent`).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface BrowserInfo {
  id: string;
  name: string;
  /** A Chromium-family browser that takes `--user-data-dir`: it can keep one profile per account. */
  isolatable: boolean;
}

/** Chromium-family browsers whose `--user-data-dir` is documented. Arc and Dia
 *  manage profiles themselves and are left out until verified. */
const ISOLATABLE = new Set(["chrome", "chrome-canary", "chromium", "brave", "edge", "vivaldi"]);

export const isIsolatable = (id: string) => ISOLATABLE.has(id);

export interface BrowserDeps {
  platform: NodeJS.Platform;
  home: string;
  exists: (p: string) => boolean;
  /** Absolute path of an executable on PATH, or null. */
  which: (binary: string) => string | null;
}

const MAC: { id: string; name: string; app: string }[] = [
  { id: "safari", name: "Safari", app: "Safari" },
  { id: "chrome", name: "Google Chrome", app: "Google Chrome" },
  { id: "chrome-canary", name: "Google Chrome Canary", app: "Google Chrome Canary" },
  { id: "firefox", name: "Firefox", app: "Firefox" },
  { id: "firefox-dev", name: "Firefox Developer Edition", app: "Firefox Developer Edition" },
  { id: "arc", name: "Arc", app: "Arc" },
  { id: "brave", name: "Brave", app: "Brave Browser" },
  { id: "edge", name: "Microsoft Edge", app: "Microsoft Edge" },
  { id: "vivaldi", name: "Vivaldi", app: "Vivaldi" },
  { id: "opera", name: "Opera", app: "Opera" },
  { id: "chromium", name: "Chromium", app: "Chromium" },
  { id: "zen", name: "Zen", app: "Zen" },
  { id: "orion", name: "Orion", app: "Orion" },
  { id: "dia", name: "Dia", app: "Dia" },
  { id: "librewolf", name: "LibreWolf", app: "LibreWolf" },
];

const LINUX: { id: string; name: string; bins: string[] }[] = [
  { id: "chrome", name: "Google Chrome", bins: ["google-chrome", "google-chrome-stable"] },
  { id: "chromium", name: "Chromium", bins: ["chromium", "chromium-browser"] },
  { id: "firefox", name: "Firefox", bins: ["firefox"] },
  { id: "brave", name: "Brave", bins: ["brave-browser", "brave"] },
  { id: "edge", name: "Microsoft Edge", bins: ["microsoft-edge", "microsoft-edge-stable"] },
  { id: "vivaldi", name: "Vivaldi", bins: ["vivaldi", "vivaldi-stable"] },
  { id: "librewolf", name: "LibreWolf", bins: ["librewolf"] },
];

/** The .app bundle (macOS) or binary (Linux) for a browser id; null when it is
 *  unknown or not installed. */
export function locateBrowser(id: string, deps: BrowserDeps): string | null {
  if (deps.platform === "darwin") {
    const b = MAC.find((x) => x.id === id);
    if (!b) return null;
    // macOS paths are POSIX whatever platform runs this (tests run on Windows too).
    for (const dir of ["/Applications", path.posix.join(deps.home, "Applications")]) {
      const app = path.posix.join(dir, `${b.app}.app`);
      if (deps.exists(app)) return app;
    }
    return null;
  }
  if (deps.platform === "linux") {
    const b = LINUX.find((x) => x.id === id);
    for (const bin of b?.bins ?? []) {
      const p = deps.which(bin);
      if (p) return p;
    }
    return null;
  }
  return null;
}

export function listBrowsers(deps: BrowserDeps): BrowserInfo[] {
  const known = deps.platform === "darwin" ? MAC : deps.platform === "linux" ? LINUX : [];
  return known.filter((b) => locateBrowser(b.id, deps) !== null).map(({ id, name }) => ({ id, name, isolatable: ISOLATABLE.has(id) }));
}

/** POSIX wrapper for `$BROWSER` that opens its URL argument in one macOS app. */
export function browserWrapperScript(appPath: string): string {
  const quoted = `'${appPath.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\nexec /usr/bin/open -a ${quoted} "$@"\n`;
}

/**
 * POSIX wrapper for `$BROWSER` that opens its URL in a Chromium-family browser
 * with its own profile folder. macOS starts a new instance with `open -na` (a
 * running instance with the same folder takes the URL over); Linux runs the
 * binary. The flags only skip first-run screens. Pure.
 */
export function isolatedWrapperScript(platform: NodeJS.Platform, located: string, userDataDir: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const flags = `--user-data-dir=${q(userDataDir)} --no-first-run --no-default-browser-check`;
  return platform === "darwin" ? `#!/bin/sh\nexec /usr/bin/open -na ${q(located)} --args ${flags} "$@"\n` : `#!/bin/sh\nexec ${q(located)} ${flags} "$@"\n`;
}

/** The first installed browser that can keep one profile per account, or null. */
export function firstIsolatable(deps: BrowserDeps): string | null {
  return listBrowsers(deps).find((b) => b.isolatable)?.id ?? null;
}

/** `$BROWSER` wrapper that hands the URL to `agent-switch sign-in-browser` in the
 *  background (the caller must not wait on a browser window). Pure. */
export function playwrightWrapperScript(node: string, cli: string, userDataDir: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\n${q(node)} ${q(cli)} sign-in-browser --dir ${q(userDataDir)} "$@" >/dev/null 2>&1 &\nexit 0\n`;
}

function whichOnPath(binary: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, binary);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* not here */
    }
  }
  return null;
}

export function defaultBrowserDeps(home: string): BrowserDeps {
  return { platform: process.platform, home, exists: (p) => fs.existsSync(p), which: whichOnPath };
}
