import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight, FileCog, Plus, RefreshCw, Search } from "lucide-react";
import {
  ENV_FLAGS,
  MODELS,
  MODES,
  groupToggle,
  hookSummary,
  otherValues,
  readEnv,
  readPermissions,
  readPlugins,
  ruleGroups,
  validRule,
  type ClaudeSettingsStatus,
  type ProfileState,
  type RuleGroupView,
} from "../../../claude-settings.js";
import { t, tp, type TKey } from "../../../i18n/index.js";
import * as ipc from "../../../ipc.js";
import { cn } from "../../../lib/utils.js";
import { Badge } from "../../../ui/Badge.js";
import { Button } from "../../../ui/Button.js";
import { Card } from "../../../ui/Card.js";
import { Select } from "../../../ui/Select.js";
import { SettingRow } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { TextInput } from "../../../ui/TextInput.js";
import type { Tone } from "../../../vm/types.js";
import { useRun } from "./prefs.js";

/** Example in the add-rule field: a rule as the file holds it. */
const RULE_EXAMPLE = "Bash(make *)";

type SectionId = "behaviour" | "commands" | "plugins" | "hooks" | "more" | "accounts";

const STATE: Record<ProfileState, { tone: Tone; msg: TKey }> = {
  "in-sync": { tone: "ok", msg: "settings.claude.state.inSync" },
  linked: { tone: "ok", msg: "settings.claude.state.linked" },
  pending: { tone: "warn", msg: "settings.claude.state.pending" },
  invalid: { tone: "alert", msg: "settings.claude.state.invalid" },
};

const MODE_LABEL: Record<(typeof MODES)[number], TKey> = {
  default: "settings.claude.mode.default",
  acceptEdits: "settings.claude.mode.acceptEdits",
  plan: "settings.claude.mode.plan",
  auto: "settings.claude.mode.auto",
};

/** One collapsible block: header with summary on the right, body below when open. */
function Section({ id, title, summary, open, onToggle, children }: { id: SectionId; title: string; summary: ReactNode; open: boolean; onToggle: (id: SectionId) => void; children: ReactNode }) {
  const bodyId = `claude-settings-${id}`;
  return (
    <Card className="overflow-visible">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <ChevronRight className={cn("size-4 shrink-0 text-ac-muted transition-transform", open && "rotate-90")} />
        <span className="flex-1 text-[13px] font-medium text-ac-text">{title}</span>
        <span className="text-xs text-ac-muted">{summary}</span>
      </button>
      {open && (
        <div id={bodyId} className="border-t border-ac-line">
          {children}
        </div>
      )}
    </Card>
  );
}

/** A rule as a checkable pill. */
function RulePill({ rule, on, onChange }: { rule: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-ac-mono text-[11px] transition-colors",
        on ? "border-ac-brand-line bg-ac-brand-tint text-ac-text" : "border-ac-line text-ac-muted hover:text-ac-text",
      )}
    >
      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className={cn("inline-flex size-3 items-center justify-center rounded border", on ? "border-ac-brand bg-ac-brand text-ac-bg" : "border-ac-line2")}>{on && <Check className="size-2.5" />}</span>
      {rule}
    </label>
  );
}

function RuleGroup({ g, onRule, onGroup }: { g: RuleGroupView; onRule: (rule: string, on: boolean) => void; onGroup: (g: RuleGroupView, on: boolean) => void }) {
  const all = g.on === g.rules.length;
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium text-ac-soft">{t(g.title)}</span>
        <span className="text-[11px] text-ac-faint">{t("settings.claude.rules.count", { on: g.on, total: g.rules.length })}</span>
        {g.id !== "other" && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onGroup(g, !all)}>
            {all ? t("settings.claude.rules.none") : t("settings.claude.rules.all")}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {g.rules.map((r) => (
          <RulePill key={r.rule} rule={r.rule} on={r.on} onChange={(on) => onRule(r.rule, on)} />
        ))}
      </div>
    </div>
  );
}

const matches = (q: string, ...texts: string[]) => !q || texts.some((x) => x.toLowerCase().includes(q));

