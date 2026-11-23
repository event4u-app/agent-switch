/**
 * Strategy `ask`: a start with no folder rule asks which account to use — but
 * only a person at a terminal can answer. A start without a terminal on stdin
 * and stderr (a script, a pipe, the desktop app's own calls) is never asked;
 * it takes the resolver's fallback pick instead. stdout is not checked: the
 * shell wrapper captures it to read the config path, so the question and the
 * choices go to stderr.
 */

export function canAsk(tty: { stdin: boolean; stderr: boolean }): boolean {
  return tty.stdin && tty.stderr;
}

/** The question, one numbered line per account; the suggestion is what Enter takes. */
export function askLines(providerId: string, choices: readonly string[], suggestion: string | null): string[] {
  return [
    `agent-switch: which ${providerId} account should this start use?`,
    ...choices.map((c, n) => `  ${n + 1}) ${c}${c === suggestion ? "  (Enter)" : ""}`),
  ];
}

/** The account an answer names: empty → the suggestion, a 1-based number or a
 *  name → that choice; anything else → null (nothing is started). */
export function parseChoice(answer: string, choices: readonly string[], suggestion: string | null): string | null {
  const a = answer.trim();
  if (a === "") return suggestion;
  if (/^\d+$/.test(a)) return choices[Number(a) - 1] ?? null;
  return choices.includes(a) ? a : null;
}
