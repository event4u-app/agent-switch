import type { engines as en } from "../en/engines.js";

/** German copy — `engines` namespace. Informal "Du"; every English key, no extras. */
export const engines: { readonly [K in keyof typeof en]: string } = {
};
