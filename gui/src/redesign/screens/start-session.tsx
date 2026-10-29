import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { sessionArgs, type DirResolution } from "../../ipc.js";
import { expandHome, typedFolder, useHomeDir } from "../../lib/paths.js";
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
import {
  appFor,
  appUnavailableReason,
  AUTO,
  canStartOn,
  recentFolders,
  resolutionFromCli,
  resolveStart,
  START_TOOLS,
  toolCanTakeWork,
  type Resolution,
} from "./logic.js";

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
  const dir = folder.trim();
  if (dir && !isAbsoluteFolder(dir)) return null;
  return { kind: "terminal" as const, args: sessionArgs(tool as ProviderId, account.name, dir || undefined) };
}

/** POSIX `/…`, Windows `C:\\…` / `C:/…` and UNC `\\\\server\\…`. The CLI checks
 *  the folder exists, which only an absolute path can pass. */
export function isAbsoluteFolder(dir: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(dir);
}

/** Why Start is off, in words; null when it can start (or another rule already
 *  explains it, e.g. the desktop app being unavailable). */
export function startProblem(account: Account | null, tool: Tool, openIn: OpenIn, folder: string): string | null {
  if (tool === "gemini") return null;
  if (!account) return `No ${TOOL_LABEL[tool]} account to start on.`;
  if (account.disabled) return `${account.name} is disabled — turn it back on first (Accounts → ${account.name} → ⋯ → Turn back on).`;
  if (account.state === "signed-out") return `${account.name} is signed out — sign in again first (Accounts → ${account.name} → Sign in again).`;
  if (account.state === "limited") return `${account.name} is at its limit — pick another account.`;
  if (account.state === "wrong-account") return `${account.name} is signed in to a different account than expected.`;
  const dir = folder.trim();
  if (openIn === "terminal" && dir && !isAbsoluteFolder(dir)) return `“${dir}” is not a full folder path — choose another folder.`;
  return null;
}

/** The preview line: `<folder> $ claude` for a terminal start (the built-in
 *  terminal's home when no folder is chosen), the open command for an app. */
export function startPreview(tool: Tool, openIn: OpenIn, folder: string, appId: string | null, accountName: string | null) {
  if (openIn === "desktop-app") return { prompt: "~", command: `agent-switch open ${appId ?? "?"} ${accountName ?? "?"}` };
  return { prompt: folder.trim() ? shortPath(folder.trim()) : TERMINAL_HOME, command: tool };
}

type CliAnswer = { key: string; state: "loading" } | { key: string; state: "done"; res: DirResolution } | { key: string; state: "error"; message: string };

/** Automatic as the CLI resolves it (`dir --json` in the start folder — the
 *  built-in terminal's home when none is chosen). null = can't ask (no backend,
 *  Gemini, home unknown for a `~` path): the local guess stands in. */
function useCliResolution(folder: string, tool: Tool, home: string | null): CliAnswer | null {
  const s = useAS();
  const explain = s.act.explainFolder;
  const dir = expandHome(folder.trim() || TERMINAL_HOME, home);
  const askable = !!explain && tool !== "gemini" && dir.startsWith("/");
  const key = `${tool}\u0000${dir}`;
  const [answer, setAnswer] = useState<CliAnswer | null>(null);
  useEffect(() => {
    if (!askable || !explain) return;
    let alive = true;
    setAnswer({ key, state: "loading" });
    explain(dir, tool).then(
      (res) => alive && setAnswer({ key, state: "done", res }),
      (e: unknown) => alive && setAnswer({ key, state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [askable, explain, dir, tool, key]);
  if (!askable) return null;
  return answer?.key === key ? answer : { key, state: "loading" };
}

/** Bundle `gR`, dialog 580. Automatic is the CLI's own answer (`dir --json`):
 *  the account it resolves and why. The local rule match is only the offline
 *  fallback (no backend, or the CLI didn't answer). */
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
  const [typedError, setTypedError] = useState<string | null>(null);
  const home = useHomeDir();

  useEffect(() => {
    if (lastTool.current !== tool) {
      lastTool.current = tool;
      setPick(AUTO);
    }
  }, [tool]);

  const cli = useCliResolution(folder, tool, home);
  const local = resolveStart(folder, tool, s.rules, s.accounts, s.pools, { home });
  const resolving = cli?.state === "loading";
  const resolution: Resolution =
    cli?.state === "done"
      ? resolutionFromCli(cli.res, tool, s.accounts)
      : cli?.state === "error"
        ? { ...local, why: [...local.why, `agent-switch didn't answer (${cli.message}) — this is the window's own guess`] }
        : resolving
          ? { account: null, rule: null, why: ["Asking agent-switch which account this folder starts on …"] }
          : local;
  const ranked = rankAccounts(s.accounts, tool, s.now);
  const account = pick === AUTO ? resolution.account : (s.accountById(pick) ?? null);
  const appWhy = appUnavailableReason(s, tool);
  const effectiveOpenIn: OpenIn = appWhy ? "terminal" : openIn;
  const plan = startPlan(account, tool, effectiveOpenIn, appFor(s, tool), expandHome(folder.trim(), home));
  const folders = Array.from(new Set([...(cwd ? [cwd] : []), ...recent]));
  const preview = startPreview(tool, effectiveOpenIn, folder, appFor(s, tool), account?.name ?? null);
  const why = pick === AUTO ? resolution.why : [`Picked by you: ${account?.name ?? "?"}`];
  const problem = resolving ? null : startProblem(account, tool, effectiveOpenIn, expandHome(folder.trim(), home));

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
              aria-invalid={typedError ? true : undefined}
              aria-describedby={typedError ? "start-folder-error" : undefined}
              onChange={(e) => {
                setTyped(e.target.value);
                setTypedError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && typed.trim()) {
                  const t = typedFolder(typed, home);
                  if (!t.ok) {
                    setTypedError(t.reason);
                    return;
                  }
                  setFolder(t.path);
                  setTyping(false);
                }
                // The dialog stays open (Overlay leaves Escape to text fields).
                if (e.key === "Escape") {
                  if (typed) setTyped("");
                  else setTyping(false);
                  setTypedError(null);
                }
              }}
            />
          )}
          {typing && typedError && (
            <p id="start-folder-error" role="alert" className="text-[11px] text-ac-alert-text">
              {typedError}
            </p>
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
              label: `Automatic → ${resolving ? "…" : resolution.account ? resolution.account.name : "none"}`,
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
            {problem && (
              <li role="alert" className="text-[11px] text-ac-alert-text">
                · {problem}
              </li>
            )}
            {folder && effectiveOpenIn === "desktop-app" && (
              <li className="text-[11px] text-ac-muted">· The {TOOL_LABEL[tool]} app opens without a folder.</li>
            )}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
