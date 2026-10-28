import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { sessionArgs } from "../../ipc.js";
import type { ProviderId } from "../../transforms.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Button } from "../../ui/Button.js";
import { Dialog } from "../../ui/Overlay.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { TextInput } from "../../ui/TextInput.js";
import { Caps } from "../../ui/Typography.js";
import { shortPath } from "../../ui/format.js";
import { rankAccounts, TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Account, Tool } from "../../vm/types.js";
import { appFor, appUnavailableReason, AUTO, canStartOn, recentFolders, resolveStart, START_TOOLS, toolCanTakeWork } from "./logic.js";

const PICK = "__pick";
/** The built-in terminal's pty starts here (src-tauri pty.rs); a start with a
 *  folder runs there via `--cwd` instead. */
export const TERMINAL_HOME = "~/.agent-switch";

type OpenIn = "terminal" | "desktop-app";

/** What the Start button runs; null when it can't start. A terminal start runs
 *  in `folder` (`agent-switch run … --cwd`); the desktop apps take no folder. */
export function startPlan(account: Account | null, tool: Tool, openIn: OpenIn, appId: string | null, folder = "") {
  if (!canStartOn(account) || !account || tool === "gemini") return null;
  if (openIn === "desktop-app") return appId ? { kind: "app" as const, appId, accountId: account.id } : null;
  return { kind: "terminal" as const, args: sessionArgs(tool as ProviderId, account.name, folder.trim() || undefined) };
}

/** The preview line: `<folder> $ claude` for a terminal start (the built-in
 *  terminal's home when no folder is chosen), the open command for an app. */
export function startPreview(tool: Tool, openIn: OpenIn, folder: string, appId: string | null, accountName: string | null) {
  if (openIn === "desktop-app") return { prompt: "~", command: `agent-switch open ${appId ?? "?"} ${accountName ?? "?"}` };
  return { prompt: folder.trim() ? shortPath(folder.trim()) : TERMINAL_HOME, command: tool };
}

/** Bundle `gR`, dialog 580. */
export function StartSessionDialog({ cwd, tool: initialTool, accountId }: { cwd?: string; tool?: string; accountId?: string }) {
  const s = useAS();
  const recent = recentFolders(s.sessions);
  const [folder, setFolder] = useState(cwd ?? recent[0] ?? "");
  const [tool, setTool] = useState<Tool>((START_TOOLS as string[]).includes(initialTool ?? "") ? (initialTool as Tool) : "claude");
  const [pick, setPick] = useState(accountId ?? AUTO);
  const lastTool = useRef(tool);
  const [openIn, setOpenIn] = useState<OpenIn>("terminal");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (lastTool.current !== tool) {
      lastTool.current = tool;
      setPick(AUTO);
    }
  }, [tool]);

  const resolution = resolveStart(folder, tool, s.rules, s.accounts, s.pools);
  const ranked = rankAccounts(s.accounts, tool, s.now);
  const account = pick === AUTO ? resolution.account : (s.accountById(pick) ?? null);
  const appWhy = appUnavailableReason(s, tool);
  const effectiveOpenIn: OpenIn = appWhy ? "terminal" : openIn;
  const plan = startPlan(account, tool, effectiveOpenIn, appFor(s, tool), folder);
  const folders = Array.from(new Set([...(cwd ? [cwd] : []), ...recent]));
  const preview = startPreview(tool, effectiveOpenIn, folder, appFor(s, tool), account?.name ?? null);
  const why = pick === AUTO ? resolution.why : [`Picked by you: ${account?.name ?? "?"}`];

  const start = () => {
    if (!plan || !account) return;
    if (plan.kind === "app") {
      s.close();
      s.act
        .openApp?.(plan.appId, plan.accountId)
        .then(() => s.toast({ text: `${TOOL_LABEL[tool]} app opened as ${account.name}.` }))
        .catch((e) => s.toast({ text: `Couldn't open the ${TOOL_LABEL[tool]} app: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" }));
    } else {
      s.open({ kind: "terminal", run: { kicker: "Start session", title: `${TOOL_LABEL[tool]} · ${account.name}`, args: plan.args } });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && s.close()}
      kicker="Start session"
      title="Where and with what?"
      width={580}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => s.close()}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!plan || (plan.kind === "app" && !s.act.openApp)} onClick={start}>
            <Play /> Start {TOOL_LABEL[tool]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Select
            label="Folder"
            mono
            value={typing ? PICK : folder}
            onChange={(v) => {
              if (v === PICK) setTyping(true);
              else {
                setTyping(false);
                setFolder(v);
              }
            }}
            options={[...folders.map((f) => ({ value: f, label: shortPath(f) })), { value: PICK, label: "Choose another folder …" }]}
          />
          {typing && (
            <TextInput
              mono
              autoFocus
              aria-label="Folder path"
              placeholder="/full/path/to/project"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && typed.trim()) {
                  setFolder(typed.trim());
                  setTyping(false);
                }
                if (e.key === "Escape") setTyping(false);
              }}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Caps>Tool</Caps>
          <Segmented
            label="Tool"
            fill
            value={tool}
            onChange={setTool}
            options={START_TOOLS.map((t) => ({
              value: t,
              label: TOOL_LABEL[t],
              disabled: !toolCanTakeWork(s.accounts, t),
              why: `No ${TOOL_LABEL[t]} account can take work`,
            }))}
          />
        </div>
        <Select
          label="Account"
          value={pick}
          onChange={setPick}
          options={[
            {
              value: AUTO,
              label: `Automatic → ${resolution.account ? resolution.account.name : "none"}`,
              hint: resolution.why[resolution.why.length - 1],
              dot: resolution.account ? <AccountDot color={resolution.account.color} size={8} /> : undefined,
            },
            ...ranked.map((r) => ({
              value: r.account.id,
              label: r.account.name,
              hint: r.reason,
              disabled: r.rank == null,
              dot: <AccountDot color={r.account.color} size={8} />,
            })),
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <Caps>Open in</Caps>
          <Segmented
            label="Open in"
            value={effectiveOpenIn}
            onChange={setOpenIn}
            options={[
              { value: "terminal", label: "Terminal" },
              { value: "desktop-app", label: `${TOOL_LABEL[tool]} app`, disabled: !!appWhy, why: appWhy ?? undefined },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-ac-line bg-ac-bg p-3">
          <span className="font-ac-mono text-xs text-ac-text" title={plan?.kind === "terminal" ? `agent-switch ${plan.args.join(" ")}` : undefined}>
            <span className="text-ac-faint">{preview.prompt} $ </span>
            {preview.command}
          </span>
          <ul className="flex flex-col gap-1">
            {why.map((w) => (
              <li key={w} className="text-[11px] text-ac-muted">
                · {w}
              </li>
            ))}
            {folder && effectiveOpenIn === "desktop-app" && (
              <li className="text-[11px] text-ac-muted">· The {TOOL_LABEL[tool]} app opens without a folder.</li>
            )}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
