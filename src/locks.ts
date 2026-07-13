/**
 * Cooperate with Claude Code's own advisory locks while reading its files.
 *
 * Protocol adopted from claude-swap's claude_locks.py (which documents
 * claude-code's utils/auth.ts, utils/config.ts, utils/lockfile.ts):
 *
 * - Claude Code guards its OAuth token refresh with npm `proper-lockfile` on
 *   the config home dir, and its ~/.claude.json writes on the config file.
 * - The lock artifact is a DIRECTORY at "<target>.lock"; mkdir atomicity is
 *   the mutex. A lock is stale when its mtime is older than 10s; live holders
 *   touch every 5s. Claude Code retries a held credentials lock 5x with 1-2s
 *   jittered sleeps, so briefly holding it is fully cooperative.
 *
 * Why we need it: `agent-switch import` snapshots the live default credential. A
 * read landing inside Claude Code's refresh window (read → network → save,
 * all under ~/.claude.lock) could capture a pre-rotation refresh token that
 * is dead the moment the refresh saves. Holding the lock during the read
 * closes that race.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const STALENESS_MS = 10_000;
const TOUCH_INTERVAL_MS = 3_000; // faster than claude-code's 5s, for margin
const DEFAULT_TIMEOUT_MS = 9_000;
const RETRY_SLEEP_MS = 250;

function lockDirFor(target: string): string {
  return path.join(path.dirname(target), path.basename(target) + ".lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Acquire a proper-lockfile-compatible directory lock; run fn; release. */
export async function withProperLock<T>(
  target: string,
  fn: () => T | Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const lockDir = lockDirFor(target);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      fs.mkdirSync(lockDir); // atomic acquire
      break;
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      // Held — take over if stale, else wait.
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockDir).mtimeMs > STALENESS_MS;
      } catch {
        continue; // vanished between mkdir and stat — retry immediately
      }
      if (stale) {
        try {
          fs.rmdirSync(lockDir);
        } catch {
          /* raced with another taker — loop */
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for Claude Code's lock at ${lockDir} — ` +
            `a running session may be mid-refresh; retry in a moment`,
        );
      }
      await sleep(RETRY_SLEEP_MS);
    }
  }

  const toucher = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(lockDir, now, now);
    } catch {
      /* released early / removed — nothing to do */
    }
  }, TOUCH_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    clearInterval(toucher);
    try {
      fs.rmdirSync(lockDir);
    } catch {
      /* best-effort */
    }
  }
}
