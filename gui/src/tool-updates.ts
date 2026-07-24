/**
 * Latest-version lookups for the third-party tools in the Tooling section
 * (same Approach A as updates.ts — check + notify; the actual upgrade still
 * runs visibly in the embedded terminal). One lookup round per sweep, cached
 * by the parent WITH the tooling readout so the Update buttons and the rows
 * always age (and invalidate) together.
 *
 * agent-config is deliberately absent here: App's banner detection (GitHub
 * Releases via fetchLatestRelease) is the single source for its latest
 * version — fetching it twice would let the banner and the row disagree.
 * agy has no known release source, so it stays unknown (→ no button).
 */

import { fetchLatestRelease, isNewer } from "./updates.js";
import type { ToolingEntry, ToolingId } from "./ipc.js";

/** The public repo whose GitHub Releases are rtk's update source of truth. */
export const RTK_REPO = "rtk-ai/rtk";

/** npm registry packages for the npm-distributed provider CLIs. */
export const NPM_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
} as const satisfies Partial<Record<ToolingId, string>>;

/** Tools whose latest version the GUI checks itself during a sweep. */
export const UPDATE_CHECK_TOOLS: ReadonlySet<ToolingId> = new Set(["rtk", "claude", "codex"]);

/** Latest published version of an npm package via the registry's `/latest`
 *  dist-tag endpoint (CORS-open, unauthenticated — same posture as the GitHub
 *  check in updates.ts). Null on any failure: offline, timeout, 4xx/5xx,
 *  malformed body — an unknown latest must never break the sweep. */
async function npmLatestVersion(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" && body.version ? body.version : null;
  } catch {
    return null;
  }
}

/** Latest known version for a tool, or null when it cannot be determined —
 *  no source for this id, offline, timeout, or rate-limited. Never throws:
 *  a failed check means "unknown", and unknown renders as no button. */
export async function latestToolVersion(id: ToolingId): Promise<string | null> {
  try {
    if (id === "rtk") {
      const release = await fetchLatestRelease(RTK_REPO);
      return release ? release.tag.replace(/^[vV]/, "") : null;
    }
    if (id === "claude" || id === "codex") return await npmLatestVersion(NPM_PACKAGES[id]);
    return null; // agent-config (App's detection is the single source) + agy (no source)
  } catch {
    return null; // fetchLatestRelease throws on non-404 HTTP failures (e.g. rate limit)
  }
}

/** The leading dotted-number token of a version string (`v0.43.0` → `0.43.0`,
 *  `1.2.3-beta.1` → `1.2.3`, `1.2.3 (build 7)` → `1.2.3`); null when there is
 *  none (garbage) — the caller must treat that as not comparable. Pure. */
export function versionToken(raw: string): string | null {
  const m = String(raw)
    .trim()
    .replace(/^[vV]/, "")
    .match(/^\d+(\.\d+)*/);
  return m ? m[0] : null;
}

/** True only when `latest` is known AND strictly newer than the installed
 *  version — the honest gate for rendering an Update button. Unknown latest,
 *  unknown installed version, or garbage on either side → false (no
 *  speculative button). Pure. */
export function toolUpdateAvailable(entry: Pick<ToolingEntry, "version">, latest: string | null): boolean {
  if (!latest || !entry.version) return false;
  const l = versionToken(latest);
  const c = versionToken(entry.version);
  if (!l || !c) return false;
  return isNewer(l, c);
}
