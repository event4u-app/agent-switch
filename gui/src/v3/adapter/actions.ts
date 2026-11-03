/** `V3Action` → the CLI call or 2.11 flow that does what its label says. The
 *  switch is exhaustive: a new action variant does not compile until it is
 *  mapped here. Controls with nothing behind them are hidden by the adapter
 *  (`menuFor`, `commitAvailable`), so they never reach this function. */

import type { SessionRow } from "../../transforms.js";
import { accountId, accountIdFromMember } from "../../vm/build.js";
import { splitAccountId, type Actions } from "../../vm/actions.js";
import { sessionArgs } from "../../ipc.js";
import type { Overlay, Toast } from "../../vm/store.js";
import type { ProviderId } from "../../transforms.js";
import type { NeedItem } from "../needs.js";
import type { Appearance } from "../themes/resolve.js";
import type { SessionMenuItem, V3Action } from "../window.js";
import { menuFor, NEW_CHAT, nextStep, sessionKey } from "./data.js";
import { parsePr } from "./feeds.js";

/** The CLI calls the dispatcher makes (a subset of `ipc.ts`, injectable for tests). */
export interface DispatchIpc {
  focusSessionTerminal(key: string): Promise<void>;
  needsLater(id: string): Promise<void>;
  hostStart(provider: ProviderId, cwd: string, profile?: string): Promise<void>;
  hostEnd(key: string): Promise<void>;
  hostRespawn(key: string, change: { model?: string; effort?: string }): Promise<void>;
  setLibraryFlag(key: string, flag: "pin" | "archive", on: boolean): Promise<void>;
  setAutoKeep(on: boolean): Promise<void>;
  setOpenDefault(target: string, repo?: string): Promise<void>;
  setAgentEnabled(id: string, on: boolean): Promise<void>;
  setRemoteControl(account: string, on: boolean): Promise<void>;
  setRemoteSsh(on: boolean): Promise<void>;
  cleanupMerged(): Promise<void>;
  engineRestart(): Promise<void>;
  renameSession(key: string, name: string): Promise<void>;
  openSessionIn(key: string, target?: string): Promise<void>;
  openApp(appId: string, name: string): Promise<void>;
}

export interface DispatchDeps {
  ipc: DispatchIpc;
  act: Actions;
  open: (o: Overlay) => void;
  toast: (t: Omit<Toast, "id">) => void;
  openUrl: (url: string) => void;
  /** Re-read the v3 feeds and the view model after a change. */
  refresh: () => void;
  rows: () => ReadonlyMap<string, SessionRow>;
  needs: () => readonly NeedItem[];
  hosted: (key: string) => boolean;
  setAppearance: (a: Appearance) => void;
  setFocusTerminal: (on: boolean) => void;
  /** One line of text (rename). */
  prompt: (req: { title: string; initial: string; onSubmit: (v: string) => void }) => void;
  /** Start a new session in the chat view and open its tab. */
  newChat?: () => void;
  /** Open a session's tab (its chat, where an approval waits). */
  openTab?: (key: string) => void;
  /** The session runs in this window's chat: model changes go through its bridge. */
  chatOf?: (key: string) => { setModel: (m: string) => void } | null;
  /** The session bar's [Terminal | Chat] switch. */
  switchView?: (key: string, to: "terminal" | "chat") => void;
}

/** Claude's `--model` aliases. */

const vmSessionId = (key: string) => {
  const [provider, , id] = key.split("/");
  return `${provider}:${id}`;
};

