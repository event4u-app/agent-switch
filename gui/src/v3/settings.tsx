/**
 * Settings (spec §10.5): the left nav, Appearance, Open in and Agents (v3.2).
 * The other sections are the 2.11 settings screens, passed in by section.
 * Remote arrives with v3.2 Phase 2 and is not listed until then.
 */

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Check, Cpu, ExternalLink, Monitor, Moon, Plus, Sun } from "lucide-react";
import { cn } from "../lib/utils.js";
import { AcRoot } from "../ui/AcRoot.js";
import { Button } from "../ui/Button.js";
import { Segmented } from "../ui/Segmented.js";
import { Select } from "../ui/Select.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { Switch } from "../ui/Switch.js";
import { Chip, Marker, PageHeader } from "./kit.js";
import { THEMES, themeById, type ThemeDef, type ThemeGroup } from "./themes/registry.js";
import { resolveTheme, type Accent, type Appearance } from "./themes/resolve.js";

export const SETTINGS_NAV = ["General", "Appearance", "Sign-ins", "Protection", "Distribution", "Notifications", "Desktop pet", "Providers", "Open in", "Agents", "Updates", "Advanced"] as const;
export type SettingsSection = (typeof SETTINGS_NAV)[number];

export function SettingsPage({ current, onSection, children }: { current: SettingsSection; onSection: (s: SettingsSection) => void; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Settings" className="w-[220px] shrink-0 space-y-0.5 relative overflow-y-auto border-r border-ac-line bg-ac-panel p-3">
        {SETTINGS_NAV.map((n) => (
          <button key={n} type="button" aria-current={n === current ? "page" : undefined} onClick={() => onSection(n)} className={cn("relative flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px]", n === current ? "bg-ac-raise font-medium text-ac-text" : "text-ac-muted hover:text-ac-text")}>
            {n === current && <Marker />}
            {n}
          </button>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 relative overflow-y-auto">
        <div className="mx-auto max-w-[920px] px-8 pb-10 pt-6">
          <PageHeader title={current} />
          {children}
        </div>
      </div>
    </div>
  );
}

export function Group({ title, detail, children }: { title: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-[15px] font-semibold text-ac-text">{title}</h2>
      {detail && <p className="mt-0.5 text-xs text-ac-muted">{detail}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Row({ title, detail, children }: { title: ReactNode; detail?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ac-line py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] text-ac-text">{title}</div>
        {detail && <div className="mt-0.5 text-xs text-ac-muted">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

const Card = ({ children }: { children: ReactNode }) => <div className="rounded-[10px] border border-ac-line bg-ac-panel px-4">{children}</div>;

// ---------- Appearance ----------

/** Fixed sample lines for the mini preview: colours only, no session data. */
const SAMPLE: [string, number | null][][] = [
  [["╭─ ", 8], ["Claude", 13], [" ─╮", 8]],
  [["> ", 12], ["run the tests", null]],
  [["✓ ", 10], ["41 passed", null]],
  [["✗ ", 9], ["1 failed", 9], [" e2e/checkout", 8]],
  [["⏺ ", 11], ["Edit ", 14], ["src/store.ts", 12]],
  [["  +12 ", 2], ["−3", 1]],
];

/** A themed miniature: the theme's real tokens on a fixed sample (spec §10.5). */
export function Swatch({ def, accent, selected }: { def: ThemeDef; accent: Accent; selected?: boolean }) {
  const vars = resolveTheme(def, accent).vars;
  return (
    <AcRoot mode={def.mode} style={vars as CSSProperties} className="rounded-[10px]">
      <div className={cn("overflow-hidden rounded-[10px] border", selected ? "border-ac-brand shadow-[0_0_0_2px_var(--ac-brand-line)]" : "border-ac-line")} style={{ background: "var(--ac-bg)" }}>
        <div className="flex h-5 items-center gap-1 border-b border-ac-line bg-ac-panel px-2">
          <span className="size-1.5 rounded-full bg-ac-alert" />
          <span className="size-1.5 rounded-full bg-ac-warn" />
          <span className="size-1.5 rounded-full bg-ac-ok" />
          <span className="ml-auto h-3 w-9 rounded bg-ac-brand" />
        </div>
        <div className="flex h-[92px]">
          <div className="w-[30%] shrink-0 space-y-1 border-r border-ac-line bg-ac-rail p-1.5">
            {(["needs-you", "working", "idle"] as const).map((st, i) => (
              <div key={st} className={cn("flex items-center gap-1 rounded px-1 py-0.5 [&_svg]:size-2", i === 0 && "bg-ac-brand-tint")}>
                <SessionStateIcon state={st} />
                <span className="h-1.5 flex-1 rounded-full bg-ac-muted opacity-60" />
              </div>
            ))}
          </div>
          <div aria-hidden className="min-w-0 flex-1 overflow-hidden px-2 py-1.5 font-ac-mono text-[7.5px] leading-[1.45]" style={{ background: "var(--as-term-bg)", color: "var(--as-term-fg)" }}>
            {SAMPLE.map((segs, i) => (
              <div key={i} className="whitespace-pre">
                {segs.map(([t, a], j) => (
                  <span key={j} style={{ color: a != null ? `var(--as-ansi-${a})` : undefined }}>
                    {t}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AcRoot>
  );
}

const GROUPS: { id: ThemeGroup; label: string }[] = [
  { id: "jetbrains", label: "JetBrains" },
  { id: "agent-switch", label: "Agent Switch" },
  { id: "popular", label: "Popular" },
  { id: "accessible", label: "Accessibility" },
];

/** Picking a theme sets the slot of its own mode; "Sync with OS" keeps one per mode. Pure. */
export function pickTheme(a: Appearance, def: ThemeDef): Appearance {
  const slot = def.mode === "dark" ? { dark: def.id } : { light: def.id };
  return { ...a, ...slot, mode: a.mode === "system" ? "system" : def.mode };
}

export function AppearanceSettings({ a, prefersDark, onChange }: { a: Appearance; prefersDark: boolean; onChange: (a: Appearance) => void }) {
  const currentId = a.mode === "light" || (a.mode === "system" && !prefersDark) ? a.light : a.dark;
  const current = themeById(currentId);
  const lights = THEMES.filter((t) => t.mode === "light").length;
  return (
    <>
      <Group title="Theme" detail="Colours for the whole app, the tray, the pet bubble and the terminal.">
        <div className="mb-4 flex items-center gap-3">
          <Segmented
            label="Mode"
            value={a.mode}
            onChange={(mode) => onChange({ ...a, mode })}
            options={[
              { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
              { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" />Light</span> },
              { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" />Sync with OS</span> },
            ]}
          />
          {a.mode === "system" && (
            <span className="text-xs text-ac-muted">
              dark → <span className="text-ac-text">{themeById(a.dark).name}</span>, light → <span className="text-ac-text">{themeById(a.light).name}</span>
            </span>
          )}
        </div>
        {GROUPS.map((g) => (
          <div key={g.id} className="mb-4">
            <div className="ac-caps mb-2">{g.label}</div>
            <div className="grid grid-cols-4 gap-3">
              {THEMES.filter((t) => t.group === g.id).map((t) => {
                const selected = a.mode === "system" ? t.id === a.dark || t.id === a.light : t.id === currentId;
                return (
                  <button key={t.id} type="button" aria-pressed={selected} onClick={() => onChange(pickTheme(a, t))} className="min-w-0 text-left">
                    <Swatch def={t} accent={a.accent} selected={selected} />
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {selected && <Check className="size-3.5 shrink-0 text-ac-brand-text" />}
                      {/* Keyed on the weight, see SessionRow: the ellipsis must be decided again. */}
                      <span key={selected ? "on" : "off"} className={cn("truncate text-[13px]", selected ? "font-semibold text-ac-text" : "text-ac-soft")}>{t.name}</span>
                      {t.id === "darcula" && <Chip>default</Chip>}
                    </div>
                    <div className="truncate text-[11px] text-ac-muted">{t.note}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-ac-muted">
          {lights} light and {THEMES.length - lights} dark themes. Colours come from each theme's published source; see “About {current.name}”.
        </p>
      </Group>
      <Group title="Details">
        <Card>
          <Row title="Accent" detail="Buttons, selection, active tab. The theme's own, or Agent Switch orange.">
            <Segmented size="sm" label="Accent" value={a.accent} onChange={(accent) => onChange({ ...a, accent })} options={[{ value: "theme", label: "Theme" }, { value: "agent-switch", label: <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#ff8c2a]" />Agent Switch</span> }]} />
          </Row>
          <Row title="Terminal uses the theme's colours" detail="Off: the agent's own colours on the theme background.">
            <Switch checked={a.terminalFollows} onChange={(terminalFollows) => onChange({ ...a, terminalFollows })} label="Terminal uses the theme's colours" />
          </Row>
          <Row title="Contrast" detail="Text that misses WCAG AA on a theme is lifted just enough. Nothing else changes.">
            <span className="text-xs text-ac-muted">always on</span>
          </Row>
          <Row title={`About ${current.name}`} detail={current.source.label}>
            <a href={current.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ac-info-text">
              source <ExternalLink className="size-3" />
            </a>
          </Row>
        </Card>
      </Group>
    </>
  );
}

// ---------- Open in ----------

/** One row of `agent-switch open-targets <session> --json`. */
export interface OpenTarget {
  target: string;
  label: string;
  kind: "editor" | "files" | "terminal" | "agent-app";
  installed: boolean;
}

export function OpenInSettings({ targets, defaultTarget, perRepo, focusTerminal, on }: { targets: OpenTarget[]; defaultTarget: string | null; perRepo: Record<string, string>; focusTerminal: boolean; on: { setDefault: (target: string, repo?: string) => void; focusTerminal: (v: boolean) => void } }) {
  const usable = targets.filter((t) => t.installed);
  const options = usable.map((t) => ({ value: t.target, label: t.label }));
  return (
    <>
      <Group title="Targets" detail="What “Open in” offers. Editors open the worktree root with their own launcher; missing apps stay hidden.">
        <Card>
          {targets.map((t) => (
            <Row key={t.target} title={t.label} detail={t.kind}>
              <span className={cn("text-xs", t.installed ? "text-ac-soft" : "text-ac-muted")}>{t.installed ? "found" : "not installed · hidden"}</span>
            </Row>
          ))}
        </Card>
      </Group>
      <Group title="Default for the Open button (⌘O)">
        <Card>
          <Row title="All repositories" detail="Used by the primary Open button.">
            <Select ariaLabel="Default for all repositories" value={defaultTarget ?? ""} onChange={(v) => on.setDefault(v)} options={[{ value: "", label: "Ask" }, ...options]} />
          </Row>
          {Object.entries(perRepo).map(([repo, target]) => (
            <Row key={repo} title={<span className="font-ac-mono text-xs">{repo}</span>} detail="Per-repository override">
              <Select ariaLabel={`Default for ${repo}`} value={target} onChange={(v) => on.setDefault(v, repo)} options={options} />
            </Row>
          ))}
          <Row title="Focus terminal" detail="For sessions in your own terminal. macOS asks once for Automation access.">
            <Switch checked={focusTerminal} onChange={on.focusTerminal} label="Focus terminal" />
          </Row>
        </Card>
        <p className="mt-2 text-[11px] text-ac-muted">Launchers are allowlisted, paths must be inside a known worktree, arguments are passed as argv — never as a URL scheme.</p>
      </Group>
    </>
  );
}

// ---------- Agents (v3.2) ----------

export interface AgentRowView {
  id: string;
  name: string;
  binary: string;
  cls: "deep" | "acp" | "terminal";
  enabled: boolean;
  version: string | null;
  local: { runner: string; model: string } | null;
}

export interface AgentSuggestionView {
  id: string;
  name: string;
  install: string[];
}

const CLASSES = {
  deep: { label: "deep", detail: "accounts, limits, switching" },
  acp: { label: "ACP", detail: "chat view; limits only if reported" },
  terminal: { label: "terminal only", detail: "dock tab, no structured view" },
};

const RUNNER: Record<string, string> = { ollama: "Ollama", lmstudio: "LM Studio" };
const COLS = "grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_120px_minmax(0,1.3fr)_56px]";

/** Settings › Agents (spec §10.5): one row per agent with its class and a switch. */
export function AgentsSettings({ agents, suggestions, on }: { agents: AgentRowView[]; suggestions: AgentSuggestionView[]; on: { toggle: (id: string, value: boolean) => void; install: (id: string) => void } }) {
  const [adding, setAdding] = useState(false);
  return (
    <Group title="Agents" detail="Every agent goes through the same session model. AS installs nothing silently and runs no model itself — local models come through agents that support them.">
      <div className="rounded-[10px] border border-ac-line bg-ac-panel">
        <div className={cn("grid gap-3 border-b border-ac-line px-4 py-2 text-[11px] font-medium text-ac-muted", COLS)}>
          <span>Agent</span>
          <span>Binary</span>
          <span>Class</span>
          <span>Model</span>
          <span />
        </div>
        {agents.map((a) => (
          <div key={a.id} className={cn("grid items-center gap-3 border-b border-ac-line px-4 py-2.5 last:border-b-0", COLS)}>
            <span className="truncate text-[13px] text-ac-text">{a.name}</span>
            <span className="truncate font-ac-mono text-xs text-ac-soft" title={a.version ? `${a.binary} ${a.version}` : `${a.binary} · not found on this machine`}>
              {a.binary}
            </span>
            <span title={CLASSES[a.cls].detail}>
              <Chip>{CLASSES[a.cls].label}</Chip>
            </span>
            <span className="min-w-0">
              {a.local ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ac-ok-text">
                  <Cpu className="size-3.5 shrink-0" />
                  <span className="truncate">
                    local · {RUNNER[a.local.runner] ?? a.local.runner} · {a.local.model}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-ac-faint">provider default</span>
              )}
            </span>
            <span className="flex justify-end">
              <Switch checked={a.enabled} onChange={(v) => on.toggle(a.id, v)} label={`Use ${a.name}`} />
            </span>
          </div>
        ))}
      </div>
      <div className="relative mt-2 flex items-center gap-2">
        <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding} disabled={!suggestions.length}>
          <Plus /> Add agent
        </Button>
        <span className="text-[11px] text-ac-muted">Suggestions from the ACP agent list · install commands run visibly in the terminal sheet</span>
        {adding && (
          <div role="menu" aria-label="Add agent" className="absolute left-0 top-9 z-20 w-[320px] rounded-xl border border-ac-line2 bg-ac-panel p-1" style={{ boxShadow: "var(--ac-shadow)" }}>
            {suggestions.map((s) => (
              <button key={s.id} type="button" role="menuitem" onClick={() => (setAdding(false), on.install(s.id))} className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-ac-raise">
                <span className="text-[13px] text-ac-text">{s.name}</span>
                <span className="font-ac-mono text-[11px] text-ac-muted">{s.install.join(" ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Group>
  );
}
