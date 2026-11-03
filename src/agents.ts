/**
 * The agent registry (v3.2 M15): which coding agents Agent Switch drives, and
 * how deeply.
 *
 * Three classes, shown honestly (spec §10.5):
 *  - `deep` — Claude Code and Codex: accounts, limits, switching, the bridge.
 *  - `acp` — any agent speaking the Agent Client Protocol over stdio: the chat
 *    view through the same AS event model; limits only if the agent reports them.
 *  - `terminal` — a dock tab and nothing structured (Antigravity, see S6).
 *
 * Built-in rows cannot be removed, only switched off. Added rows are argv only —
 * a binary and an argument list, never a shell string. AS installs nothing: a
 * suggestion carries the command the user runs visibly in the terminal sheet.
 *
 * File: `<ROOT>/agents.json`, additive (absent = only the built-ins, all on).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ROOT, ensureRoot } from "./profiles.js";

export type AgentClass = "deep" | "acp" | "terminal";
export type LocalRunner = "ollama" | "lmstudio" | "local";

export interface LocalModel {
  runner: LocalRunner;
  model: string;
}

export interface Agent {
  id: string;
  name: string;
  binary: string;
  args: string[];
  cls: AgentClass;
  enabled: boolean;
  builtin: boolean;
  /** Set when the agent is configured to run a model on this machine (M16). */
  local: LocalModel | null;
}

export const AGENTS_FILE = path.join(ROOT, "agents.json");
export const MAX_AGENTS = 24;
const MAX_ARGS = 16;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BARE_BINARY = /^[A-Za-z0-9._+-]{1,64}$/;

const BUILTINS: readonly Omit<Agent, "enabled" | "local">[] = [
  { id: "claude", name: "Claude Code", binary: "claude", args: [], cls: "deep", builtin: true },
  { id: "codex", name: "Codex", binary: "codex", args: [], cls: "deep", builtin: true },
  { id: "antigravity", name: "Antigravity", binary: "agy", args: [], cls: "terminal", builtin: true },
];

export interface Suggestion {
  id: string;
  name: string;
  binary: string;
  args: string[];
  licence: string;
  /** What the user runs, visibly, to install it (argv, from this fixed table only). */
  install: string[];
  /** Can run a local model (through its own config). */
  localCapable: boolean;
}

/**
 * From the ACP registry (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`,
 * read 2026-11-03), the agents the roadmap names. Google's `antigravity-acp` is
 * left out on purpose: its terms forbid third-party clients on the Antigravity
 * login (`agents/evidence/v32-phase0-spikes-2026-11.md` § S6).
 */
export const SUGGESTIONS: readonly Suggestion[] = [
  { id: "gemini", name: "Gemini CLI", binary: "gemini", args: ["--acp"], licence: "Apache-2.0", install: ["npm", "install", "-g", "@google/gemini-cli"], localCapable: false },
  { id: "opencode", name: "OpenCode", binary: "opencode", args: ["acp"], licence: "MIT", install: ["brew", "install", "opencode"], localCapable: true },
  { id: "goose", name: "Goose", binary: "goose", args: ["acp"], licence: "Apache-2.0", install: ["brew", "install", "block-goose-cli"], localCapable: true },
  { id: "qwen-code", name: "Qwen Code", binary: "qwen", args: ["--acp"], licence: "Apache-2.0", install: ["npm", "install", "-g", "@qwen-code/qwen-code"], localCapable: true },
];

interface Stored {
  /** Built-in id → switched off. */
  off: string[];
  added: { id: string; name: string; binary: string; args: string[]; enabled: boolean; local: LocalModel | null }[];
  /** Built-in id → a local model the user named. */
  local: Record<string, LocalModel>;
}

const isLocal = (v: unknown): v is LocalModel => {
  const r = (v ?? {}) as Record<string, unknown>;
  return (r.runner === "ollama" || r.runner === "lmstudio" || r.runner === "local") && typeof r.model === "string" && r.model.length > 0 && r.model.length <= 120;
};

