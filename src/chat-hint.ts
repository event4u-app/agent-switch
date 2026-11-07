/**
 * The conversation path without agent-config (road-to-limits-that-last-the-whole-run
 * 2.2): an opt-in Claude Code `UserPromptSubmit` hook that adds one line of
 * context when an open switch request names this session, so the agent can
 * tell the user and record their answer. Claude only — Codex has no prompt hook.
 *
 * Silent when agent-config is wired to this agent-switch (it renders the same
 * request through the link; one voice in the chat), and never blocks a prompt:
 * every failure prints nothing and exits 0.
 *
 * The entry is marker-keyed like the event hooks (`asw_managed`), plus
 * `asw_chat` so it is installed and removed on its own.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { HOOK_MARKER, readSettings } from "./hooks.js";
import { requestKind, type SwitchRequest } from "./link/requests.js";
import { forSession, requestSummary } from "./link/summary.js";

export const CHAT_HOOK_EVENT = "UserPromptSubmit";
export const CHAT_MARKER = "asw_chat";

type Settings = Record<string, any>;

const isChat = (e: any): boolean => !!e && typeof e === "object" && e[CHAT_MARKER] === true;

export function chatHookCommand(bin = "agent-switch"): string {
  return `${bin} __chat-hint`;
}

export function chatHookInstalled(settings: Settings): boolean {
  const arr = settings.hooks?.[CHAT_HOOK_EVENT];
  return Array.isArray(arr) && arr.some(isChat);
}

/** Pure: settings with our prompt hook added (idempotent), the user's entries kept. */
export function withChatHook(settings: Settings, bin = "agent-switch"): Settings {
  const hooks = { ...(settings.hooks ?? {}) };
  const arr: any[] = Array.isArray(hooks[CHAT_HOOK_EVENT]) ? [...hooks[CHAT_HOOK_EVENT]] : [];
  if (!arr.some(isChat)) {
    arr.push({ [HOOK_MARKER]: true, [CHAT_MARKER]: true, hooks: [{ type: "command", command: chatHookCommand(bin), timeout: 5, [HOOK_MARKER]: true }] });
  }
  hooks[CHAT_HOOK_EVENT] = arr;
  return { ...settings, hooks };
}

/** Pure: settings with only our prompt hook removed. */
export function withoutChatHook(settings: Settings): Settings {
  const arr = settings.hooks?.[CHAT_HOOK_EVENT];
  if (!Array.isArray(arr)) return settings;
  const kept = arr.filter((e) => !isChat(e));
  const hooks = { ...settings.hooks };
  if (kept.length) hooks[CHAT_HOOK_EVENT] = kept;
  else delete hooks[CHAT_HOOK_EVENT];
  const next = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

function write(configDir: string, s: Settings): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "settings.json"), JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
}

export function setChatHook(configDir: string, on: boolean, bin = "agent-switch"): { changed: boolean } {
  const before = readSettings(configDir);
  const after = on ? withChatHook(before, bin) : withoutChatHook(before);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) write(configDir, after);
  return { changed };
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function servesAgentSwitch(servers: unknown): boolean {
  if (!servers || typeof servers !== "object") return false;
  return Object.values(servers as Record<string, any>).some(
    (s) => s && typeof s.command === "string" && /agent-switch$/.test(s.command) && Array.isArray(s.args) && s.args[0] === "mcp" && s.args[1] === "serve",
  );
}

/** agent-config wired this agent-switch's MCP server into the session: in the
 *  profile's user scope, its entry for this folder, or the folder's `.mcp.json`. */
export function acLinkWired(configDir: string, cwd: string | null): boolean {
  const user = readJson(path.join(configDir, ".claude.json"));
  if (servesAgentSwitch(user?.mcpServers)) return true;
  if (cwd && servesAgentSwitch(user?.projects?.[cwd]?.mcpServers)) return true;
  return cwd ? servesAgentSwitch(readJson(path.join(cwd, ".mcp.json"))?.mcpServers) : false;
}

export interface HintInput {
  /** `claude/<account>/<sessionId>`. */
  session: string;
  requests: SwitchRequest[];
  linkConnected: boolean;
  paceOn: boolean;
  now: number;
}

/** The one context line for this prompt, or null. Pace requests follow the
 *  pace setting; a limit request is always worth the line. */
export function chatHint(i: HintInput): string | null {
  if (i.linkConnected) return null;
  const r = i.requests
    .filter((x) => x.state === "open")
    .filter(forSession(i.session))
    .filter((x) => i.paceOn || requestKind(x) !== "pace")
    .sort((a, b) => (requestKind(a) === requestKind(b) ? 0 : requestKind(a) === "limit" ? -1 : 1))[0];
  if (!r) return null;
  const to = r.candidates[0];
  const approve = to ? `\`agent-switch switch decide ${r.id} approve --to ${to.target}\`` : null;
  return [
    `[Agent Switch] ${requestSummary(r, i.now)}`,
    `Tell the user and ask whether to move this session. Only after they answer, record it: ${approve ? `${approve}, or ` : ""}\`agent-switch switch decide ${r.id} decline\` (or \`snooze\`). Agent Switch carries out a move; never decide for the user.`,
  ].join(" ");
}
