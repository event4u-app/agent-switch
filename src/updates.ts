/**
 * CLI update check + self-update.
 *
 * Mirrors the GUI's update logic (gui/src/updates.ts): the same version math
 * and GitHub `/releases/latest` parsing, but for the CLI — the running version
 * comes from the package's own package.json, the fetch uses Node's global
 * `fetch`, and `selfUpdate` reinstalls the npm package.
 *
 * The version/parse helpers are pure and unit-tested; only currentVersion,
 * fetchLatestRelease, and selfUpdate touch the outside world.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The published npm package + the repo whose GitHub Releases are the update source. */
export const PACKAGE_NAME = "@event4u/agent-switch";
export const UPDATE_REPO = "event4u-app/agent-switch";

/** Parse a version tag (`v1.2.3`, `1.2.3`, `1.2`) into numeric components. A
 *  leading `v`/`V` and any pre-release/build suffix are stripped; non-numeric
 *  components collapse to 0 so a malformed tag can never throw. */
export function parseVersion(tag: string): number[] {
  const core = String(tag).trim().replace(/^[vV]/, "").split(/[-+]/, 1)[0];
  return core.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Compare two version tags: -1 (a<b), 0 (equal), 1 (a>b). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** True when `latest` is strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

export interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  notes: string;
  publishedAt: string;
}

/** Reshape a raw GitHub `releases/latest` payload into {@link ReleaseInfo}, or
 *  null for a draft/prerelease or a payload without a tag. Pure — no network. */
export function parseRelease(raw: unknown): ReleaseInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const tag = typeof r.tag_name === "string" ? r.tag_name : "";
  if (!tag) return null;
  return {
    tag,
    name: typeof r.name === "string" && r.name ? r.name : tag,
    url: typeof r.html_url === "string" ? r.html_url : `https://github.com/${UPDATE_REPO}/releases`,
    notes: typeof r.body === "string" ? r.body : "",
    publishedAt: typeof r.published_at === "string" ? r.published_at : "",
  };
}

/** The running CLI's version, from the package's own package.json (one level up
 *  from the compiled dist/). "0.0.0" if unreadable so callers never crash. */
export function currentVersion(): string {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(fs.readFileSync(pkg, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Latest published release, or null when the repo has none yet (404). Throws
 *  on other network/HTTP failures so the caller can surface them. */
export async function fetchLatestRelease(repo: string = UPDATE_REPO): Promise<ReleaseInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `${PACKAGE_NAME} cli-updater` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  return parseRelease(await res.json());
}

export type UpdateCheck =
  | { kind: "uptodate"; current: string; latest: string }
  | { kind: "available"; current: string; release: ReleaseInfo }
  | { kind: "no-releases"; current: string }
  | { kind: "error"; current: string; message: string };

/** Read the current version, fetch the latest release, classify. Never throws. */
export async function checkForUpdate(repo: string = UPDATE_REPO): Promise<UpdateCheck> {
  const current = currentVersion();
  try {
    const release = await fetchLatestRelease(repo);
    if (!release) return { kind: "no-releases", current };
    if (isNewer(release.tag, current)) return { kind: "available", current, release };
    return { kind: "uptodate", current, latest: release.tag };
  } catch (e) {
    return { kind: "error", current, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Self-update: reinstall the npm package at @latest (global). Streams npm's
 *  own output; returns its exit code (0 = success). */
export function selfUpdate(): number {
  const r = spawnSync("npm", ["install", "-g", `${PACKAGE_NAME}@latest`], { stdio: "inherit" });
  return r.status ?? 1;
}
