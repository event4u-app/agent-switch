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

/** A short Claude Code screen for a session that has no recording of its own. */
function claudeScreen(model: string, acct: string, cwd: string, prompt: string, body: Seg[][]): Seg[][] {
  return [
    ...box([
      [["✻ ", 3], ["Claude Code", undefined, true], [`  ${model} · ${acct}`, 8]],
      [[cwd, 7]],
    ]),
    [[""]],
    [["> ", 8], [prompt]],
    [[""]],
    ...body,
    [[""]],
    ...box([[["> ", 8], ["█", 7]]]),
  ];
}

const TERMINAL_THEMES = claudeScreen("Opus 5.5", "personal", "~/code/agent-switch.worktrees/themes", "make Darcula the default theme and run the v3 tests", [
  [["● ", 7], ["Update", undefined, true], ["(gui/src/v3/themes/registry.ts)", 8]],
  [["  ⎿  Updated gui/src/v3/themes/registry.ts with ", 8], ["+3", 2], [" ", 8], ["-3", 1]],
  [["● ", 3], ["Bash", undefined, true], ["(npx vitest run src/v3)", 8]],
  [["  ⎿  ", 8], ["Waiting for your permission", 3]],
]);

const TERMINAL_COUNCIL = claudeScreen("Opus 5.5", "work", "~/code/agent-config", "draft the 1.9 release plan and put it to the council", [
  [["● ", 7], ["Read", undefined, true], ["(CHANGELOG.md)", 8]],
  [["  ⎿  Read 412 lines", 8]],
  [["● ", 6], ["Task", undefined, true], ["(council · architect, skeptic, release manager)", 8], ["  3 seats", 4]],
  [[""]],
  [["✻ ", 3], ["Waiting for the skeptic and the release manager… ", 3], ["(4m 02s · esc to interrupt)", 8]],
]);

const TERMINAL_WEDGE = claudeScreen("Sonnet 5.5", "side", "~/code/agent-switch.worktrees/wedge", "the daemon wedges after a restart; find out why and fix it", [
  [["● ", 7], ["Grep", undefined, true], ["(\"lease\" in src/daemon)", 8]],
  [["  ⎿  Found 7 matches", 8]],
  [["● ", 7], ["Update", undefined, true], ["(src/daemon/lease.ts)", 8]],
  [["  ⎿  Updated src/daemon/lease.ts with ", 8], ["+12", 2], [" ", 8], ["-4", 1]],
  [[""]],
  [["✻ ", 3], ["Re-running the restart test… ", 3], ["(38s · esc to interrupt)", 8]],
]);

const TERMINAL_NOTES = claudeScreen("Sonnet 5.5", "personal", "~/code/agent-switch", "write the 2.11 release notes from the merged PRs", [
  [["● ", 7], ["Write", undefined, true], ["(docs/release-2.11.md)", 8]],
  [["  ⎿  Wrote 86 lines to docs/release-2.11.md", 8]],
  [[""]],
  [["The release notes are in docs/release-2.11.md and #140 is green.", undefined]],
]);

export const TERMINALS: Record<string, string> = {
  default: ansi(TERMINAL),
  "claude/personal/s-themes": ansi(TERMINAL_THEMES),
  "claude/work/s-council": ansi(TERMINAL_COUNCIL),
  "claude/side/s-wedge": ansi(TERMINAL_WEDGE),
  "claude/personal/s-notes": ansi(TERMINAL_NOTES),
  "claude/personal/s-checkout": ansi(TERMINAL_CHECKOUT),
  "codex/work/s-hook": ansi(TERMINAL_CODEX),
};
