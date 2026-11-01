import { useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { t } from "../../i18n/index.js";
import { tx } from "../../i18n/react.js";
import { typedFolder, useHomeDir } from "../../lib/paths.js";
import { cn } from "../../lib/utils.js";
import type { DirResolution } from "../../ipc.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button, IconButton } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { RowMenu } from "../../ui/RowMenu.js";
import { shortPath } from "../../ui/format.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { TextInput } from "../../ui/TextInput.js";
import { SectionHeader } from "../../ui/Typography.js";
import { accountIdFromMember } from "../../vm/build.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Account, Binding, Pool, Tool } from "../../vm/types.js";
import { PoolsSection } from "./pools-panel.js";
import { RowList } from "./rows.js";
import { recentFolders } from "./logic.js";

type Explain = { state: "idle" } | { state: "loading" } | { state: "done"; res: DirResolution } | { state: "error"; message: string };

/** The "Try a folder" answer from the CLI (`dir --json`). */
function useExplain(dir: string, tool: Tool): Explain {
  const s = useAS();
  const [out, setOut] = useState<Explain>({ state: "idle" });
  const explain = s.act.explainFolder;
  useEffect(() => {
    if (!dir || !explain) {
      setOut({ state: "idle" });
      return;
    }
    let cancelled = false;
    setOut({ state: "loading" });
    explain(dir, tool).then(
      (res) => !cancelled && setOut({ state: "done", res }),
      (e: unknown) => !cancelled && setOut({ state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [dir, tool, explain]);
  return out;
}

/** Tools a folder binding can be made for (Gemini has no backend). */
export const BINDING_TOOLS: Tool[] = ["claude", "codex"];

/** Targets of a new binding for one tool: that tool's accounts, then the pools. */
export function bindingTargets(accounts: readonly Account[], pools: readonly Pool[], tool: Tool): { value: string; label: string }[] {
  return [
    ...accounts.filter((a) => a.tool === tool).map((a) => ({ value: `account:${a.id}`, label: `${TOOL_LABEL[a.tool]} · ${a.name}` })),
    ...pools.map((p) => ({ value: `pool:${p.id}`, label: t("tools.bindings.poolTarget", { name: p.label }) })),
  ];
}

/** `account:<id>` / `pool:<id>` → the `mapFolder` target. */
export function bindingTarget(value: string, tool: Tool): { accountId: string } | { pool: string; tool: Tool } | null {
  if (value.startsWith("account:")) return { accountId: value.slice("account:".length) };
  if (value.startsWith("pool:")) return { pool: value.slice("pool:".length), tool };
  return null;
}

/** The form's `account:<id>` / `pool:<id>` value for a binding's target. */
const targetValue = (b: Binding) => (b.target.kind === "account" ? `account:${b.target.accountId}` : `pool:${b.target.pool}`);

/** Inline binding form: folder + tool + account or pool (`agent-switch map`).
 *  With `editing` it changes that binding: the same folder and tool are simply
 *  mapped again (a paused rule stays paused); a new folder or tool is mapped,
 *  the old rule removed, and a paused binding paused again in its new place. */
function BindingForm({ initialDir, editing, onDone }: { initialDir: string; editing?: Binding; onDone: () => void }) {
  const s = useAS();
  const [dir, setDir] = useState(editing?.match.value ?? initialDir);
  const [tool, setTool] = useState<Tool>(editing && editing.tool !== "any" ? editing.tool : "claude");
  const targets = bindingTargets(s.accounts, s.pools, tool);
  const [target, setTarget] = useState(editing ? targetValue(editing) : "");
  const [busy, setBusy] = useState(false);
  const home = useHomeDir();
  const chosen = targets.some((x) => x.value === target) ? target : (targets[0]?.value ?? "");
  const parsed = bindingTarget(chosen, tool);
  const folder = typedFolder(dir, home);
  const problem = !folder.ok && dir.trim() ? folder.reason : null;
  const canSave = folder.ok && !!parsed && !!s.act.mapFolder && !busy;

  const write = async (path: string, to: NonNullable<typeof parsed>) => {
    await s.act.mapFolder!(path, to);
    if (!editing) return;
    const moved = path !== editing.match.value || tool !== editing.tool;
    if (!moved) return;
    await s.act.unmapFolder?.(editing.match.value, editing.tool === "any" ? undefined : editing.tool);
    if (!editing.enabled) await s.act.setBindingPaused?.(path, tool, true);
  };

  const save = () => {
    if (!canSave || !folder.ok || !parsed || !s.act.mapFolder) return;
    setBusy(true);
    write(folder.path, parsed)
      .then(() => {
        s.toast({
          text: editing
            ? t("tools.bindings.saved", { path: shortPath(folder.path) })
            : t("tools.bindings.bound", { path: shortPath(folder.path), tool: TOOL_LABEL[tool] }),
          tone: "ok",
        });
        onDone();
      })
      .catch((e: unknown) =>
        s.toast({ text: t(editing ? "tools.bindings.saveFailed" : "tools.bindings.addFailed", { error: e instanceof Error ? e.message : String(e) }), tone: "alert" }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Card className="mb-2 flex flex-col gap-3 p-4" aria-label={t(editing ? "tools.bindings.edit" : "tools.bindings.add")}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ac-muted">{t("tools.bindings.folder")}</span>
          <TextInput
            mono
            autoFocus
            aria-label={t("tools.bindings.folderToBind")}
            placeholder={t("tools.bindings.folderPlaceholder")}
            value={dir}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "add-binding-folder-error" : undefined}
            onChange={(e) => setDir(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              // First Escape clears what was typed; an empty field closes the form.
              if (e.key === "Escape") {
                if (dir) setDir("");
                else onDone();
              }
            }}
          />
          {problem && (
            <span id="add-binding-folder-error" role="alert" className="text-[11px] text-ac-alert-text">
              {problem}
            </span>
          )}
        </label>
        <Segmented label={t("tools.bindings.tool")} value={tool} onChange={setTool} options={BINDING_TOOLS.map((x) => ({ value: x, label: TOOL_LABEL[x] }))} />
        <div className="min-w-[200px]">
          <Select
            label={t("tools.bindings.startsOnLabel")}
            value={chosen}
            onChange={setTarget}
            disabled={targets.length === 0}
            options={targets.length ? targets : [{ value: "", label: t("tools.bindings.noTarget", { tool: TOOL_LABEL[tool] }), disabled: true }]}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ac-muted">{t("tools.bindings.formHint")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="primary" disabled={!canSave} onClick={save}>
            {t(editing ? "tools.bindings.save" : "tools.bindings.add")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Row ⋯ menu: edit the binding inline, or remove it (`agent-switch unmap <folder> --provider P`). */
function BindingMenu({ rule, onEdit }: { rule: Binding; onEdit: () => void }) {
  const s = useAS();
  const unmap = s.act.unmapFolder;
  if (!unmap && !s.act.mapFolder) return null;
  return (
    <RowMenu
      items={[
        { id: "edit", label: t("tools.bindings.edit"), icon: <Pencil />, disabled: !s.act.mapFolder, onSelect: onEdit },
        {
          id: "remove",
          label: t("tools.bindings.remove"),
          icon: <Trash2 />,
          danger: true,
          disabled: !unmap,
          onSelect: () =>
            s.open({
              kind: "confirm",
              title: t("tools.bindings.removeTitle"),
              body:
                rule.tool === "any"
                  ? t("tools.bindings.removeBody", { path: shortPath(rule.match.value) })
                  : t("tools.bindings.removeBodyTool", { path: shortPath(rule.match.value), tool: TOOL_LABEL[rule.tool] }),
              confirm: t("tools.bindings.remove"),
              danger: true,
              onConfirm: () => {
                unmap?.(rule.match.value, rule.tool === "any" ? undefined : rule.tool)?.catch((e: unknown) =>
                  s.toast({ text: t("tools.bindings.removeFailed", { error: e instanceof Error ? e.message : String(e) }), tone: "alert" }),
                );
              },
            }),
        },
      ]}
      trigger={
        <IconButton label={t("tools.bindings.menuFor", { path: rule.match.value })}>
          <MoreHorizontal />
        </IconButton>
      }
    />
  );
}

/** Accounts › Projects & pools. Bundle `VP`. */
export function ProjectsPools() {
  const s = useAS();
  const folders = recentFolders(s.sessions);
  const [picked, setPicked] = useState(folders[0] ?? "");
  const [typed, setTyped] = useState("");
  const home = useHomeDir();
  const typedDir = typedFolder(typed, home);
  const dir = typed.trim() ? (typedDir.ok ? typedDir.path : "") : picked;
  const [tool, setTool] = useState<Tool>("claude");
  const ex = useExplain(dir, tool);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const togglePaused = (r: Binding) => {
    if (r.tool === "any" || !s.act.setBindingPaused) return;
    s.act
      .setBindingPaused(r.match.value, r.tool, r.enabled)
      .catch((e: unknown) =>
        s.toast({ tone: "alert", text: t(r.enabled ? "tools.bindings.pauseFailed" : "tools.bindings.resumeFailed", { error: e instanceof Error ? e.message : String(e) }) }),
      );
  };
  const account = ex.state === "done" ? s.accountById(accountIdFromMember(ex.res.profile) ?? "") : undefined;
  const why = ex.state === "done" ? ex.res.why : ex.state === "error" ? [ex.message] : [];

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Select
              label={t("tools.bindings.tryFolder")}
              mono
              value={picked}
              onChange={(v) => {
                setPicked(v);
                setTyped("");
              }}
              options={folders.map((f) => ({ value: f, label: shortPath(f) }))}
            />
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <label className="ac-caps" htmlFor="try-folder">
              {t("tools.bindings.typeFolder")}
            </label>
            <TextInput id="try-folder" mono className="h-9" placeholder={t("tools.bindings.typePlaceholder")} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <Segmented
            label={t("tools.bindings.toolLabel")}
            value={tool}
            onChange={setTool}
            options={[
              { value: "claude", label: "Claude" },
              { value: "codex", label: "Codex" },
              { value: "gemini", label: "Gemini", disabled: true, why: t("tools.bindings.geminiNoBackend") },
            ]}
          />
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-ac-line bg-ac-bg p-3">
          {account ? <AccountDot color={account.color} size={10} /> : <span className="size-2.5 rounded-full border border-ac-line2" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ac-text">
              {account ? (
                tx("tools.bindings.startsOn", {
                  who: (
                    <b className="font-medium">
                      {TOOL_LABEL[account.tool]} · {account.name}
                    </b>
                  ),
                })
              ) : !dir ? (
                t("tools.bindings.noFolder")
              ) : ex.state === "loading" || ex.state === "idle" ? (
                t("tools.bindings.checking")
              ) : ex.state === "done" && ex.res.profile == null ? (
                t("tools.bindings.original", { tool: TOOL_LABEL[tool] })
              ) : (
                t("tools.bindings.noAccount")
              )}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {why.map((w) => (
                <li key={w} className="text-[11px] text-ac-muted">
                  · {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <section className="flex flex-col gap-1">
        <SectionHeader
          title={t("tools.bindings.title")}
          count={s.rules.length}
          actions={
            <Button
              size="sm"
              variant="ghost"
              disabled={!s.act.mapFolder || adding}
              title={s.act.mapFolder ? undefined : t("tools.bindings.unavailable")}
              onClick={() => setAdding(true)}
            >
              <Plus /> {t("tools.bindings.add")}
            </Button>
          }
        />
        <p className="px-1 pb-2 text-xs text-ac-muted">
          {t("tools.bindings.explain")}
        </p>
        {adding && <BindingForm initialDir={dir} onDone={() => setAdding(false)} />}
        <Card className="p-1">
          <RowList>
            {s.rules.map((r) => {
              const a = r.target.kind === "account" ? s.accountById(r.target.accountId) : undefined;
              if (editing === r.id) return <BindingForm key={r.id} initialDir={dir} editing={r} onDone={() => setEditing(null)} />;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-2.5 md:grid-cols-[72px_minmax(0,1fr)_minmax(150px,210px)_64px_auto]",
                    !r.enabled && "opacity-60",
                  )}
                >
                  <span className="hidden md:block">
                    <Badge>{r.match.kind}</Badge>
                  </span>
                  <span className="min-w-0 truncate font-ac-mono text-xs text-ac-text">{r.match.value}</span>
                  <span className="col-span-2 flex min-w-0 items-center gap-2 text-xs text-ac-soft md:col-span-1">
                    →{" "}
                    {a ? (
                      <>
                        <AccountDot color={a.color} size={8} /> {TOOL_LABEL[a.tool]} · {a.name}
                      </>
                    ) : (
                      <>
                        {t("tools.bindings.poolRow", {
                          name: r.target.kind === "pool" ? (s.pools.find((p) => p.id === (r.target as { pool: string }).pool)?.label ?? r.target.pool) : "",
                        })}
                      </>
                    )}
                    {r.tool !== "any" && <span className="text-ac-faint">{t("tools.bindings.toolOnly", { tool: TOOL_LABEL[r.tool] })}</span>}
                  </span>
                  <span className="hidden text-right font-ac-mono text-[11px] text-ac-faint md:block" title={t("tools.bindings.hitsTitle")}>
                    {r.hits == null ? "—" : `${r.hits}×`}
                  </span>
                  <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-auto md:row-start-auto">
                    <span title={t(r.enabled ? "tools.bindings.onTitle" : "tools.bindings.pausedTitle")}>
                      <Switch
                        label={t("tools.bindings.switchLabel", { path: r.match.value })}
                        checked={r.enabled}
                        disabled={!s.act.setBindingPaused || r.tool === "any"}
                        onChange={() => togglePaused(r)}
                      />
                    </span>
                    <BindingMenu rule={r} onEdit={() => setEditing(r.id)} />
                  </span>
                </div>
              );
            })}
          </RowList>
        </Card>
      </section>

      <PoolsSection />
    </div>
  );
}
