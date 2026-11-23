/**
 * Mirrors `redactSecrets` in `src/activity.ts`: the GUI's tsconfig only
 * includes `gui/src`, so the helper is duplicated rather than imported across
 * that boundary. `tests/release-notes.test.ts` byte-compares the two functions.
 */

/** Strip anything shaped like a credential: OAuth/API key prefixes, JWTs, and
 *  long opaque runs. Over-redaction is fine here; a leaked token is not. */
export function redactSecrets(s: string): string {
  return s
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(sk|rt|at|sess|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/[A-Za-z0-9_+=-]{40,}/g, "[redacted]");
}