function readStored(file: string): Stored {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    /* absent or unreadable → built-ins only */
  }
  const off = Array.isArray(raw.off) ? raw.off.filter((x): x is string => typeof x === "string") : [];
  const added: Stored["added"] = [];
  for (const a of Array.isArray(raw.added) ? raw.added : []) {
    const r = (a ?? {}) as Record<string, unknown>;
    const row = { id: r.id, name: r.name, binary: r.binary, args: r.args };
    if (validateAgent(row as never) !== null) continue;
    added.push({ ...(row as { id: string; name: string; binary: string; args: string[] }), enabled: r.enabled !== false, local: isLocal(r.local) ? r.local : null });
  }
  const local: Record<string, LocalModel> = {};
  for (const [k, v] of Object.entries((raw.local ?? {}) as Record<string, unknown>)) if (isLocal(v)) local[k] = v;
  return { off, added, local };
}

function writeStored(s: Stored, file: string): void {
  if (file === AGENTS_FILE) ensureRoot();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Why a row cannot be stored, or null. Argv only: a bare binary name or an
 *  absolute path, arguments as a list, no control characters. Pure. */
export function validateAgent(a: { id: unknown; name: unknown; binary: unknown; args: unknown }): string | null {
  if (typeof a.id !== "string" || !ID.test(a.id)) return "id: lowercase letters, digits and dashes, at most 32";
  if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 60 || /[\u0000-\u001f]/.test(a.name)) return "name: 1–60 printable characters";
  if (typeof a.binary !== "string" || !(BARE_BINARY.test(a.binary) || (path.isAbsolute(a.binary) && !/[\u0000-\u001f]/.test(a.binary) && a.binary.length <= 512)))
    return "binary: a command name or an absolute path";
  if (!Array.isArray(a.args) || a.args.length > MAX_ARGS || a.args.some((x) => typeof x !== "string" || x.length > 200 || /[\u0000-\u001f]/.test(x))) return `args: at most ${MAX_ARGS} plain strings`;
  return null;
}

/** Every agent, built-ins first. */
export function listAgents(file: string = AGENTS_FILE): Agent[] {
  const s = readStored(file);
  const built = BUILTINS.map((b) => ({ ...b, args: [...b.args], enabled: !s.off.includes(b.id), local: s.local[b.id] ?? null }));
  const added = s.added.map((a) => ({ ...a, cls: "acp" as const, builtin: false }));
  return [...built, ...added];
}

export function findAgent(id: string, file: string = AGENTS_FILE): Agent | null {
  return listAgents(file).find((a) => a.id === id) ?? null;
}

/** Add an ACP agent. A suggestion id fills in name, binary and args. */
export function addAgent(row: { id: string; name?: string; binary?: string; args?: string[] }, file: string = AGENTS_FILE): Agent {
  const sug = SUGGESTIONS.find((x) => x.id === row.id);
  const full = { id: row.id, name: row.name ?? sug?.name ?? row.id, binary: row.binary ?? sug?.binary ?? row.id, args: row.args ?? sug?.args ?? [] };
  const bad = validateAgent(full);
  if (bad) throw new Error(bad);
  const s = readStored(file);
  if (BUILTINS.some((b) => b.id === full.id) || s.added.some((a) => a.id === full.id)) throw new Error(`agent ${full.id} already exists`);
  if (BUILTINS.length + s.added.length >= MAX_AGENTS) throw new Error(`at most ${MAX_AGENTS} agents`);
  s.added.push({ ...full, enabled: true, local: null });
  writeStored(s, file);
  return findAgent(full.id, file)!;
}

export function removeAgent(id: string, file: string = AGENTS_FILE): void {
  if (BUILTINS.some((b) => b.id === id)) throw new Error(`${id} is built in — switch it off instead`);
  const s = readStored(file);
  if (!s.added.some((a) => a.id === id)) throw new Error(`no agent ${id}`);
  s.added = s.added.filter((a) => a.id !== id);
  writeStored(s, file);
}

export function setEnabled(id: string, on: boolean, file: string = AGENTS_FILE): void {
  const s = readStored(file);
  if (BUILTINS.some((b) => b.id === id)) s.off = on ? s.off.filter((x) => x !== id) : [...new Set([...s.off, id])];
  else {
    const a = s.added.find((x) => x.id === id);
    if (!a) throw new Error(`no agent ${id}`);
    a.enabled = on;
  }
  writeStored(s, file);
}

