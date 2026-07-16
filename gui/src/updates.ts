/**
 * Update checking (Approach A — check + notify, no self-install).
 *
 * The app asks the GitHub Releases API whether a newer version exists and, if
 * so, links the user to the release page to download it. It never downloads or
 * installs anything itself — real in-app auto-install (the Tauri native
 * updater) is a parked follow-up (see the "native-updater" roadmap).
 *
 * The version math + release parsing are pure and unit-tested; only
 * {@link currentVersion} and {@link fetchLatestRelease} touch the outside world.
 */

import { getVersion } from "@tauri-apps/api/app";

/** The public repo whose GitHub Releases are the update source of truth. */
export const UPDATE_REPO = "event4u-app/agent-switch";

/** Parse a version tag (`v1.2.3`, `1.2.3`, `1.2`) into numeric components.
 *  A leading `v`/`V` and any pre-release/build suffix (`-beta.1`, `+meta`) are
 *  stripped; non-numeric or missing components collapse to 0 so a malformed tag
 *  can never throw — it just compares low. */
export function parseVersion(tag: string): number[] {
  const core = String(tag)
    .trim()
    .replace(/^[vV]/, "")
    .split(/[-+]/, 1)[0]; // drop pre-release / build metadata
  return core.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Compare two version tags. Returns -1 (a<b), 0 (equal), 1 (a>b). Components
 *  are compared left-to-right; a missing component counts as 0 so `1.2` == `1.2.0`. */
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

/** The subset of the GitHub release payload the UI needs. */
export interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  notes: string;
  publishedAt: string;
}

/** Reshape a raw GitHub `releases/latest` payload into {@link ReleaseInfo}.
 *  Returns null when the payload is a draft/prerelease or lacks a tag — the UI
 *  treats that as "no usable release". Pure — no network. */
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

/** The running app version (from the Tauri app metadata). Falls back to
 *  "0.0.0" outside a Tauri context (tests) so callers never crash. */
export async function currentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

/** Fetch the latest published release. Returns null when the repo has no
 *  releases yet (404 — a normal empty state, not an error). Throws on any other
 *  network/HTTP failure so the caller can surface it distinctly.
 *
 *  Uses the webview's `fetch` directly — the GitHub API sends
 *  `Access-Control-Allow-Origin: *`, so no HTTP plugin or credential is needed;
 *  the unauthenticated endpoint is rate-limited (60/h per IP), ample for a
 *  24h/manual check. */
export async function fetchLatestRelease(repo: string = UPDATE_REPO): Promise<ReleaseInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return null; // no releases published yet
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  return parseRelease(await res.json());
}

/** The result of a single update check, as a discriminated union the UI renders
 *  directly. `current` is always present so the UI can show the running version
 *  even on failure. */
export type UpdateCheck =
  | { kind: "uptodate"; current: string; latest: string }
  | { kind: "available"; current: string; release: ReleaseInfo }
  | { kind: "no-releases"; current: string }
  | { kind: "error"; current: string; message: string };

/** Run the full check: read the current version, fetch the latest release, and
 *  classify. Never throws — a network failure becomes an `error` result. */
export async function checkForUpdate(repo: string = UPDATE_REPO): Promise<UpdateCheck> {
  const current = await currentVersion();
  try {
    const release = await fetchLatestRelease(repo);
    if (!release) return { kind: "no-releases", current };
    if (isNewer(release.tag, current)) return { kind: "available", current, release };
    return { kind: "uptodate", current, latest: release.tag };
  } catch (e) {
    return { kind: "error", current, message: e instanceof Error ? e.message : String(e) };
  }
}
