import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// State root for this file, set before the modules that read it at import.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-mcp-home-")));
process.env.AGENT_SWITCH_HOME = HOME;
const { cmdMcp, readAll, readClaude, readCodex } = await import("../src/commands/mcp.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-mcp-"));

test("Claude: user and project servers with their transport, plugins on and off — never a command, env or header", () => {
  const cfg = tmp();
  fs.writeFileSync(
    path.join(cfg, ".claude.json"),
    JSON.stringify({
      mcpServers: { github: { type: "http", url: "https://x", headers: { Authorization: "Bearer SECRET-1" } }, fs: { command: "npx", args: ["--token", "SECRET-2"], env: { K: "SECRET-3" } } },
      projects: { "/repo/a": { mcpServers: { db: { type: "sse", url: "https://y" } } }, "/repo/b": {} },
    }),
  );
  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "review@official": true, "old@x": false } }));
  const a = readClaude(cfg, "claude/work", "work");
  assert.deepEqual(a.servers, [
    { name: "github", transport: "http", scope: "user" },
    { name: "fs", transport: "stdio", scope: "user" },
    { name: "db", transport: "sse", scope: "/repo/a" },
  ]);
  assert.deepEqual(a.plugins, [{ name: "review@official", enabled: true }, { name: "old@x", enabled: false }]);
  assert.equal(a.configFile, path.join(cfg, ".claude.json"));
  assert.doesNotMatch(JSON.stringify(a), /SECRET/);
  assert.deepEqual(readClaude(tmp(), "claude/new", "new").servers, [], "no config: nothing, no error");
});

test("Codex: [mcp_servers.<name>] tables, quoted or not, by transport", () => {
  const home = tmp();
  fs.writeFileSync(path.join(home, "config.toml"), `model = "o3"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["SECRET"]\n\n[mcp_servers."web-search"]\nurl = "https://z"\n\n[profiles.x]\nmodel = "y"\n`);
  const a = readCodex(home, "codex/me", "me");
  assert.deepEqual(a.servers, [{ name: "docs", transport: "stdio", scope: "user" }, { name: "web-search", transport: "http", scope: "user" }]);
  assert.deepEqual(a.plugins, []);
  assert.doesNotMatch(JSON.stringify(a), /SECRET/);
});

test("readAll and the listing: every Claude and Codex account, with what it has or that it has nothing", () => {
  const claude = path.join(HOME, "claude", "work", "config");
  const codex = path.join(HOME, "codex", "me", "config");
  fs.mkdirSync(claude, { recursive: true });
  fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(path.join(claude, ".claude.json"), JSON.stringify({ projects: { "/r": { mcpServers: { db: { url: "https://x" } } } } }));
  fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "p@m": false } }));
  assert.deepEqual(readAll().map((a) => [a.key, a.servers.length, a.plugins.length]), [["claude/work", 1, 1], ["codex/me", 0, 0]]);
  const lines: string[] = [];
  const log = console.log;
  console.log = (m: string) => void lines.push(m);
  try {
    cmdMcp(undefined, undefined, {});
    cmdMcp(undefined, undefined, { json: true });
  } finally {
    console.log = log;
  }
  assert.deepEqual(lines.slice(0, 5), [`claude/work  ${path.join(claude, ".claude.json")}`, "  mcp db (http) in /r", "  plugin p@m (off)", `codex/me  ${path.join(codex, "config.toml")}`, "  nothing configured"]);
  assert.deepEqual(JSON.parse(lines[5]).map((a: { key: string }) => a.key), ["claude/work", "codex/me"]);
});
