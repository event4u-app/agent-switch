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

/** Flags that take a value (the next token), as opposed to boolean switches. */
const VALUE_FLAGS = new Set(["provider", "shell", "source"]);

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
 * general parser. Strip only `--provider <val>`, take the name, pass the rest.
 */
export function parseRun(rest: string[]): { providerId: ProviderId; name?: string; args: string[] } {
  const args = [...rest];
  let providerId: ProviderId = "claude";
  const pi = args.indexOf("--provider");
  if (pi >= 0) {
    providerId = resolveProviderValue(args[pi + 1]);
    args.splice(pi, 2);
  }
  const name = args.shift();
  return { providerId, name, args };
}
