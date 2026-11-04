/** How a start with no folder rule picks its account (see dir-resolve.ts).
 *  Kept import-free: profiles.ts and dir-resolve.ts both need it, and
 *  dir-resolve → pools → profiles would otherwise be a module cycle. */
export type StartStrategy = "balance" | "fill";
export const START_STRATEGIES: readonly StartStrategy[] = ["balance", "fill"];
