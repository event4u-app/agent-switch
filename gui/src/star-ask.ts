/** The GitHub-star ask, on agent-config's cadence (its ADR-301): the first ask
 *  a week after Agent Switch first ran here, then at most once per 30 days,
 *  stopped for good by the user's own word. Nothing is fetched — whether the
 *  user starred is what they told us, never a GitHub lookup. */

export const REPO_URL = "https://github.com/event4u-app/agent-switch";
export const REDDIT_POST_URL = "https://www.reddit.com/r/ClaudeCode/comments/1xjt9k7";
export const SHARE_TEXT = "Agent Switch — keep several Claude Code, Codex and Antigravity accounts side by side, free & open source.";

const DAY_MS = 24 * 60 * 60_000;
export const STAR_ASK_FIRST_DELAY_MS = 7 * DAY_MS;
export const STAR_ASK_INTERVAL_MS = 30 * DAY_MS;

const STAR_ASK_KEY = "agent-switch-star-ask";

export type StarAskStop = "starred" | "off";

export interface StarAskState {
  firstSeen: number;
  lastShown: number | null;
  stopped: StarAskStop | null;
}

export function starAskDue(st: StarAskState, now: number): boolean {
  if (st.stopped) return false;
  if (st.lastShown === null) return now - st.firstSeen >= STAR_ASK_FIRST_DELAY_MS;
  return now - st.lastShown >= STAR_ASK_INTERVAL_MS;
}

function parse(raw: string | null): StarAskState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StarAskState>;
    if (!Number.isFinite(v.firstSeen)) return null;
    return {
      firstSeen: v.firstSeen as number,
      lastShown: Number.isFinite(v.lastShown) ? (v.lastShown as number) : null,
      stopped: v.stopped === "starred" || v.stopped === "off" ? v.stopped : null,
    };
  } catch {
    return null;
  }
}

function write(st: StarAskState): boolean {
  try {
    localStorage.setItem(STAR_ASK_KEY, JSON.stringify(st));
    return true;
  } catch {
    return false;
  }
}

/** The stored state; the first read stamps `now` as the first run. */
export function readStarAsk(now: number): StarAskState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STAR_ASK_KEY);
  } catch {
    /* blocked storage reads as a fresh install, which is never due */
  }
  const st = parse(raw);
  if (st) return st;
  const fresh: StarAskState = { firstSeen: now, lastShown: null, stopped: null };
  write(fresh);
  return fresh;
}

/** Counts a showing before it is shown. False when it could not be stored —
 *  the caller then shows nothing, so a broken store never asks every launch. */
export function recordStarAskShown(now: number): boolean {
  return write({ ...readStarAsk(now), lastShown: now });
}

export function setStarAskStopped(stop: StarAskStop): void {
  const now = Date.now();
  write({ ...readStarAsk(now), stopped: stop });
}

export interface ShareLink {
  id: "reddit" | "x" | "linkedin" | "facebook" | "bluesky";
  label: string;
  url: string;
}

export function shareLinks(): ShareLink[] {
  const url = encodeURIComponent(REPO_URL);
  const text = encodeURIComponent(SHARE_TEXT);
  return [
    { id: "reddit", label: "Reddit", url: REDDIT_POST_URL },
    { id: "x", label: "X", url: `https://x.com/intent/post?text=${text}&url=${url}` },
    { id: "linkedin", label: "LinkedIn", url: `https://www.linkedin.com/sharing/share-offsite/?url=${url}` },
    { id: "facebook", label: "Facebook", url: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    { id: "bluesky", label: "Bluesky", url: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${SHARE_TEXT} ${REPO_URL}`)}` },
  ];
}

/** TikTok and Instagram have no web share link; this is what gets copied for them. */
export const SHARE_CLIPBOARD_TEXT = `${SHARE_TEXT}\n${REPO_URL}`;