/** Settings › Claude Code: ~/.claude/settings.json, applied to every Claude account. */
export function ClaudeSettings({ load = ipc.claudeSettings }: { load?: () => Promise<ClaudeSettingsStatus> }) {
  const run = useRun();
  const [status, setStatus] = useState<ClaudeSettingsStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(["behaviour"]));
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setStatus(await load());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [load]);
  useEffect(() => void reload(), [reload]);

  const change = async (fn: () => Promise<void>) => {
    setBusy(true);
    await run(fn);
    await reload();
    setBusy(false);
  };

  const s = status?.settings ?? {};
  const env = readEnv(s);
  const perms = readPermissions(s);
  const groups = useMemo(() => ruleGroups(perms.allow), [perms.allow.join("\n")]);
  const plugins = readPlugins(s);
  const hooks = hookSummary(s);
  const more = otherValues(s);
  const q = query.trim().toLowerCase();
  const toggle = (id: SectionId) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])));
  const isOpen = (id: SectionId) => open.has(id) || q !== "";

  if (failed) return <p className="px-1 text-xs text-ac-muted">{t("settings.claude.unavailable")}</p>;
  if (!status) return <p className="px-1 text-xs text-ac-muted">{t("settings.claude.loading")}</p>;

  const flags = ENV_FLAGS.filter((f) => matches(q, f.name, t(f.title), t(f.detail)));
  const shownGroups = groups.map((g) => ({ ...g, rules: g.rules.filter((r) => matches(q, r.rule, t(g.title))) })).filter((g) => g.rules.length > 0);
  const allowedTotal = perms.allow.length;
  const pending = status.profiles.filter((p) => p.state === "pending" || p.state === "invalid").length;
  const model = typeof s.model === "string" ? s.model : "";
  const modelOptions = [{ value: "", label: t("settings.claude.model.default") }, ...[...new Set([...MODELS, ...(model ? [model] : [])])].map((m) => ({ value: m, label: m }))];

  const addRule = () => {
    const rule = draft.trim();
    if (!validRule(rule)) return;
    setDraft("");
    void change(() => ipc.setClaudeRule("allow", rule, true));
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-ac-brand-tint text-ac-brand-text">
          <FileCog className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ac-text">{t("settings.claude.oneFile")}</p>
          <p className="mt-0.5 truncate font-ac-mono text-[11px] text-ac-muted" title={status.file}>
            {status.file}
            {!status.exists && ` · ${t("settings.claude.missing")}`}
          </p>
        </div>
        <Badge tone={pending ? "warn" : "ok"} dot>
          {pending ? tp("settings.claude.pendingCount", pending) : tp("settings.claude.allInSync", status.profiles.length)}
        </Badge>
        <Button size="sm" disabled={busy} onClick={() => void change(() => ipc.syncClaudeSettings())}>
          <RefreshCw /> {t("settings.claude.applyNow")}
        </Button>
      </Card>
      {!status.valid && <p className="px-1 text-xs text-ac-alert-text">{t("settings.claude.invalid")}</p>}

      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ac-faint" />
        <TextInput className="w-full pl-8" placeholder={t("settings.claude.filter")} aria-label={t("settings.claude.filter")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      {(flags.length > 0 || !q) && (
        <Section id="behaviour" title={t("settings.claude.section.behaviour")} summary={t("settings.claude.flagsOn", { n: ENV_FLAGS.filter((f) => env[f.name] === "1").length, total: ENV_FLAGS.length })} open={isOpen("behaviour")} onToggle={toggle}>
          <div className="flex flex-col divide-y divide-ac-line">
            {flags.map((f) => (
              <SettingRow key={f.name} title={t(f.title)} detail={<><span>{t(f.detail)}</span> <span className="font-ac-mono text-ac-faint">{f.name}</span></>}>
                <Switch label={t(f.title)} checked={env[f.name] === "1"} disabled={busy} onChange={(on) => void change(() => ipc.setClaudeSetting(`env.${f.name}`, on ? "1" : undefined))} />
              </SettingRow>
            ))}
            {!q && (
              <>
                <SettingRow title={t("settings.claude.model")} detail={t("settings.claude.modelDetail")}>
                  <div className="w-[160px]">
                    <Select ariaLabel={t("settings.claude.model")} mono value={model} disabled={busy} onChange={(v) => void change(() => ipc.setClaudeSetting("model", v || undefined))} options={modelOptions} />
                  </div>
                </SettingRow>
                <SettingRow title={t("settings.claude.mode")} detail={t("settings.claude.modeDetail")}>
                  <div className="w-[160px]">
                    <Select ariaLabel={t("settings.claude.mode")} value={perms.defaultMode ?? "default"} disabled={busy} onChange={(v) => void change(() => ipc.setClaudeSetting("permissions.defaultMode", v === "default" ? undefined : v))} options={MODES.map((m) => ({ value: m, label: t(MODE_LABEL[m]) }))} />
                  </div>
                </SettingRow>
              </>
            )}
          </div>
        </Section>
      )}

      {(shownGroups.length > 0 || !q) && (
        <Section id="commands" title={t("settings.claude.section.commands")} summary={tp("settings.claude.allowedCount", allowedTotal)} open={isOpen("commands")} onToggle={toggle}>
          <div className="flex flex-col divide-y divide-ac-line">
            {shownGroups.map((g) => (
              <RuleGroup
                key={g.id}
                g={g}
                onRule={(rule, on) => void change(() => ipc.setClaudeRule("allow", rule, on))}
                onGroup={(grp, on) => void change(async () => {
                  for (const rule of groupToggle(grp, on)) await ipc.setClaudeRule("allow", rule, on);
                })}
              />
            ))}
            <div className="flex items-center gap-2 px-4 py-3">
              <TextInput mono className="flex-1" placeholder={RULE_EXAMPLE} aria-label={t("settings.claude.rules.add")} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRule()} />
              <Button size="sm" disabled={busy || !validRule(draft)} onClick={addRule}>
                <Plus /> {t("settings.claude.rules.add")}
              </Button>
            </div>
            {(perms.deny.length > 0 || perms.ask.length > 0) && <p className="px-4 py-2.5 text-[11px] text-ac-muted">{t("settings.claude.rules.denyAsk", { deny: perms.deny.length, ask: perms.ask.length })}</p>}
          </div>
        </Section>
      )}

      {!q && (
        <>
          <Section id="plugins" title={t("settings.claude.section.plugins")} summary={t("settings.claude.pluginsOn", { n: plugins.filter((p) => p.on).length, total: plugins.length })} open={isOpen("plugins")} onToggle={toggle}>
            {plugins.length === 0 ? (
              <p className="px-4 py-3 text-xs text-ac-muted">{t("settings.claude.noPlugins")}</p>
            ) : (
              <div className="flex flex-col divide-y divide-ac-line">
                {plugins.map((p) => (
                  <SettingRow key={p.id} title={<span className="font-ac-mono text-xs">{p.id}</span>}>
                    <Switch label={p.id} checked={p.on} disabled={busy} onChange={(on) => void change(() => ipc.setClaudeSetting(`enabledPlugins.${p.id}`, on))} />
                  </SettingRow>
                ))}
              </div>
            )}
          </Section>
          <Section id="hooks" title={t("settings.claude.section.hooks")} summary={tp("settings.claude.hookEvents", hooks.length)} open={isOpen("hooks")} onToggle={toggle}>
            <p className="px-4 pt-3 text-[11px] text-ac-muted">{t("settings.claude.readOnly")}</p>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-2">
              {hooks.map((h) => (
                <div key={h.event} className="flex items-center justify-between text-xs">
                  <span className="font-ac-mono text-ac-soft">{h.event}</span>
                  <span className="text-ac-muted">{tp("settings.claude.commands", h.commands)}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section id="more" title={t("settings.claude.section.more")} summary={tp("settings.claude.valuesCount", more.length)} open={isOpen("more")} onToggle={toggle}>
            <p className="px-4 pt-3 text-[11px] text-ac-muted">{t("settings.claude.readOnly")}</p>
            <dl className="flex flex-col gap-1 px-4 py-3">
              {more.map((m) => (
                <div key={m.key} className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 text-xs">
                  <dt className="truncate font-ac-mono text-ac-soft">{m.key}</dt>
                  <dd className="truncate font-ac-mono text-ac-muted" title={m.preview}>{m.preview}</dd>
                </div>
              ))}
            </dl>
            {status.withheld.length > 0 && <p className="px-4 pb-3 text-[11px] text-ac-muted">{t("settings.claude.withheld", { keys: status.withheld.join(", ") })}</p>}
          </Section>
          <Section id="accounts" title={t("settings.claude.section.accounts")} summary={tp("settings.claude.accountsCount", status.profiles.length)} open={isOpen("accounts")} onToggle={toggle}>
            <p className="px-4 pt-3 text-[11px] text-ac-muted">{t("settings.claude.accountsDetail")}</p>
            <div className="flex flex-col divide-y divide-ac-line">
              {status.profiles.map((p) => (
                <SettingRow key={p.name} title={p.name} detail={p.extras.length ? <span className="font-ac-mono">{t("settings.claude.own", { keys: p.extras.join(", ") })}</span> : undefined}>
                  <Badge tone={STATE[p.state].tone} dot>
                    {t(STATE[p.state].msg)}
                  </Badge>
                </SettingRow>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