/** Name (or clear) the local model an agent is configured with. */
export function setLocal(id: string, local: LocalModel | null, file: string = AGENTS_FILE): void {
  if (local && !isLocal(local)) throw new Error("local: runner ollama|lmstudio|local and a model name");
  const s = readStored(file);
  if (BUILTINS.some((b) => b.id === id)) {
    if (id === "antigravity") throw new Error("Antigravity runs no local model");
    if (local) s.local[id] = local;
    else delete s.local[id];
  } else {
    const a = s.added.find((x) => x.id === id);
    if (!a) throw new Error(`no agent ${id}`);
    a.local = local;
  }
  writeStored(s, file);
}

/** `ollama:qwen3-coder:30b` → {runner, model}. The first colon splits. Pure. */
export function parseLocal(spec: string): LocalModel {
  const i = spec.indexOf(":");
  const runner = i < 0 ? "" : spec.slice(0, i);
  const model = i < 0 ? "" : spec.slice(i + 1);
  const l = { runner, model } as LocalModel;
  if (!isLocal(l)) throw new Error(`"${spec}": use <ollama|lmstudio|local>:<model>`);
  return l;
}

const LOCAL_HOSTS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;

/** The runner a local base URL points at, from its port. Pure. */
export function runnerOf(baseURL: string): LocalRunner {
  if (/:11434(\/|$)/.test(baseURL)) return "ollama";
  if (/:1234(\/|$)/.test(baseURL)) return "lmstudio";
  return "local";
}

/**
 * The local model an OpenCode config selects, or null: `"model": "<provider>/<id>"`
 * where the provider's `options.baseURL` is on this machine. Pure over the config.
 */
export function localFromOpenCode(config: unknown): LocalModel | null {
  const c = (config ?? {}) as Record<string, unknown>;
  const model = typeof c.model === "string" ? c.model : "";
  const i = model.indexOf("/");
  if (i <= 0) return null;
  const prov = ((c.provider ?? {}) as Record<string, Record<string, unknown>>)[model.slice(0, i)];
  const base = (prov?.options as Record<string, unknown> | undefined)?.baseURL;
  if (typeof base !== "string" || !LOCAL_HOSTS.test(base)) return null;
  return { runner: runnerOf(base), model: model.slice(i + 1) };
}

/** The local model Codex runs with given its argv (`--oss [--local-provider p] [-m model]`). Pure. */
export function localFromCodexArgs(args: readonly string[]): LocalModel | null {
  if (!args.includes("--oss")) return null;
  const val = (flag: string, short?: string) => {
    const i = args.findIndex((a) => a === flag || (short && a === short));
    return i >= 0 ? args[i + 1] ?? null : null;
  };
  const p = val("--local-provider");
  return { runner: p === "lmstudio" ? "lmstudio" : p === "ollama" ? "ollama" : "local", model: val("--model", "-m") ?? "default" };
}

/** OpenCode's global config, if it can be read (OPENCODE_CONFIG wins). */
export function readOpenCodeConfig(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): unknown {
  for (const f of [env.OPENCODE_CONFIG, path.join(home, ".config", "opencode", "opencode.json"), path.join(home, ".config", "opencode", "opencode.jsonc")]) {
    if (!f) continue;
    try {
      return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""));
    } catch {
      /* next */
    }
  }
  return null;
}

/** The local marker for an agent: what the user named, else what its own config says (M16). */
export function localMarker(a: Agent, openCodeConfig: () => unknown = readOpenCodeConfig): LocalModel | null {
  if (a.local) return a.local;
  if (a.id === "codex") return localFromCodexArgs(a.args);
  if (a.binary === "opencode" || path.basename(a.binary) === "opencode") return localFromOpenCode(openCodeConfig());
  return null;
}

export const CLASS_LABEL: Record<AgentClass, string> = { deep: "deep", acp: "ACP", terminal: "terminal only" };
