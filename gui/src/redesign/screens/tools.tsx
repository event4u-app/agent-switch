import { useEffect, useRef, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { BookOpen, Check, ChevronDown, Copy, Download, ExternalLink, Layers, Link2, Map as MapIcon, MoreHorizontal, RefreshCw, RotateCw, Settings2 } from "lucide-react";
import { AGENT_CONFIG_REPO, AGENT_CONFIG_REPO_URL } from "../../agent-config.js";
import * as ipc from "../../ipc.js";
import { cn } from "../../lib/utils.js";
import { releaseNoteBlocks } from "../../release-notes.js";
import { getShareSource, setShareGlobalFlag, setShareSourceFlag } from "../../settings-store.js";
import { versionToken } from "../../tool-updates.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { Caps, PageHeader, SectionHeader } from "../../ui/Typography.js";
import { ago } from "../../ui/format.js";
import { fetchReleases, isNewer, releasesNewerThan, type ReleaseInfo } from "../../updates.js";
import { TOOL_LABEL, toolStatus, updateCount, type ToolStatus } from "../../vm/rules.js";
import { useAS, type Store } from "../../vm/store.js";
import type { Account, AgentConfigStatus, ReleaseNote, Tone, ToolEntry } from "../../vm/types.js";
import { Apps } from "./apps.js";
import { rowClick } from "./rows.js";

// ------------------------------------------------------------------ logic

/** Design `b0`. */
export const TOOL_STATUS: Record<ToolStatus, { label: string; tone: Tone }> = {
  update: { label: "Update available", tone: "info" },
  ok: { label: "Up to date", tone: "ok" },
  attention: { label: "Needs a look", tone: "warn" },
  missing: { label: "Not installed", tone: "neutral" },
  unknown: { label: "Latest unknown", tone: "neutral" },
};

/** Design `S0`: attention → update → ok → unknown → missing. */
const STATUS_ORDER: Record<ToolStatus, number> = { attention: 0, update: 1, ok: 2, unknown: 3, missing: 4 };

export function sortTools(tools: readonly ToolEntry[]): ToolEntry[] {
  return [...tools].sort((a, b) => STATUS_ORDER[toolStatus(a)] - STATUS_ORDER[toolStatus(b)]);
}

/** Tools with a verified `tooling install|upgrade` behind them. agy has none —
 *  the CLI refuses it, so its row never offers Install. */
export const INSTALLABLE_TOOLS: ReadonlySet<string> = new Set(["agent-config", "rtk", "claude", "codex"]);

/** The last backticked span of a CLI hint (`… — install: \`brew install rtk\``). */
export function commandFromText(text: string | undefined): string | null {
  const spans = text?.match(/`([^`]+)`/g);
  return spans?.length ? spans[spans.length - 1].slice(1, -1) : null;
}

/** What the copy button copies: the tooling command where one is verified,
 *  else the command the CLI's own hint names; null = nothing honest to copy. */
export function copyCommand(t: ToolEntry): string | null {
  return INSTALLABLE_TOOLS.has(t.id) ? (t.command ?? null) : commandFromText(t.hint);
}

/** "2 accounts isolated" for the provider CLIs (design `c`). */
export function isolatedLabel(toolId: string, accounts: readonly Account[]): string | null {
  const tool = toolId === "agy" ? "antigravity" : toolId;
  const n = accounts.filter((a) => a.tool === tool).length;
  return n ? `${n} account${n === 1 ? "" : "s"} isolated` : null;
}

/** null = no badge: agent-config not being started is its normal state, not a finding. */
export const AC_STATUS: Record<AgentConfigStatus, { label: (port: number | null) => string; tone: Tone } | null> = {
  live: { label: (port) => `Running · port ${port}`, tone: "ok" },
  "not-running": null,
  wedged: { label: () => "Not responding", tone: "alert" },
  "not-installed": { label: () => "Not installed", tone: "neutral" },
  unknown: { label: () => "Status unknown", tone: "neutral" },
};

/** Design `v0`: agent-config is not on this computer. */
export function agentConfigMissing(vm: Pick<Store, "agentConfig" | "tools">): boolean {
  if (vm.agentConfig.status === "not-installed") return true;
  const t = vm.tools.find((x) => x.id === "agent-config");
  return vm.agentConfig.status === "unknown" && !!t && !t.present;
}

/** Latest + unread notes for an installed agent-config from its GitHub
 *  releases. Null when the list is empty (offline, no releases). */
export function acReleaseFrom(releases: readonly ReleaseInfo[], current: string): { latest: string; notes: ReleaseNote[] } | null {
  if (!releases.length) return null;
  const top = releases[0].tag;
  const latest = isNewer(top, current) ? (versionToken(top) ?? top) : current;
  const notes = releasesNewerThan(releases, current)
    .map((r) => ({
      version: versionToken(r.tag) ?? r.tag,
      items: releaseNoteBlocks(r.notes)
        .filter((b) => b.kind === "item")
        .map((b) => b.text)
        .slice(0, 6),
      url: r.url,
    }))
    .filter((n) => n.items.length);
  return { latest, notes };
}

/** Opens a URL in the default browser (window.open outside Tauri). */
export function openExternal(url: string) {
  shellOpen(url).catch(() => window.open(url, "_blank", "noopener"));
}

type AcRelease = ReturnType<typeof acReleaseFrom>;

/** A failed (or empty) release lookup is retried after this long — or right
 *  away after "Check now". A hit is kept for the installed version. */
export const RELEASE_RETRY_MS = 10 * 60_000;

const releaseCache = new Map<string, { at: number; p: Promise<AcRelease>; failed: boolean }>();

/** agent-config's latest release + notes for the installed `current`, cached. */
export function releaseLookup(current: string, fetcher: () => Promise<AcRelease>, now: number = Date.now()): Promise<AcRelease> {
  const hit = releaseCache.get(current);
  if (hit && (!hit.failed || now - hit.at < RELEASE_RETRY_MS)) return hit.p;
  const entry = { at: now, failed: false, p: Promise.resolve<AcRelease>(null) };
  entry.p = fetcher()
    .catch(() => null)
    .then((rel) => {
      entry.failed = rel == null;
      return rel;
    });
  releaseCache.set(current, entry);
  return entry.p;
}

/** "Check now": failed lookups run again on the next render. */
export function forgetFailedReleaseLookups(): void {
  for (const [k, v] of releaseCache) if (v.failed) releaseCache.delete(k);
}

/** The load path checks rtk/claude/codex only; agent-config's latest comes from
 *  its GitHub releases (as the classic window does) and is patched into the
 *  view model once per installed version. A failed lookup is retried on a
 *  later re-sweep (focus, "Check now") once RELEASE_RETRY_MS passed. */
function useAgentConfigLatest(s: Store) {
  const ac = s.tools.find((t) => t.id === "agent-config");
  const current = ac?.present ? ac.version : null;
  const known = ac?.latest != null;
  const checkedAt = s.toolsCheckedAt;
  const update = useRef(s.update);
  update.current = s.update;
  useEffect(() => {
    if (!current || known) return;
    let alive = true;
    void releaseLookup(current, () => fetchReleases(AGENT_CONFIG_REPO).then((r) => acReleaseFrom(r, current))).then((rel) => {
      if (!alive || !rel) return;
      update.current((vm) => ({
        tools: vm.tools.map((t) => (t.id === "agent-config" && t.version === current ? { ...t, latest: rel.latest, notes: rel.notes } : t)),
        agentConfig: { ...vm.agentConfig, latest: rel.latest },
      }));
    });
    return () => {
      alive = false;
    };
  }, [current, known, checkedAt]);
}

// ---------------------------------------------------------------- screens

/** Bundle `gP`. */
export function Tools() {
  const s = useAS();
  const updates = updateCount(s.tools);
  useAgentConfigLatest(s);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Which tools does it look after?"
        sub="agent-config, rtk and the agent CLIs — installed, current, and where Agent Switch reaches into your apps."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="View"
          value={s.toolsTab}
          onChange={s.setToolsTab}
          options={[
            {
              value: "tools",
              label: updates ? `Tools ${s.tools.length} · ${updates} update${updates === 1 ? "" : "s"}` : `Tools ${s.tools.length}`,
            },
            { value: "apps", label: `Apps ${s.surfaces.length}` },
          ]}
        />
        {s.toolsTab === "tools" && (
          <span className="flex items-center gap-2 text-xs text-ac-faint">
            {s.toolsCheckedAt != null ? `checked ${ago(s.toolsCheckedAt, s.now)}` : "not checked yet"}
            <Button size="sm" variant="ghost" onClick={() => {
                forgetFailedReleaseLookups();
                void s.act.recheckTools?.();
              }} disabled={!s.act.recheckTools || s.loading}>
              <RefreshCw /> Check now
            </Button>
          </span>
        )}
      </div>
      {s.toolsTab === "tools" ? <ToolList /> : <Apps />}
    </div>
  );
}

/** Design `y0`. */
function AcTile({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-ac-brand-line bg-ac-brand-tint font-display tracking-[0.02em] text-ac-brand-text"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      AC
    </span>
  );
}

const AC_BENEFITS = [
  { icon: Layers, title: "Skills, commands and rules", text: "Compiled into Claude Code, Cursor and 5+ hosts — the same in every session." },
  { icon: Link2, title: "One setup for all accounts", text: "Agent Switch shares it across your Claude accounts; sign-ins stay apart." },
  { icon: RefreshCw, title: "Kept current for you", text: "Agent Switch installs it and shows its updates here, with what's new." },
];

/** Design `k0` card variant (artboard 20 NoAC-Tools). */
export function NoAgentConfigCard() {
  const s = useAS();
  return (
    <Card className="flex flex-col overflow-hidden border-ac-brand-line">
      <div className="flex flex-wrap items-start gap-4 bg-ac-brand-tint p-4">
        <AcTile />
        <div className="min-w-[240px] flex-1">
          <p className="text-[15px] font-semibold text-ac-text">
            Supercharge your AI agents with <span className="whitespace-nowrap">agent-config</span>
          </p>
          <p className="mt-1 text-xs text-ac-muted">Free &amp; open source: skills, commands and governed rules — no daemon, no proxy.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => openExternal(AGENT_CONFIG_REPO_URL)} title={AGENT_CONFIG_REPO_URL}>
            <BookOpen /> Read more
          </Button>
          <Button size="sm" variant="primary" onClick={() => s.open({ kind: "terminal", toolId: "agent-config", action: "install" })}>
            <Download /> Install agent-config
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-ac-line px-4 py-3">
        <Caps>What you get with both</Caps>
        <ul className="grid gap-3 md:grid-cols-3">
          {AC_BENEFITS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 size-4 shrink-0 text-ac-brand-text" />
              <span className="min-w-0">
                <span className="block text-[13px] text-ac-text">{title}</span>
                <span className="mt-0.5 block text-xs text-ac-muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="font-ac-mono text-[11px] text-ac-faint">$ agent-switch tooling install agent-config</p>
      </div>
    </Card>
  );
}

function ReleaseNotesList({ notes }: { notes: ReleaseNote[] }) {
  return (
    <>
      {notes.map((n) => (
        <div key={n.version} className="flex flex-col gap-1">
          <span className="flex items-center justify-between gap-3">
            <span className="font-ac-mono text-[11px] text-ac-brand-text">{n.version}</span>
            <button
              type="button"
              className="text-[11px] text-ac-muted hover:text-ac-text"
              onClick={() => openExternal(n.url ?? `${AGENT_CONFIG_REPO_URL}/releases`)}
            >
              Release page ↗
            </button>
          </span>
          <ul className="flex flex-col gap-0.5">
            {n.items.map((item) => (
              <li key={item} className="text-xs text-ac-soft">
                · {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "kind" in e) {
    const k = e as { kind: string; message?: string; stderr?: string };
    return k.message ?? k.stderr ?? k.kind;
  }
  return String(e);
}

/** Design `vP`: the agent-config card with its shared-setup block. */
export function AgentConfigCard() {
  const s = useAS();
  const t = s.agentConfig;
  const acTool = s.tools.find((x) => x.id === "agent-config");
  const hasUpdate = acTool ? toolStatus(acTool) === "update" : false;
  const latest = acTool?.latest ?? t.latest;
  const notes = acTool?.notes ?? [];
  const status = AC_STATUS[t.status];
  const claude = s.accounts.filter((a) => a.tool === "claude");
  const def = claude.find((a) => a.isDefault);

  const [share, setShare] = useState<ipc.ShareStatus | null>(null);
  const [source, setSource] = useState(() => getShareSource());
  const [openError, setOpenError] = useState<{ title: string; detail: string; command?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    ipc
      .shareStatus()
      .then((x) => alive && setShare(x))
      .catch(() => alive && setShare(null));
    return () => {
      alive = false;
    };
  }, []);

  const shared = share?.active ?? false;
  const sharedAccounts = (share?.profiles ?? []).filter((p) => p.shared).map((p) => `claude:${p.name}`);
  const sourceId = source === "default" ? "default" : `claude:${source}`;
  const sourcePath = source === "default" ? "~/.claude" : `~/.agent-switch/profiles/claude/${source}`;

  const rereadShare = () =>
    ipc
      .shareStatus()
      .then(setShare)
      .catch(() => {});

  async function openAc() {
    setOpenError(null);
    try {
      await s.act.openAgentConfig?.();
    } catch (e) {
      setOpenError({ title: "agent-config could not be opened", detail: errorText(e), command: "agent-config ui:serve" });
    }
  }

  function restart() {
    s.open({
      kind: "confirm",
      title: "Restart agent-config?",
      body:
        t.status === "wedged"
          ? `agent-config is not responding${t.pid ? ` (pid ${t.pid})` : ""}. Restarting stops that process and starts a fresh one. Its settings and your agents' files are kept.`
          : "Stops the running agent-config and starts a fresh one. Its settings and your agents' files are kept.",
      confirm: "Force restart",
      danger: t.status === "wedged",
      onConfirm: () => {
        s.act.restartAgentConfig?.().catch((e) => s.toast({ text: `Restart failed: ${errorText(e)}`, tone: "alert" }));
      },
    });
  }

  function toggleShare(on: boolean) {
    setShareGlobalFlag(on);
    setShare((prev) => (prev ? { ...prev, active: on } : prev));
    s.act
      .setSharedSetup?.(on, source)
      .then(rereadShare)
      .catch((e) => {
        s.toast({ text: errorText(e), tone: "alert" });
        void rereadShare();
      });
  }

  function chooseSource(id: string) {
    if (id === sourceId) return;
    const name = id === "default" ? "default" : id.slice("claude:".length);
    s.open({
      kind: "confirm",
      title: "Relink all Claude accounts?",
      body: `Skills, rules and settings of every Claude account will come from ${
        id === "default" ? "your global ~/.claude" : `${s.accountById(id)?.name ?? name}`
      }. Sign-ins stay separate. Files an account has of its own stay untouched.`,
      confirm: "Relink",
      onConfirm: () => {
        setShareSourceFlag(name);
        setSource(name);
        if (shared)
          s.act
            .setSharedSetup?.(true, name)
            .then(rereadShare)
            .catch((e) => s.toast({ text: errorText(e), tone: "alert" }));
      },
    });
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <AcTile />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ac-text">agent-config</span>
            {status && (
              <Badge tone={status.tone} dot>
                {status.label(t.port)}
              </Badge>
            )}
            {hasUpdate && <Badge tone="info">{latest} available</Badge>}
          </div>
          <p className="mt-1 text-xs text-ac-muted">
            Skills, rules and the knowledge map your agents use · {t.version ?? acTool?.version ?? "version unknown"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasUpdate && (
            <Button variant="primary" size="sm" onClick={() => s.open({ kind: "terminal", toolId: "agent-config", action: "update" })}>
              <Download /> Update to {latest}
            </Button>
          )}
          <Button size="sm" onClick={() => void openAc()} disabled={t.status !== "live" || !s.act.openAgentConfig}>
            <MapIcon /> Knowledge map
          </Button>
          <RowMenu
            items={[
              {
                id: "settings",
                label: "agent-config settings",
                icon: <Settings2 />,
                disabled: t.status !== "live" || !s.act.openAgentConfig,
                onSelect: () => void openAc(),
              },
              {
                id: "restart",
                label: "Restart agent-config …",
                icon: <RotateCw />,
                // The backend's force restart is for a wedged server only.
                disabled: t.status !== "wedged" || !s.act.restartAgentConfig,
                onSelect: restart,
              },
              { id: "repo", label: "Open the repository", icon: <ExternalLink />, separatorBefore: true, onSelect: () => openExternal(AGENT_CONFIG_REPO_URL) },
            ]}
            trigger={
              <IconButton label="More for agent-config">
                <MoreHorizontal />
              </IconButton>
            }
          />
        </div>
      </div>
      {t.status === "wedged" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ac-line bg-ac-alert-tint px-4 py-3">
          <p className="text-xs text-ac-alert-text">
            agent-config is not responding{t.pid ? ` (pid ${t.pid})` : ""} — restart it?
          </p>
          <Button size="sm" variant="danger" onClick={restart}>
            Force restart
          </Button>
        </div>
      )}
      {openError && (
        <div className="flex flex-col gap-1.5 border-t border-ac-line bg-ac-warn-tint px-4 py-3">
          <p className="text-xs font-medium text-ac-warn-text">{openError.title}</p>
          <p className="text-xs text-ac-soft">{openError.detail}</p>
          {openError.command && (
            <code className="w-fit rounded bg-ac-bg px-2 py-1 font-ac-mono text-[11px] text-ac-text">{openError.command}</code>
          )}
        </div>
      )}
      {hasUpdate && notes.length > 0 && (
        <div className="border-t border-ac-line px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <BookOpen className="size-3.5 text-ac-muted" />
            <Caps>What's new</Caps>
          </div>
          <ReleaseNotesList notes={notes} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ac-line px-4 py-3 text-xs">
        <span className="text-ac-muted">
          Active in{" "}
          {def ? (
            <span className="inline-flex items-center gap-1.5 text-ac-text">
              <AccountDot color={def.color} size={7} /> Claude · {def.name}
            </span>
          ) : (
            <span className="text-ac-text">no Claude account</span>
          )}
          {shared && <span> · shared across {sharedAccounts.length}</span>}
        </span>
        {t.status === "live" && (
          <span className="font-ac-mono text-[11px] text-ac-faint">
            v{t.version ?? "?"} · port {t.port}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ac-line px-4 py-3">
        <div className="flex min-w-[260px] flex-1 items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] text-ac-text">Share one setup across Claude accounts</p>
            <p className="mt-0.5 text-xs text-ac-muted">Skills, rules, settings and your prompt history (↑ and Ctrl+R) come from one place; sign-ins stay separate.</p>
            {shared && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sharedAccounts.map((id) => {
                  const a = s.accountById(id);
                  return a ? (
                    <span key={id} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-ac-line px-2 text-[11px] text-ac-soft">
                      <AccountDot color={a.color} size={7} /> {a.name}
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>
          <Switch
            label="Share one setup across Claude accounts"
            checked={shared}
            disabled={share == null || !s.act.setSharedSetup}
            onChange={toggleShare}
          />
        </div>
        {shared && (
          <div className="flex w-full flex-col gap-1.5 md:w-[260px]">
            <Select
              label="Setup comes from"
              value={sourceId}
              onChange={chooseSource}
              options={[
                { value: "default", label: "Default (~/.claude)", hint: "Your global Claude setup" },
                ...claude.map((a) => ({ value: a.id, label: `${TOOL_LABEL[a.tool]} · ${a.name}`, dot: <AccountDot color={a.color} size={8} /> })),
              ]}
            />
            <span className="truncate font-ac-mono text-[10px] text-ac-faint" title={sourcePath}>
              {sourcePath}
            </span>
            {source !== "default" && (
              <button type="button" className="w-fit text-[11px] text-ac-muted hover:text-ac-text" onClick={() => chooseSource("default")}>
                Reset to default
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Design `yP`. */
export function ToolList() {
  const s = useAS();
  const rows = sortTools(s.tools);
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const attention = s.tools.filter((t) => toolStatus(t) === "attention").length;
  const updates = updateCount(s.tools);
  const summary = [attention ? `${attention} need${attention === 1 ? "s" : ""} a look` : null, updates ? `${updates} update${updates === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6">
      {agentConfigMissing(s) ? <NoAgentConfigCard /> : <AgentConfigCard />}
      <section className="flex flex-col gap-1">
        <SectionHeader title="Tools" count={s.tools.length} actions={summary ? <span className="text-[11px] text-ac-muted">{summary}</span> : undefined} />
        <div className="hidden grid-cols-[minmax(0,1fr)_92px_92px_140px] gap-x-4 px-3 pb-1 md:grid">
          <span className="ac-caps">Tool</span>
          <span className="ac-caps">Installed</span>
          <span className="ac-caps">Latest</span>
          <span className="ac-caps text-right">&nbsp;</span>
        </div>
        <Card className="p-1">
          <div className="flex flex-col divide-y divide-ac-line">
            {rows.map((u) => {
              const f = toolStatus(u);
              const notes = u.notes?.length && f === "update" ? u.notes : null;
              const sub = [u.hint ?? u.role, isolatedLabel(u.id, s.accounts)].filter(Boolean).join(" · ");
              const cmd = copyCommand(u);
              const open = expanded === u.id;
              const toggle = () => setExpanded(open ? null : u.id);
              return (
                <div key={u.id} className="flex flex-col">
                  <div
                    {...(notes ? rowClick(toggle) : {})}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_92px_92px_140px]",
                      notes && "cursor-pointer transition-colors hover:bg-ac-raise",
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ac-text">{u.name}</span>
                        {f !== "ok" && <Badge tone={TOOL_STATUS[f].tone}>{TOOL_STATUS[f].label}</Badge>}
                      </span>
                      <span className="truncate text-[11px] text-ac-muted">{sub}</span>
                      {u.present && u.path && f !== "missing" && (
                        <span className="truncate font-ac-mono text-[10px] text-ac-faint" title={u.path}>
                          {u.path}
                        </span>
                      )}
                      {notes && (
                        <button
                          type="button"
                          onClick={toggle}
                          className="mt-1 flex w-fit items-center gap-1 text-[11px] text-ac-info-text hover:underline"
                          aria-expanded={open}
                        >
                          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} /> What's new in {notes[0].version}
                        </button>
                      )}
                    </span>
                    <span className="hidden font-ac-mono text-xs text-ac-soft md:block">{u.version ?? "—"}</span>
                    <span className={cn("hidden font-ac-mono text-xs md:block", f === "update" ? "text-ac-info-text" : "text-ac-faint")}>
                      {u.latest ?? "—"}
                    </span>
                    <span className="col-start-2 row-start-1 flex justify-end gap-1 md:col-start-auto md:row-start-auto">
                      {f === "update" && INSTALLABLE_TOOLS.has(u.id) && (
                        <Button size="sm" variant="primary" onClick={() => s.open({ kind: "terminal", toolId: u.id, action: "update" })}>
                          <Download /> Update
                        </Button>
                      )}
                      {f === "missing" && INSTALLABLE_TOOLS.has(u.id) && (
                        <Button size="sm" onClick={() => s.open({ kind: "terminal", toolId: u.id, action: "install" })}>
                          <Download /> Install
                        </Button>
                      )}
                      {f === "ok" && (
                        <span className="inline-flex h-7 items-center gap-1 text-xs text-ac-ok-text">
                          <Check className="size-3.5" /> Up to date
                        </span>
                      )}
                      {cmd && f !== "ok" && (
                        <IconButton
                          label={copied === u.id ? "Copied" : `Copy: ${cmd}`}
                          onClick={() => {
                            navigator.clipboard?.writeText(cmd).catch(() => {});
                            setCopied(u.id);
                          }}
                        >
                          {copied === u.id ? <Check /> : <Copy />}
                        </IconButton>
                      )}
                    </span>
                  </div>
                  {notes && open && (
                    <div className="mx-3 mb-3 flex flex-col gap-2 rounded-md border border-ac-line bg-ac-bg p-3">
                      <ReleaseNotesList notes={notes} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        <p className="px-1 pt-1 text-[11px] text-ac-faint">
          Install and update run in the built-in terminal, so you see every line. Running sessions keep their version until they restart. If npm says
          EACCES, your global npm folder isn't writable — the terminal shows the fix.{" "}
          {s.platform === "mac" ? "Checked on macOS." : s.platform === "windows" ? "Checked on Windows." : "Checked on Linux."}
        </p>
      </section>
    </div>
  );
}
