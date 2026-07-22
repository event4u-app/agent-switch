#!/usr/bin/env node
// Prepack guard: refuse to pack/publish a tarball whose bin entry is not a
// runnable executable. `tsc` emits dist/index.js as 0644 with no execute bit;
// the build chmods it, but a registry install then relies on that bit being in
// the tarball (npm does not reliably re-chmod bin targets on install — a 0644
// bin lands on the user's machine and `agent-switch` fails with "permission
// denied"). This runs on `npm pack` and `npm publish` (after `prepare`), so a
// missing shebang or execute bit fails fast instead of shipping a broken CLI.

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const bin = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin ?? {})[0];
if (!bin) {
  console.error("prepack: package.json has no `bin` entry to check.");
  process.exit(1);
}
const binPath = path.join(root, bin);

let st;
try {
  st = statSync(binPath);
} catch {
  console.error(`prepack: bin entry ${bin} is missing — run \`npm run build\` first.`);
  process.exit(1);
}

// The shebang lets the OS run it directly; without it npm's shim breaks too.
const firstLine = readFileSync(binPath, "utf8").split("\n", 1)[0];
if (!firstLine.startsWith("#!")) {
  console.error(`prepack: ${bin} has no shebang (first line: ${JSON.stringify(firstLine)}).`);
  process.exit(1);
}

// Any execute bit (owner/group/other) — 0o111. The build step must chmod +x.
if ((st.mode & 0o111) === 0) {
  console.error(`prepack: ${bin} is not executable (mode ${(st.mode & 0o777).toString(8)}). The build step must \`chmod +x\` the bin entry.`);
  process.exit(1);
}

console.log(`prepack: ${bin} is a runnable executable (mode ${(st.mode & 0o777).toString(8)}). ✅`);
