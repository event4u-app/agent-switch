/**
 * One name for a model wherever it is shown: "claude-opus-4-7" → "Opus 4.7",
 * "claude-sonnet-4-6[1m]" → "Sonnet 4.6", "opus" → "Opus". The raw id stays
 * in the tooltip. Ids it does not know pass through unchanged. Pure.
 */
export function modelLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = /^(?:claude-)?(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:-(\d{1,2}))?)?(?![\w.])/i.exec(id.replace(/\[[^\]]*\]$/, ""));
  if (!m) return id;
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return m[2] ? `${name} ${m[2]}${m[3] ? "." + m[3] : ""}` : name;
}
