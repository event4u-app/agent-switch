import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Every command the CLI dispatches is documented in the docs site's CLI
// reference, so a new command cannot ship without its row.

/** Walk up from the compiled test (dist-test/tests/) to the repo root. */
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "src", "index.ts"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("repo root (src/index.ts) not found");
}

/** Flags and aliases that are spelled differently in the reference. */
const NOT_A_COMMAND = new Set(["--help", "-h", "--list", "--version"]);

export function dispatchedCommands(indexSource: string): string[] {
  const start = indexSource.indexOf("switch (cmd) {");
  const end = indexSource.indexOf("default:", start);
  assert.ok(start >= 0 && end > start, "dispatcher `switch (cmd)` not found in src/index.ts");
  const body = indexSource.slice(start, end);
  const names = [...body.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
  return [...new Set(names)].filter((n) => !NOT_A_COMMAND.has(n));
}

/** A command counts as documented when a code span in the page starts with it. */
export function documented(page: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("`(agent-switch )?" + escaped + "([ `|\\\\]|$)", "m").test(page);
}

test("every dispatched command has a row in the docs CLI reference", () => {
  const root = repoRoot();
  const commands = dispatchedCommands(fs.readFileSync(path.join(root, "src", "index.ts"), "utf8"));
  const page = fs.readFileSync(path.join(root, "starlight", "src", "content", "docs", "reference", "cli.mdx"), "utf8");
  assert.ok(commands.length > 40, `expected the full command set, got ${commands.length}`);
  const missing = commands.filter((c) => !documented(page, c));
  assert.deepEqual(missing, [], `undocumented in starlight/src/content/docs/reference/cli.mdx: ${missing.join(", ")}`);
});

test("documented() needs the command at the start of a code span", () => {
  assert.equal(documented("| `use <name>` | x |", "use"), true);
  assert.equal(documented("run `agent-switch rebind --restore`", "rebind"), true);
  assert.equal(documented("| `user <name>` |", "use"), false);
  assert.equal(documented("plain text use", "use"), false);
});
