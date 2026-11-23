/**
 * Quiet hours: a daily local-time window in which no notice is handed to the
 * OS. The in-app list still records every notice; nothing is replayed when the
 * window ends.
 *
 * Mirrored in `gui/src/quiet-hours.ts` (the GUI's tsconfig only includes
 * `gui/src`); `tests/quiet-hours.test.ts` byte-compares the two below this header.
 */

export interface QuietHours {
  /** Minutes after local midnight; `start` is inside the window, `end` is not. */
  start: number;
  end: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(s: string): number | null {
  const m = HHMM.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `HH:MM-HH:MM` → the window; anything else (and an empty window) → null. */
export function parseQuietHours(s: unknown): QuietHours | null {
  if (typeof s !== "string") return null;
  const [a, b, ...rest] = s.split("-");
  if (rest.length || a === undefined || b === undefined) return null;
  const start = minutes(a);
  const end = minutes(b);
  return start === null || end === null || start === end ? null : { start, end };
}

export function formatQuietHours(q: QuietHours): string {
  const hm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return `${hm(q.start)}-${hm(q.end)}`;
}

/** Whether `d` (local time) falls in the window; a window whose end is before
 *  its start runs over midnight. */
export function inQuietHours(q: QuietHours | null, d: Date): boolean {
  if (!q) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return q.start < q.end ? m >= q.start && m < q.end : m >= q.start || m < q.end;
}
