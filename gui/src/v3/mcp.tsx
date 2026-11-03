/** Accounts › MCP & plugins (road-to-agent-switch-v3-client Phase 5): what each
 *  account has configured, read from the tool's own config. Agent Switch
 *  installs nothing here; "Reveal config" shows the file to edit. */

import { FolderOpen, Plug, Puzzle } from "lucide-react";

import { Button } from "../ui/Button.js";
import type { McpAccountJson } from "../ipc.js";

const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

export function McpView({ accounts, loading, onReveal }: { accounts: McpAccountJson[]; loading: boolean; onReveal: (key: string) => void }) {
  if (loading && !accounts.length) return <p className="py-6 text-[13px] text-ac-muted">Reading each account's configuration…</p>;
  if (!accounts.length) return <p className="py-6 text-[13px] text-ac-muted">No Claude or Codex account yet.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-ac-muted">Read from each tool's own configuration. To add or change a server or plugin, edit that file or use the tool's own command (claude mcp add, codex mcp add) — Agent Switch installs nothing.</p>
      {accounts.map((a) => (
        <section key={a.key} aria-label={a.key} className="overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
          <div className="flex items-center gap-2 border-b border-ac-line px-4 py-2">
            <span className="text-[13px] text-ac-text">{a.account}</span>
            <span className="text-xs text-ac-muted">{a.provider === "codex" ? "Codex" : "Claude"}</span>
            <span className="min-w-0 truncate font-ac-mono text-[11px] text-ac-faint">{home(a.configFile)}</span>
            <Button size="sm" variant="ghost" className="ml-auto shrink-0" onClick={() => onReveal(a.key)}>
              <FolderOpen /> Reveal config
            </Button>
          </div>
          {a.servers.length === 0 && a.plugins.length === 0 ? (
            <p className="px-4 py-2.5 text-xs text-ac-muted">No MCP servers or plugins configured.</p>
          ) : (
            <ul className="divide-y divide-ac-line">
              {a.servers.map((s) => (
                <li key={`m-${s.scope}-${s.name}`} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                  <Plug className="size-3.5 text-ac-faint" />
                  <span className="font-ac-mono text-ac-text">{s.name}</span>
                  <span className="text-ac-muted">{s.transport === "unknown" ? "MCP" : `MCP · ${s.transport}`}</span>
                  <span className="ml-auto min-w-0 truncate font-ac-mono text-[11px] text-ac-faint">{s.scope === "user" ? "every project" : home(s.scope)}</span>
                </li>
              ))}
              {a.plugins.map((p) => (
                <li key={`p-${p.name}`} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                  <Puzzle className="size-3.5 text-ac-faint" />
                  <span className="font-ac-mono text-ac-text">{p.name}</span>
                  <span className={p.enabled ? "text-ac-muted" : "text-ac-faint"}>{p.enabled ? "plugin" : "plugin · off"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
