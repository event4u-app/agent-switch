/** Recorded Claude Code / Codex screens (from the reference boards) as ANSI for the fake pty. */
/** A Claude-Code-like screen for the terminal dock; colours are ANSI indices. */
type Seg = [text: string, ansi?: number, bold?: boolean];
const W = 60;
const segLen = (l: Seg[]) => l.reduce((n, [t]) => n + [...t].length, 0);
/** Wrap segment lines in a box drawn with box characters, padded to W. */
function box(lines: Seg[][]): Seg[][] {
  return [
    [["╭" + "─".repeat(W) + "╮", 8]],
    ...lines.map((l): Seg[] => [["│ ", 8], ...l, [" ".repeat(Math.max(0, W - 1 - segLen(l))) + "│", 8]]),
    [["╰" + "─".repeat(W) + "╯", 8]],
  ];
}
const TERMINAL: Seg[][] = [
  ...box([
    [["✻ ", 3], ["Claude Code", undefined, true], ["  Opus 5.5 · work", 8]],
    [["~/code/agent-switch.worktrees/event-store", 7]],
  ]),
  [[""]],
  [["> ", 8], ["dedupe events per producer, then add the projection rebuild test"]],
  [[""]],
  [["● ", 7], ["Read", undefined, true], ["(src/engine/store.ts)", 8]],
  [["  ⎿  Read 214 lines", 8]],
  [["● ", 7], ["Update", undefined, true], ["(src/engine/ingest.ts)", 8]],
  [["  ⎿  Updated src/engine/ingest.ts with ", 8], ["+38", 2], [" ", 8], ["-6", 1]],
  [["      42 ", 8], ["+  const key = `${e.producer}:${e.seq}`;", 2]],
  [["      43 ", 8], ["+  if (seen.has(key)) return { deduped: true };", 2]],
  [["      44 ", 8], ["-  store.append(e);", 1]],
  [["● ", 2], ["Bash", undefined, true], ["(npx vitest run src/engine)", 8]],
  [["  ⎿  ", 8], ["✓", 2], [" 41 passed", 7], ["  ·  ", 8], ["1 todo", 3]],
  [["● ", 6], ["Task", undefined, true], ["(general-purpose · migrate JSON stores)", 8], ["  running in es-migrate", 4]],
  [[""]],
  [["✻ ", 3], ["Wiring the projection rebuild… ", 3], ["(1m 12s · ↓ 3.2k tokens · esc to interrupt)", 8]],
  [[""]],
  ...box([[["> ", 8], ["█", 7]]]),
  [["  ⏵⏵ accept edits on", 5], [" (shift+tab to cycle)", 8]],
];

const TERMINAL_CHECKOUT: Seg[][] = [
  ...box([
    [["✻ ", 3], ["Claude Code", undefined, true], ["  Opus 5.5 · personal", 8]],
    [["~/code/event4u-web", 7]],
  ]),
  [[""]],
  [["> ", 8], ["fix the focus order on the payment step and label the inputs", undefined]],
  [[""]],
  [["● ", 7], ["Update", undefined, true], ["(src/checkout/PaymentStep.vue)", 8]],
  [["  ⎿  Updated src/checkout/PaymentStep.vue with ", 8], ["+24", 2], [" ", 8], ["-9", 1]],
  [["● ", 1], ["Bash", undefined, true], ["(npm run e2e -- checkout)", 8]],
  [["  ⎿  ", 8], ["✗", 1], [" 1 failed", 1], ["  ·  ", 8], ["14 passed", 2]],
  [["     checkout › payment › tab order reaches “Pay”", 8]],
  [[""]],
  [["The e2e failure is the old tab order snapshot; the branch is also 9 commits", undefined]],
  [["behind main with a conflict in PaymentStep.vue. Rebase first?", undefined]],
  [[""]],
  ...box([[["> ", 8], ["█", 7]]]),
];

const TERMINAL_CODEX: Seg[][] = [
  [[">_ ", 8], ["OpenAI Codex", undefined, true], ["  ·  ~/code/agent-switch  ·  work", 8]],
  [[""]],
  [["user", 6, true]],
  [["measure as-hook p95 against the node baseline, 200 runs each", undefined]],
  [[""]],
  [["codex", 5, true]],
  [["Running both relays 200× with hyperfine and comparing p95.", undefined]],
  [[""]],
  [["• ", 2], ["Ran ", 8], ["hyperfine --runs 200 'node hook.js' './as-hook'", undefined]],
  [["  └ node    p95 41.8 ms", 8]],
  [["    as-hook p95  6.2 ms", 2]],
  [["• ", 2], ["Spawned 2 subagents for the Linux and macOS runs", 8]],
  [[""]],
  [["as-hook is 6.7× faster at p95 (6.2 ms vs 41.8 ms). Written to bench/RESULTS.md.", undefined]],
  [[""]],
  [["▌", 7]],
];


const ansi = (lines: Seg[][]) =>
  lines
    .map((l) => l.map(([t, c, b]) => `${b ? "\x1b[1m" : ""}${c != null ? `\x1b[${c < 8 ? 30 + c : 82 + c}m` : ""}${t}\x1b[0m`).join(""))
    .join("\r\n");

export const TERMINALS: Record<string, string> = {
  default: ansi(TERMINAL),
  "claude/personal/s-checkout": ansi(TERMINAL_CHECKOUT),
  "codex/work/s-hook": ansi(TERMINAL_CODEX),
};
