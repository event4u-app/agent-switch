// Gives the dev build the stable local signature (src/mac-signing.ts), from the repo's built dist/.
// `task gui:dev` builds dist/ first; without it the dev build just runs unsigned.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const bin = process.argv[2];
const mod = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist", "mac-signing.js");
if (!bin || !existsSync(mod)) {
  console.error("agent-switch: dev build left unsigned (run `npm run build` in the repo root first) — macOS may ask again for folder access.");
  process.exit(0);
}
const { defaultSignEnv, stabilizeSignature } = await import(pathToFileURL(mod).href);
const processList = () => spawnSync("ps", ["ax", "-o", "command="], { encoding: "utf8" }).stdout ?? "";
stabilizeSignature(bin, defaultSignEnv(processList), "com.event4u.agent-switch.dev");
