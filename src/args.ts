/**
 * CLI argument parsing — extracted so it is unit-testable without running the
 * `index.ts` entry point.
 *
 * The bug this fixes (round-2 review F1): the old
 * `positional = rest.filter(a => !a.startsWith("--"))` stripped a flag but NOT
 * its value, so `--provider codex` left `"codex"` in the positionals — and
 * `remove --provider codex opfer` then targeted `codex` instead of `opfer`
 * (destructive, silent). Value-flags consume their value here.
 */

import { ProviderId, PROVIDER_IDS, isProviderId } from "./providers.js";

/** Flags that take a value (the next token), as opposed to boolean switches.
 *  Every flag read as a string in index.ts MUST be listed here, or its value
 *  leaks into the positionals and the flag reads back as boolean `true`
 *  (the bug behind `notify`/`providers --surface` silently losing their args). */
const VALUE_FLAGS = new Set([
  "provider",
  "browser",
  "shell",
  "source",
  "threshold",
  "to",
  "from",
  "recent",
  "kind",
  "title",
  "message",
  "surface",
  "tag",
  "ack",
  "brief",
  "profile",
  "by",
  "reason",
  "limit",
  "after-pid",
]);

export interface ParsedArgs {
  cmd?: string;
  /** Resolved provider (default claude). Throws on an explicit invalid value. */
  providerId: ProviderId;
  /** Whether `--provider` was given (commands that list "all vs one" use this). */
  providerExplicit: boolean;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Resolve a `--provider` value to a ProviderId; throws (not exits) on invalid
 *  so callers can test it. Undefined → claude. */
export function resolveProviderValue(v: string | boolean | undefined): ProviderId {
  if (v === undefined) return "claude";
  if (typeof v !== "string" || !isProviderId(v)) {
    throw new Error(`unknown provider "${String(v)}" (choose: ${PROVIDER_IDS.join(", ")})`);
  }
  return v;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (VALUE_FLAGS.has(key)) {
        flags[key] = rest[i + 1]; // consume the value...
        i++; // ...so it never leaks into positionals
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return {
    cmd,
    providerId: resolveProviderValue(flags.provider),
    providerExplicit: "provider" in flags,
    positional,
    flags,
  };
}

/**
 * `run` is special: everything after the profile name is passed THROUGH to the
 * provider binary (including its own `--flags`), so it can't go through the
 * general parser. Strip only `--provider <val>` and `--cwd <dir>` (before any
 * bare `--`), take the name, pass the rest.
 */
export function parseRun(rest: string[]): { providerId: ProviderId; name?: string; args: string[]; cwd?: string } {
  const args = [...rest];
  // Everything after a bare `--` belongs to the provider binary, so our own
  // flags are only looked for before it.
  const own = (flag: string) => {
    const end = args.indexOf("--");
    const i = args.indexOf(flag);
    return i >= 0 && (end < 0 || i < end) ? i : -1;
  };
  let providerId: ProviderId = "claude";
  const pi = own("--provider");
  if (pi >= 0) {
    providerId = resolveProviderValue(args[pi + 1]);
    args.splice(pi, 2);
  }
  let cwd: string | undefined;
  const ci = own("--cwd");
  if (ci >= 0) {
    cwd = args[ci + 1];
    if (!cwd) throw new Error("--cwd needs a folder");
    args.splice(ci, 2);
  }
  const name = args.shift();
  return cwd === undefined ? { providerId, name, args } : { providerId, name, args, cwd };
}
