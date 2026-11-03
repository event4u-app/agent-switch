/**
 * `agent-switch agents [--json]` — every agent with its class, binary, version
 * and local marker (v3.2 M15/M16).
 * `agents suggest [--json]` — ACP agents from the ACP registry, with the install
 *   command the user runs themselves (AS installs nothing).
 * `agents add <id> [--name N] [--binary B] [-- <args>…]` · `agents remove <id>`
 * `agents on|off <id>` · `agents local <id> <runner:model>|none`
 * `agents install <id>` — run a suggestion's install command in the foreground,
 *   output on this terminal (the app runs it in its terminal sheet), then add it.
 */

import { spawnSync } from "node:child_process";

import { agentSearchPath, probeVersion } from "../agent-path.js";
import {
  addAgent,
  CLASS_LABEL,
  listAgents,
  localMarker,
  parseLocal,
  removeAgent,
  setEnabled,
  setLocal,
  SUGGESTIONS,
  type Agent,
  type LocalModel,
} from "../agents.js";
import { die } from "../profiles.js";

export interface AgentRow extends Agent {
  version: string | null;
  installed: boolean;
  localMarker: LocalModel | null;
}

/** Agents with what is known about them on this machine. */
export function agentRows(probe: (bin: string) => string | null = (b) => probeVersion(b, agentSearchPath())): AgentRow[] {
  return listAgents().map((a) => {
    const version = probe(a.binary);
    return { ...a, version, installed: version !== null, localMarker: localMarker(a) };
  });
}

const localText = (l: LocalModel | null) => (l ? `local · ${l.runner} · ${l.model}` : "provider default");

/** `passThrough`: what followed a bare `--` — the agent's own argv for `add`. */
export function cmdAgents(positional: string[], flags: Record<string, string | boolean>, passThrough?: string[]): void {
  const [sub, id, value] = positional;
  const json = flags.json === true;
  try {
    switch (sub) {
      case undefined:
      case "list": {
        const rows = agentRows();
        if (json) {
          const have = new Set(rows.map((r) => r.id));
          return void console.log(JSON.stringify({ agents: rows, suggestions: SUGGESTIONS.filter((s) => !have.has(s.id)) }));
        }
        for (const r of rows)
          console.log(`${r.enabled ? "●" : "○"} ${r.id.padEnd(12)} ${CLASS_LABEL[r.cls].padEnd(14)} ${[r.binary, ...r.args].join(" ").padEnd(18)} ${(r.version ?? "not found").padEnd(12)} ${localText(r.localMarker)}`);
        return;
      }
      case "suggest": {
        const have = new Set(listAgents().map((a) => a.id));
        const rows = SUGGESTIONS.filter((s) => !have.has(s.id));
        if (json) return void console.log(JSON.stringify({ suggestions: rows, source: "ACP registry, read 2026-11-03" }));
        for (const s of rows) console.log(`${s.id.padEnd(12)} ${s.name.padEnd(12)} ${s.licence.padEnd(11)} install: ${s.install.join(" ")}`);
        return;
      }
      case "add": {
        if (!id) die("usage: agent-switch agents add <id> [--name N] [--binary B] [-- <args>…]");
        const a = addAgent({ id, name: typeof flags.name === "string" ? flags.name : undefined, binary: typeof flags.binary === "string" ? flags.binary : undefined, args: passThrough });
        return void (json ? console.log(JSON.stringify({ agent: a })) : console.log(`added ${a.name} (${[a.binary, ...a.args].join(" ")}) as an ACP agent`));
      }
      case "install": {
        const sug = SUGGESTIONS.find((x) => x.id === id);
        if (!sug) die(`no suggestion ${id ?? ""} (agent-switch agents suggest)`);
        console.log(`$ ${sug.install.join(" ")}`);
        const r = spawnSync(sug.install[0], sug.install.slice(1), { stdio: "inherit", env: { ...process.env, PATH: agentSearchPath() } });
        if (r.status !== 0) die(`install failed (${r.error?.message ?? `exit ${r.status}`})`);
        if (!listAgents().some((a) => a.id === sug.id)) addAgent({ id: sug.id });
        return void console.log(`${sug.name} installed and added`);
      }
      case "remove":
        if (!id) die("usage: agent-switch agents remove <id>");
        removeAgent(id);
        return void console.log(`removed ${id}`);
      case "on":
      case "off":
        if (!id) die(`usage: agent-switch agents ${sub} <id>`);
        setEnabled(id, sub === "on");
        return void console.log(`${id} ${sub}`);
      case "local":
        if (!id || !value) die("usage: agent-switch agents local <id> <ollama|lmstudio|local>:<model> | none");
        setLocal(id, value === "none" ? null : parseLocal(value));
        return void console.log(value === "none" ? `${id}: no local model` : `${id}: ${localText(parseLocal(value))}`);
      default:
        die(`unknown: agents ${sub} (list, suggest, install, add, remove, on, off, local)`);
    }
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
}
