/** `V3Action` → the CLI call or 2.11 flow that does what its label says. The
 *  switch is exhaustive: a new action variant does not compile until it is
 *  mapped here. Controls with nothing behind them are hidden by the adapter
 *  (`menuFor`, `commitAvailable`), so they never reach this function. */
import type { SessionRow } from "../../transforms.js";
import { accountId, accountIdFromMember, sessionFromRow } from "../../vm/build.js";
import { splitAccountId, type Actions } from "../../vm/actions.js";
import { createElement } from "react";
import { sessionArgs, type PrConfirmJson, type PrPlanJson, type StartChoice, type SwitchRequestRow } from "../../ipc.js";
import { requestKind, requestsForMoves } from "../../vm/switch-requests.js";
import type { Overlay, TerminalRun, Toast } from "../../vm/store.js";
import type { ProviderId } from "../../transforms.js";
import { answeredThere, type NeedItem } from "../needs.js";
import type { Appearance } from "../themes/resolve.js";
import type { SessionMenuItem, V3Action } from "../window.js";
import type { MoveHow, NewSessionPlan, SheetMove } from "../dialogs.js";
import { canFocus, ciPrompt, ciSession, CODEX_RESPAWN_WHY, conflictPrompt, menuFor, NEW_CHAT, nextStep, sessionKey, startChoice } from "./data.js";
import { parsePr } from "./feeds.js";
import { PrConfirm, type PrConfirmState } from "./PrConfirm.js";
/** The CLI calls the dispatcher makes (a subset of `ipc.ts`, injectable for tests). */
export interface DispatchIpc {
  focusSessionTerminal(key: string): Promise<void>;
  /** Joins a hosted session from a new window of the user's terminal app. */
  hostAttachInTerminal(key: string): Promise<void>;
  needsLater(id: string): Promise<void>;
  needsSeen(): Promise<void>;
  /** Allow once or deny an approval through the inbox of the chat that holds it. */
  needsAnswer(key: string, approvalId: string, decision: "allow" | "deny"): Promise<void>;
  hostStart(provider: ProviderId, cwd: string, profile?: string, choice?: StartChoice): Promise<void>;
  /** Starts a session in a new window of the user's terminal (`run … --new-window`). */
  startInTerminal(provider: ProviderId, cwd: string, profile?: string, choice?: StartChoice): Promise<void>;
  hostEnd(key: string): Promise<void>;
  hostRespawn(key: string, change: { model?: string; effort?: string }): Promise<void>;
  setLibraryFlag(key: string, flag: "pin" | "archive", on: boolean): Promise<void>;
  setAutoKeep(on: boolean): Promise<void>;
  setOpenDefault(target: string, repo?: string): Promise<void>;
  setOpenTerminal(id: string): Promise<void>;
  setAgentEnabled(id: string, on: boolean): Promise<void>;
  setRemoteControl(account: string, on: boolean): Promise<void>;
  setRemoteSsh(on: boolean): Promise<void>;
  /** Removes merged worktrees: only those of `keys` when given. */
  cleanupMerged(keys?: string[]): Promise<void>;
  /** What Create PR would do (commit, destination ref, base, title), or why it cannot; for `base` when given. */
  prCreatePlan(key: string, base?: string): Promise<PrPlanJson>;
  /** Pushes what was confirmed and creates the PR (refused when it changed since); the PR's URL. */
  prCreate(key: string, confirmed: PrConfirmJson): Promise<string>;
  engineRestart(): Promise<void>;
  renameSession(key: string, name: string): Promise<void>;
  openSessionIn(key: string, target?: string): Promise<void>;
  openApp(appId: string, name: string): Promise<void>;
  /** Types the continuation, or `text`, into a session Agent Switch hosts. */
  continueSession(key: string, text?: string): Promise<void>;
  takeoverHosted(key: string, target: string): Promise<void>;
  /** Records the answer to a switch request: carried out by the app (`executed`),
   *  or left to the background service (no `executed`). */
  decideSwitchRequest?(id: string, verdict: "approve" | "snooze", opts?: { to: string; how: "after-turn" | "now"; executed?: string }): Promise<boolean | void>;
}
export interface DispatchDeps {
  ipc: DispatchIpc;
  act: Actions;
  open: (o: Overlay) => void;
  toast: (t: Omit<Toast, "id">) => void;
  openUrl: (url: string) => void;
  /** Re-read the v3 feeds and the view model after a change. */
  refresh: () => void;
  /** Bring the window forward (a limit opened its decision sheet). */
  reveal?: () => void;
  rows: () => ReadonlyMap<string, SessionRow>;
  needs: () => readonly NeedItem[];
  /** The switch requests shared with agent-config; a move answers them. */
  requests?: () => readonly SwitchRequestRow[];
  /** Who carries out a move answered here (`agent-switch link executor`); read
   *  when the user answers. Absent or unreadable → the app. */
  executor?: () => Promise<"app" | "service">;
  /** The background service (the engine) is stopped: nothing is handed to it. */
  serviceDown?: () => boolean;
  hosted: (key: string) => boolean;
  setAppearance: (a: Appearance) => void;
  setFocusTerminal: (on: boolean) => void;
  /** The Open in › Focus terminal switch: off, nothing brings a terminal to the front. Absent: on. */
  focusTerminal?: () => boolean;
  /** One line of text (rename). */
  prompt: (req: { title: string; initial: string; onSubmit: (v: string) => void }) => void;
  /** The New-session dialog's plan as it is now (null: the dialog closed), so its facts follow it. */
  draftStart?: (plan: NewSessionPlan | null) => void;
  /** Start a new session in the chat view and open its tab. */
  newChat?: () => void;
  /** Open a session's tab (its chat, where an approval waits). */
  openTab?: (key: string) => void;
  /** The session runs in this window's chat: model changes go through its bridge. */
  chatOf?: (key: string) => { setModel: (m: string) => void; send?: (text: string) => void; approve?: (id: string, always: boolean) => void; deny?: (id: string) => void } | null;
  /** The session bar's [Terminal | Chat] switch. */
  switchView?: (key: string, to: "terminal" | "chat") => void;
  /** Puts a prompt on the clipboard, for a session the app cannot type into. */
  copyText?: (text: string) => Promise<void>;
  /** Keep a New session choice as its folder's prefill. */
  rememberStart?: (plan: NewSessionPlan) => void;
  /** Open the take-over dialog for a session in the user's own terminal. */
  takeOver?: (key: string) => void;
}
/** Claude's `--model` aliases. */
const vmSessionId = (key: string) => {
  const [provider, , id] = key.split("/");
  return `${provider}:${id}`;
};
/** The 2.11 session sheet for a session. Its list holds Claude sessions only,
 *  so the row comes along and a Codex session opens too. */
