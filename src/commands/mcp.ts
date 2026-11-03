/**
 * `agent-switch mcp [--json]` · `mcp open <provider/account>` — the MCP servers
 * and plugins each account has configured, read-only (road-to-agent-switch-v3-client
 * Phase 5). Agent Switch installs nothing: it lists what the tool's own config
 * says and reveals that file. Only names and transports leave this module —
 * never a server's command line, environment or headers, which can carry tokens.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { configDir, die, listProfiles } from "../profiles.js";
import { plan, realEnv } from "../open-in.js";

export interface McpServer {
  name: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  /** "user" for the account, or the project folder a local server belongs to. */
  scope: string;
}

export interface McpAccount {
  key: string;
  provider: "claude" | "codex";
  account: string;
  /** The file that holds the servers, which `mcp open` reveals. */
  configFile: string;
  servers: McpServer[];
  plugins: { name: string; enabled: boolean }[];
}

function transportOf(s: unknown): McpServer["transport"] {
  const o = (s ?? {}) as { type?: unknown; url?: unknown; command?: unknown };
  if (o.type === "http" || o.type === "sse" || o.type === "stdio") return o.type;
  if (typeof o.url === "string") return "http";
  if (typeof o.command === "string") return "stdio";
  return "unknown";
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/** Claude: user servers and per-project servers in `.claude.json`, plugins in `settings.json`. */
export function readClaude(cfg: string, key: string, account: string): McpAccount {
  const file = path.join(cfg, ".claude.json");
  const o = readJson(file) ?? {};
  const servers: McpServer[] = [];
  const add = (m: unknown, scope: string) => {
    if (m && typeof m === "object") for (const [name, s] of Object.entries(m)) servers.push({ name, transport: transportOf(s), scope });
  };
  add(o.mcpServers, "user");
  if (o.projects && typeof o.projects === "object") for (const [dir, p] of Object.entries(o.projects as Record<string, { mcpServers?: unknown }>)) add(p?.mcpServers, dir);
  const enabled = (readJson(path.join(cfg, "settings.json"))?.enabledPlugins ?? {}) as Record<string, unknown>;
  const plugins = Object.entries(enabled).map(([name, on]) => ({ name, enabled: on === true }));
  return { key, provider: "claude", account, configFile: file, servers, plugins };
}

/** Codex: `[mcp_servers.<name>]` tables in `config.toml`. Codex has no plugins. */
export function readCodex(home: string, key: string, account: string): McpAccount {
  const file = path.join(home, "config.toml");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    /* no config yet */
  }
  const servers: McpServer[] = [];
  const re = /^\[mcp_servers\.("?)([^\]"]+)\1\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = text.slice(m.index + m[0].length).split(/^\[/m)[0];
    servers.push({ name: m[2], transport: /^\s*url\s*=/m.test(body) ? "http" : /^\s*command\s*=/m.test(body) ? "stdio" : "unknown", scope: "user" });
  }
  return { key, provider: "codex", account, configFile: file, servers, plugins: [] };
}

export function readAll(): McpAccount[] {
  const out: McpAccount[] = [];
  for (const p of ["claude", "codex"] as const) {
    for (const name of listProfiles(p)) {
      const cfg = configDir(p, name);
      out.push(p === "claude" ? readClaude(cfg, `${p}/${name}`, name) : readCodex(cfg, `${p}/${name}`, name));
    }
  }
  return out;
}

export function cmdMcp(sub: string | undefined, arg: string | undefined, flags: Record<string, string | boolean>): void {
  const all = readAll();
  if (sub === "open") {
    const a = all.find((x) => x.key === arg);
    if (!a) die("usage: agent-switch mcp open <provider/account>");
    const file = fs.existsSync(a.configFile) ? a.configFile : undefined;
    const p = plan("finder", path.dirname(a.configFile), realEnv, file);
    if (!p) die("no file manager to reveal the config in");
    spawnSync(p.program, p.args, { stdio: "ignore" });
    if (!flags.json) console.log(`Revealed ${a.configFile}.`);
    return;
  }
  if (sub) die("usage: agent-switch mcp [--json] · mcp open <provider/account>");
  if (flags.json) return void console.log(JSON.stringify(all));
  for (const a of all) {
    console.log(`${a.key}  ${a.configFile}`);
    for (const s of a.servers) console.log(`  mcp ${s.name} (${s.transport})${s.scope === "user" ? "" : ` in ${s.scope}`}`);
    for (const p of a.plugins) console.log(`  plugin ${p.name}${p.enabled ? "" : " (off)"}`);
    if (!a.servers.length && !a.plugins.length) console.log("  nothing configured");
  }
}