/** `git@github.com:o/r.git` / `https://github.com/o/r` → `o/r`. */
export function githubSlug(remote: string | null | undefined): string | null {
  const m = remote ? /github\.com[:/]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(remote) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

function prUrl(row: SessionRow | undefined): string | null {
  const pr = row ? (row.prs ?? []).map(parsePr).find((p) => p !== null) : null;
  return pr?.url || null;
}

async function run(deps: DispatchDeps, what: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
    deps.refresh();
  } catch (e) {
    deps.toast({ tone: "alert", text: `${what} failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function blocker(key: string, deps: DispatchDeps): Promise<void> | void {
  const row = deps.rows().get(key);
  if (!row) return;
  const n = nextStep(row, deps.needs().some((x) => x.subject === key));
  if (!n) return;
  if (n.does === "focus") return run(deps, "Focus", deps.ipc.focusSessionTerminal(key));
  if (n.does === "create-pr") return createPr(row, deps);
  const url = prUrl(row);
  if (url) deps.openUrl(n.does === "open-checks" ? `${url}/checks` : url);
}

function createPr(row: SessionRow | undefined, deps: DispatchDeps): void {
  const slug = githubSlug(row?.git?.remote);
  const branch = row?.git?.branch;
  if (!slug || !branch) return void deps.toast({ tone: "warn", text: "This session's branch is not on GitHub" });
  deps.openUrl(`https://github.com/${slug}/compare/${encodeURIComponent(branch)}?expand=1`);
}

function onNeed(n: NeedItem, deps: DispatchDeps): Promise<void> | void {
  // A chat's approval or question is answered in the chat (spec §13.5: one decision).
  if (n.verb === "Open chat" && deps.openTab) return deps.openTab(n.subject);
  if (n.kind === "approval" || n.kind === "question") return run(deps, "Focus", deps.ipc.focusSessionTerminal(n.subject));
  if (n.kind === "ci") {
    const url = prUrl(deps.rows().get(n.subject));
    if (url) return deps.openUrl(`${url}/checks`);
    return;
  }
  if (n.kind === "signin") {
    const id = accountIdFromMember(n.subject);
    if (id) deps.open({ kind: "reauth", accountId: id });
  }
}

function sessionMenu(key: string, item: SessionMenuItem, deps: DispatchDeps): Promise<void> | void {
  const row = deps.rows().get(key);
  switch (item) {
    case "Rename…":
      return deps.prompt({ title: "Rename session", initial: row?.library?.name ?? row?.summary ?? "", onSubmit: (v) => void run(deps, "Rename", deps.ipc.renameSession(key, v)) });
    case "Pin":
      return run(deps, "Pin", deps.ipc.setLibraryFlag(key, "pin", true));
    case "Move to another account…":
    case "Take over here…":
    case "Hand off…":
      return deps.open({ kind: "session", id: vmSessionId(key) });
    case "Compact":
      return deps.open({ kind: "terminal", run: { args: ["compact", key], title: "Compact" } });
    case "Detach":
      return;
    case "End…":
      return deps.open({
        kind: "confirm",
        title: "End this session?",
        body: "The program in it stops. Its transcript stays.",
        confirm: "End session",
        danger: true,
        onConfirm: () => void run(deps, "End", deps.ipc.hostEnd(key)),
      });
  }
}

export function dispatchV3(a: V3Action, deps: DispatchDeps): Promise<void> | void {
  switch (a.type) {
    case "need":
      return onNeed(a.item, deps);
    case "need-more":
    case "away":
      return deps.refresh();
    case "need-later":
      return run(deps, "Later", deps.ipc.needsLater(a.id));
    case "needs-later-all":
      return run(deps, "Later", Promise.all(deps.needs().map((n) => deps.ipc.needsLater(n.id))));
    case "start": {
      const p = a.plan;
      if (p.where === "hosted") return run(deps, "Start", deps.ipc.hostStart(p.tool, p.folder));
      return deps.open({ kind: "start", cwd: p.folder, tool: p.tool });
    }
    case "choose-account":
      return deps.open({ kind: "start" });
    case "move":
      return run(
        deps,
        "Move",
        Promise.all(
          a.moves.map(({ key, target }) => {
            const [provider] = key.split("/");
            const to = accountId(provider, target);
            if (a.how === "now") return deps.act.rebind?.(vmSessionId(key), to);
            if (a.how === "after-turn") return deps.act.armRebind?.(vmSessionId(key), to);
            return deps.open({ kind: "session", id: vmSessionId(key) });
          }),
        ),
      );
    case "keep-account": {
      const limits = deps.needs().filter((n) => n.kind === "limit" && n.subject.split("/")[1] === a.account);
      return run(deps, "Keep", Promise.all(limits.map((n) => deps.ipc.needsLater(n.id))));
    }
    case "session-menu":
      return sessionMenu(a.key, a.item, deps);
    case "batch": {
      if (a.op === "onPin") return run(deps, "Pin", Promise.all(a.keys.map((k) => deps.ipc.setLibraryFlag(k, "pin", true))));
      if (a.op === "onArchive") return run(deps, "Archive", Promise.all(a.keys.map((k) => deps.ipc.setLibraryFlag(k, "archive", true))));
      if (a.op === "onClean") return run(deps, "Clean up", deps.ipc.cleanupMerged());
      if (a.op === "onEnd") {
        const keys = a.keys.filter(deps.hosted);
        if (!keys.length) return deps.toast({ tone: "info", text: "Only sessions hosted in Agent Switch can be ended here" });
        return deps.open({ kind: "confirm", title: `End ${keys.length} session${keys.length === 1 ? "" : "s"}?`, body: "The programs stop. Transcripts stay.", confirm: "End", danger: true, onConfirm: () => void run(deps, "End", Promise.all(keys.map((k) => deps.ipc.hostEnd(k)))) });
      }
      return;
    }
    case "clean-up":
      return deps.open({ kind: "confirm", title: "Clean up merged worktrees?", body: "Removes the worktrees of sessions whose PR is merged. A worktree with changes is skipped.", confirm: "Clean up", onConfirm: () => void run(deps, "Clean up", deps.ipc.cleanupMerged()) });
    case "view":
      return deps.switchView?.(a.key, a.view);
    case "open-in": {
      const p = a.pick;
      if (p.kind === "pr") return deps.openUrl(p.url);
      if (p.kind === "focus") return run(deps, "Focus", deps.ipc.focusSessionTerminal(a.key));
      // The app opens on the session's own account; it never resumes the conversation (spike S9).
      if (p.kind === "app") return run(deps, "Open", deps.ipc.openApp(p.app, a.key.split("/")[1] ?? ""));
      if (p.kind === "target") return run(deps, "Open", deps.ipc.openSessionIn(a.key, p.target));
      return run(deps, "Open", deps.ipc.openSessionIn(a.key));
    }
    case "set-model": {
      const chat = deps.chatOf?.(a.key);
      if (chat) return chat.setModel(a.model);
      if (!deps.hosted(a.key)) return;
      return run(deps, "Model change", deps.ipc.hostRespawn(a.key, { model: a.model }));
    }
    case "set-thinking": {
      if (deps.chatOf?.(a.key)) return deps.toast({ tone: "info", text: "Thinking is set when the chat starts; switch to the terminal view to change it" });
      if (!deps.hosted(a.key)) return;
      return run(deps, "Thinking change", deps.ipc.hostRespawn(a.key, { effort: a.level }));
    }
    case "blocker":
      return blocker(a.key, deps);
    case "create-pr":
      return createPr(deps.rows().get(a.key), deps);
    case "open-pr": {
      const url = prUrl(deps.rows().get(a.key));
      return url ? deps.openUrl(url) : undefined;
    }
    case "review":
    case "commit":
      // Hidden or disabled in the window until v3.1 (no review or commit flow yet).
      return;
    case "account":
      if (a.op === "add") return deps.open({ kind: "add-account" });
      if (a.op === "refresh") return run(deps, "Refresh", deps.act.refreshUsage?.() ?? Promise.resolve());
      if (!a.key) return;
      if (a.op === "use") return run(deps, "Use", deps.act.setDefault?.(a.key) ?? Promise.resolve());
      if (a.op === "sign-in") return deps.open({ kind: "reauth", accountId: a.key });
      if (a.op === "terminal") {
        const [tool, name] = splitAccountId(a.key);
        return deps.open({ kind: "terminal", run: { args: sessionArgs(tool, name), title: name } });
      }
      return deps.open({ kind: "account", id: a.key });
    case "library":
      if (a.op === "auto-keep") return run(deps, "Auto-keep", deps.ipc.setAutoKeep(a.value));
      if (a.op === "resume") return deps.open({ kind: "terminal", run: { args: ["sessions", "resume", a.key, "--yes"], title: "Resume" } });
      return run(deps, a.op === "pin" ? "Pin" : "Archive", deps.ipc.setLibraryFlag(a.key, a.op, a.value));
    case "palette":
      if (a.entry.id === NEW_CHAT) return deps.newChat?.();
      return;
    case "appearance":
      return deps.setAppearance(a.value);
    case "open-default":
      return run(deps, "Default editor", deps.ipc.setOpenDefault(a.target, a.repo));
    case "focus-terminal-setting":
      return deps.setFocusTerminal(a.value);
    case "agent-enabled":
      return run(deps, a.value ? "Agent on" : "Agent off", deps.ipc.setAgentEnabled(a.id, a.value));
    case "remote-rc":
      return run(deps, "Remote Control", deps.ipc.setRemoteControl(a.account, a.value));
    case "remote-ssh":
      return run(deps, "Remote over SSH", deps.ipc.setRemoteSsh(a.value));
    case "agent-install":
      return deps.open({ kind: "terminal", run: { args: ["agents", "install", a.id], title: `Install ${a.id}` } });
    case "restart-engine":
      return run(deps, "Engine restart", deps.ipc.engineRestart());
    default: {
      const never: never = a;
      return never;
    }
  }
}

export { menuFor, sessionKey };