function sessionSheet(key: string, deps: DispatchDeps, how?: "handoff"): Overlay {
  const row = deps.rows().get(key);
  return { kind: "session", id: vmSessionId(key), ...(row ? { session: sessionFromRow(row, Date.now()) } : {}), ...(how ? { how } : {}) };
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
/** Types `text` into the session where the app can: its chat in this window, or
 *  the window it hosts. False where it cannot, so the caller says where to go. */
function sendPrompt(key: string, text: string, deps: DispatchDeps): Promise<void> | false {
  const chat = deps.chatOf?.(key);
  if (chat?.send) return Promise.resolve(chat.send(text));
  if (deps.hosted(key)) return run(deps, "Send", deps.ipc.continueSession(key, text));
  return false;
}
async function copyPrompt(text: string, deps: DispatchDeps): Promise<void> {
  const copy = deps.copyText ?? ((t: string) => navigator.clipboard.writeText(t));
  try {
    await copy(text);
    deps.toast({ tone: "info", text: "Prompt copied — paste it into the session's terminal" });
  } catch (e) {
    deps.toast({ tone: "alert", text: `Copy failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}
function blocker(key: string, deps: DispatchDeps): Promise<void> | void {
  const row = deps.rows().get(key);
  if (!row) return;
  // The same rule as the window's next step (data.ts): focus only a terminal that can be focused.
  const waits = deps.needs().some((x) => x.subject === key) && canFocus(row, deps.hosted(key) || !!deps.chatOf?.(key), deps.focusTerminal?.() ?? true);
  const n = nextStep(row, waits);
  if (!n) return;
  if (n.prompt) return sendPrompt(key, n.prompt, deps) || copyPrompt(n.prompt, deps);
  if (n.does === "focus") return run(deps, "Focus", deps.ipc.focusSessionTerminal(key));
  if (n.does === "create-pr") return createPr(key, deps);
  const url = prUrl(row);
  if (url) deps.openUrl(n.does === "open-checks" ? `${url}/checks` : url);
}
/** Asks with the commit, where it goes, a base to pick and the title; then pushes and creates
 *  exactly the plan last shown, which the CLI re-checks before it pushes. */
async function createPr(key: string, deps: DispatchDeps): Promise<void> {
  let plan: PrPlanJson;
  try {
    plan = await deps.ipc.prCreatePlan(key);
  } catch (e) {
    return deps.toast({ tone: "alert", text: `Create PR failed: ${e instanceof Error ? e.message : String(e)}` });
  }
  if (plan.existing) {
    deps.openUrl(plan.existing.url);
    return deps.toast({ tone: "info", text: `PR #${plan.existing.number} is already open for ${plan.ref?.replace(/^refs\/heads\//, "") ?? plan.branch} — opened it` });
  }
  if (plan.problem) return deps.toast({ tone: "alert", text: `Create PR: ${plan.problem.message} — ${plan.problem.fix}` });
  const shown: PrConfirmState = { plan, title: plan.title };
  deps.open({
    kind: "confirm",
    title: "Create a pull request?",
    body: createElement(PrConfirm, { initial: plan, state: shown, replan: (base: string) => deps.ipc.prCreatePlan(key, base) }),
    confirm: "Push and create PR",
    onConfirm: () => {
      const p = shown.plan;
      if (p.problem) return deps.toast({ tone: "alert", text: `Create PR: ${p.problem.message} — ${p.problem.fix}` });
      const confirmed: PrConfirmJson = { branch: p.branch!, head: p.head!, remote: p.remote, ref: p.ref!, pushUrl: p.pushUrl!, repo: p.repo!, base: p.base!, title: shown.title.trim() || p.title };
      void run(
        deps,
        "Create PR",
        deps.ipc.prCreate(key, confirmed).then((url) => {
          deps.toast({ tone: "ok", text: `Pull request created: ${url}` });
          if (/^https:\/\//.test(url)) deps.openUrl(url);
        }),
      );
    },
  });
}
/** The message a switched session is sent so it carries on. */
const CONTINUE = "Continue where you left off.";
/**
 * One confirmed move. Claude keeps its conversation through `rebind` and is
 * then told to continue where Agent Switch can type (a hosted window, a chat);
 * "after this turn" arms the switch and the service continues it. Codex has no
 * live login switch: the session moves (`takeover`) and resumes on the target
 * with the continuation — in its window when hosted, else in the app's terminal
 * (which refuses while codex still runs in the user's own terminal). A Claude
 * session bound for an account that runs a session of its own moves the same
 * way: `rebind` would take that account's login away and sign it out.
 */
/** Moves one session. A takeover from the user's own terminal needs a terminal
 *  of its own: it comes back as a run, so the caller opens them all together. */
async function moveOne(key: string, target: string, how: MoveHow, deps: DispatchDeps, via?: "takeover"): Promise<TerminalRun | void> {
  const [provider] = key.split("/");
  if (how === "brief") return void deps.open(sessionSheet(key, deps));
  if (provider === "codex" || via === "takeover") {
    if (deps.hosted(key)) return deps.ipc.takeoverHosted(key, target);
    const id = key.split("/")[2];
    // Claude: the session may still run in the user's own terminal; end it there
    // between turns so it can move (the CLI refuses mid-turn).
    const stop = provider === "claude" ? ["--stop-source"] : [];
    return { title: `Continue on ${target}`, args: ["takeover", id, "--to", target, "--provider", provider, ...stop, "--prompt", CONTINUE] };
  }
  const to = accountId(provider, target);
  if (how === "after-turn") return deps.act.armRebind?.(vmSessionId(key), to);
  await deps.act.rebind?.(vmSessionId(key), to);
  const chat = deps.chatOf?.(key);
  if (chat?.send) return chat.send(CONTINUE);
  if (deps.hosted(key)) return deps.ipc.continueSession(key);
  deps.toast({ tone: "info", text: `Now on ${target} — type one message in its terminal to continue` });
}
/** The app carried the moves out itself (D2 for hosted sessions): it records
 *  each answer so agent-config stops asking. A brief moves nothing yet. A lost
 *  record only means agent-config may ask once more; the move stands. */
function recordMoves(how: MoveHow, moves: readonly { key: string; target: string }[], deps: DispatchDeps): void {
  if (how === "brief" || !deps.ipc.decideSwitchRequest || !deps.requests) return;
  const executed = how === "after-turn" ? "armed in the app; moves after this turn" : "moved in the app";
  for (const r of requestsForMoves(deps.requests(), moves, Date.now())) {
    void deps.ipc.decideSwitchRequest(r.id, "approve", { to: r.to, how, executed }).catch(() => {});
  }
}
/**
 * With the background service as executor, the app records the answer without
 * carrying it out, and the service moves the session. Only a move whose own
 * session request offers that target and mode is handed over: a request for a
 * whole account stays with the app, which moves and continues each of its
 * sessions. Every other move — and one whose answer the store did not apply
 * (answered elsewhere first, expired) — the app makes itself, as before, so no
 * answer is left undone. Returns the moves left to the app.
 */
async function handOver(how: "after-turn" | "now", moves: readonly SheetMove[], deps: DispatchDeps): Promise<SheetMove[]> {
  // A stopped service would leave the answer undone: the app moves the sessions itself.
  if (!deps.executor || !deps.ipc.decideSwitchRequest || !deps.requests || deps.serviceDown?.()) return [...moves];
  const executor = await deps.executor().catch(() => "app" as const);
  if (executor !== "service") return [...moves];
  const rows = deps.requests();
  const handed = new Set<string>();
  for (const r of requestsForMoves(rows, moves, Date.now())) {
    const row = rows.find((x) => x.id === r.id);
    if (!row || row.session !== r.key) continue;
    // Codex has no live switch: "after this turn" moves the session, which is the service's `now`.
    const mode = r.key.startsWith("codex/") ? "now" : how;
    if (!row.candidates.some((c) => c.target === r.to && c.how.includes(mode))) continue;
    const applied = await deps.ipc.decideSwitchRequest(r.id, "approve", { to: r.to, how: mode }).catch(() => false);
    if (applied === true) handed.add(r.key);
  }
  if (handed.size) deps.toast({ tone: "info", text: `The background service moves ${handed.size === 1 ? "this session" : `${handed.size} sessions`}; you get a notice when it is done` });
  return moves.filter((m) => !handed.has(m.key));
}

function onNeed(n: NeedItem, deps: DispatchDeps): Promise<void> | void {
  // A chat's approval or question is answered in the chat (spec §13.5: one decision).
  if (n.verb === "Open chat" && deps.openTab) return deps.openTab(n.subject);
  if (n.kind === "approval" || n.kind === "question") {
    // Open in › Focus terminal off: nothing brings a terminal forward; the session's tab opens instead.
    if (n.verb === "Open session" || !(deps.focusTerminal?.() ?? true)) return deps.openTab?.(n.subject);
    return run(deps, "Focus", deps.ipc.focusSessionTerminal(n.subject));
  }
  if (n.kind === "ci") {
    // Only the session the item names (several can share a PR); without it, the PR's page opens.
    const row = ciSession(n, deps.rows());
    const prs = (row?.prs ?? []).map(parsePr).filter((p) => p !== null);
    // The PR the item names; an item named by its session is about that session's PR.
    const pr = prs.find((p) => n.subject.endsWith(`#${p.number}`)) ?? prs[0];
    const conflict = n.ci ? n.ci.state === "conflict" : !!pr && pr.ci !== "FAILURE" && pr.mergeable === "CONFLICTING";
    if (row && pr) {
      const sent = sendPrompt(sessionKey(row), conflict ? conflictPrompt(pr) : ciPrompt(pr), deps);
      if (sent) return sent;
    }
    const m = /^([^#\s]+\/[^#\s]+)#(\d+)$/.exec(n.subject);
    const url = pr?.url || (m ? `https://github.com/${m[1]}/pull/${m[2]}` : null);
    if (url) return deps.openUrl(conflict ? url : `${url}/checks`);
    return;
  }
  if (n.kind === "signin") {
    const id = accountIdFromMember(n.subject);
    if (id) deps.open({ kind: "reauth", accountId: id });
  }
}
/** An approval answered from the Needs-you queue, by the approval id the item carries. */
function onAnswer(n: NeedItem, decision: "allow" | "always" | "deny", deps: DispatchDeps): Promise<void> | void {
  // AS answers only approvals of chats; a terminal it does not host is answered there.
  if (n.kind !== "approval" || answeredThere(n) || !n.version) return;
  const chat = deps.chatOf?.(n.subject);
  if (chat?.approve && chat.deny) return decision === "deny" ? chat.deny(n.version) : chat.approve(n.version, decision === "always");
  // From outside the chat only allow-once and deny exist: "always" widens a rule and stays in the chat.
  if (decision === "always") return;
  return run(deps, decision === "deny" ? "Deny" : "Allow", deps.ipc.needsAnswer(n.subject, n.version, decision));
}
function sessionMenu(key: string, item: SessionMenuItem, deps: DispatchDeps): Promise<void> | void {
  const row = deps.rows().get(key);
  switch (item) {
    case "Rename…":
      return deps.prompt({ title: "Rename session", initial: row?.library?.name ?? row?.summary ?? "", onSubmit: (v) => void run(deps, "Rename", deps.ipc.renameSession(key, v)) });
    case "Pin":
      return run(deps, "Pin", deps.ipc.setLibraryFlag(key, "pin", true));
    case "Take over here…":
      return deps.takeOver?.(key);
    case "Move to another account…":
      // The window opens the v3 decision sheet for it (every entry point, as the account chip does).
      return;
    case "Hand off…":
      return deps.open(sessionSheet(key, deps, "handoff"));
    case "Compact":
      return deps.open({ kind: "terminal", run: { args: ["compact", key], title: "Compact" } });
    case "Detach":
      return;
    case "End…":
      // The window opens the End dialog (what stops with it, whether it is kept); its answer comes back as `end`.
      return;
  }
}
export function dispatchV3(a: V3Action, deps: DispatchDeps): Promise<void> | void {
  switch (a.type) {
    case "need":
      return onNeed(a.item, deps);
    case "reveal":
      return deps.reveal?.();
    case "need-more":
      return deps.refresh();
    // The summary stays on every read until it is clicked here: a poll is not a look.
    case "away":
      return run(deps, "Away summary", deps.ipc.needsSeen());
    case "need-later":
      return run(deps, "Later", deps.ipc.needsLater(a.id));
    case "need-answer":
      return onAnswer(a.item, a.decision, deps);
    case "needs-later-all":
      return run(deps, "Later", Promise.all(deps.needs().map((n) => deps.ipc.needsLater(n.id))));
    case "start": {
      const p = a.plan;
      deps.draftStart?.(null);
      const choice = startChoice(p);
      const chosen = Object.keys(choice).length > 0;
      // The command the dialog previewed: hosted here, or a new window of the user's terminal.
      const go = p.where === "hosted" ? deps.ipc.hostStart : deps.ipc.startInTerminal;
      const started = chosen ? go(p.tool, p.folder, p.account, choice) : p.account ? go(p.tool, p.folder, p.account) : go(p.tool, p.folder);
      // Remembered for the next start only once this one went through.
      return run(deps, "Start", started.then(() => deps.rememberStart?.(p)));
    }
    case "start-draft":
      return deps.draftStart?.(a.plan);
    case "move": {
      const how = a.how;
      const left = how === "brief" ? Promise.resolve([...a.moves]) : handOver(how, a.moves, deps);
      return run(
        deps,
        "Move",
        left.then((mine) =>
          Promise.all(mine.map(({ key, target, via }) => moveOne(key, target, how, deps, via))).then((runs) => {
            // The app has one overlay slot: every takeover rides in one terminal sheet.
            const [first, ...more] = runs.filter((r): r is TerminalRun => !!r);
            if (first) deps.open(more.length ? { kind: "terminal", run: first, more } : { kind: "terminal", run: first });
            recordMoves(how, mine, deps);
          }),
        ),
      );
    }
    case "keep-account": {
      // An account is its tool and name: another tool's account of the same name keeps its items.
      const same = (subject: string) => subject.split("/")[1] === a.account && (!a.tool || subject.split("/")[0] === a.tool);
      const limits = deps.needs().filter((n) => (n.kind === "limit" || n.kind === "pace") && same(n.subject));
      // A pace suggestion put off is answered too, so agent-config stops asking and it is not raised again before its reset.
      const paced = (deps.requests?.() ?? []).filter((r) => requestKind(r) === "pace" && r.state === "open" && same(r.account) && Date.parse(r.expiresAt) > Date.now());
      for (const r of paced) void deps.ipc.decideSwitchRequest?.(r.id, "snooze")?.catch(() => {});
      return run(deps, "Keep", Promise.all(limits.map((n) => deps.ipc.needsLater(n.id))));
    }
    case "session-menu":
      return sessionMenu(a.key, a.item, deps);
    case "end":
      return run(deps, "End", deps.ipc.hostEnd(a.key));
    case "batch": {
      if (a.op === "onPin") return run(deps, "Pin", Promise.all(a.keys.map((k) => deps.ipc.setLibraryFlag(k, "pin", true))));
      if (a.op === "onArchive") return run(deps, "Archive", Promise.all(a.keys.map((k) => deps.ipc.setLibraryFlag(k, "archive", true))));
      if (a.op === "onClean") {
        if (!a.keys.length) return;
        const n = a.keys.length;
        const keys = [...a.keys];
        return deps.open({ kind: "confirm", title: `Clean up the worktrees of ${n} selected session${n === 1 ? "" : "s"}?`, body: "Removes the worktrees of the selected sessions whose PR is merged. A worktree with changes is skipped; other worktrees stay.", confirm: "Clean up", onConfirm: () => void run(deps, "Clean up", deps.ipc.cleanupMerged(keys)) });
      }
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
      if (p.kind === "attach") return run(deps, "Attach", deps.ipc.hostAttachInTerminal(a.key));
      // The app opens on the session's own account; it never resumes the conversation (spike S9).
      if (p.kind === "app") return run(deps, "Open", deps.ipc.openApp(p.app, a.key.split("/")[1] ?? ""));
      if (p.kind === "target") return run(deps, "Open", deps.ipc.openSessionIn(a.key, p.target));
      return run(deps, "Open", deps.ipc.openSessionIn(a.key));
    }
    case "set-model": {
      const chat = deps.chatOf?.(a.key);
      if (chat) return chat.setModel(a.model);
      if (!deps.hosted(a.key)) return;
      if (!a.key.startsWith("claude/")) return deps.toast({ tone: "info", text: CODEX_RESPAWN_WHY });
      return run(deps, "Model change", deps.ipc.hostRespawn(a.key, { model: a.model }));
    }
    case "set-thinking": {
      if (deps.chatOf?.(a.key)) return deps.toast({ tone: "info", text: "Thinking is set when the chat starts; switch to the terminal view to change it" });
      if (!deps.hosted(a.key)) return;
      // `host respawn` restarts Claude only; it refuses anything else.
      if (!a.key.startsWith("claude/")) return deps.toast({ tone: "info", text: CODEX_RESPAWN_WHY });
      return run(deps, "Thinking change", deps.ipc.hostRespawn(a.key, { effort: a.level }));
    }
    case "blocker":
      return blocker(a.key, deps);
    case "create-pr":
      return createPr(a.key, deps);
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
    case "open-terminal":
      return run(deps, "Terminal", deps.ipc.setOpenTerminal(a.id));
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
