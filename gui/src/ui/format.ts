/**
 * Copy helpers of the redesign (bundle L19–73). Pure: `now` is always passed in
 * so the screens tick from one clock and the tests stay deterministic.
 */

/** "2h 10m" / "4d 22h" until an ISO instant; "now" once passed; null when
 *  there is no (parseable) instant. */
export function countdown(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ${min % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "just now" / "4 min ago" / "3 h ago" / "2 d ago". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Elapsed time since `from`: "24m" / "1h 24m". */
export function duration(from: number, now: number): string {
  const min = Math.max(0, Math.floor((now - from) / 60_000));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Compact data age for meters: "now" / "2m" / "3h" / "2d"; "never" when the
 *  value was never checked. */
export function shortAge(at: number | null | undefined, now: number): string {
  if (at == null) return "never";
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Home-relative path: `/Users/x/dev/a` → `~/dev/a` (macOS + Linux homes). */
export function shortPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

/** Sign-in expiry: "today" / "tomorrow" / "in 19 days" / "expired" / "unknown". */
export function expiry(at: number | null | undefined, now: number): string {
  if (at == null) return "unknown";
  const days = Math.floor((at - now) / 86_400_000);
  return at <= now ? "expired" : days < 1 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}
