/**
 * Whether a dev checkout runs the code it holds. The dev GUI and the launchd
 * engine run the checkout's `dist/`; `npm run build` and an engine restart are
 * manual steps, so a merge that only touched `src/` leaves both on the old
 * code without any error — features then just do not show. This reports it;
 * it never builds or restarts anything itself.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { DoctorCheck } from "./doctor.js";

/** A changed file this much newer than the build still counts as built (clock and write-order slack). */
const SLACK_MS = 2000;
const MAX_FILES = 5000;

/** The checkout a `dist/index.js` belongs to; null for an installed package, which ships no `src/`. */
export function checkoutOf(distIndex: string): string | null {
  const root = path.dirname(path.dirname(distIndex));
  return fs.existsSync(path.join(root, "src")) && fs.existsSync(path.join(root, "package.json")) ? root : null;
}

function newestMtime(dir: string): number {
  let newest = 0;
  let seen = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > MAX_FILES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".ts")) newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/** When `dist/` was built: tsc rewrites `dist/index.js` on every build. */
export function builtAt(root: string): number | null {
  try {
    return fs.statSync(path.join(root, "dist", "index.js")).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * `distStale`: a source file is newer than the build. `engineStale`: the engine
 * started on an older build than the one on disk now (`engineBuild` is what it
 * recorded at start; null when unknown, which is never called stale).
 */
export function buildFreshness(root: string, engineBuild: number | null): { distStale: boolean; engineStale: boolean } {
  const built = builtAt(root);
  if (built === null) return { distStale: true, engineStale: false };
  return {
    distStale: newestMtime(path.join(root, "src")) > built + SLACK_MS,
    engineStale: engineBuild !== null && engineBuild + SLACK_MS < built,
  };
}

export function buildFreshnessCheck(f: { distStale: boolean; engineStale: boolean }): DoctorCheck {
  if (!f.distStale && !f.engineStale) return { id: "checkout-build", status: "ok", title: "This checkout runs its own code", detail: "" };
  const steps = [f.distStale ? "npm run build" : null, f.engineStale || f.distStale ? "agent-switch service restart" : null].filter(Boolean);
  return {
    id: "checkout-build",
    status: "warn",
    title: f.distStale ? "This checkout's build is older than its source" : "The engine runs an older build than this checkout",
    detail: "The app and the engine run dist/, so newer features stay hidden until you rebuild and restart.",
    fix: steps.join(" && "),
  };
}
