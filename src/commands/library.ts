/**
 * `agent-switch sessions pin|unpin|name|tag|untag|archive|unarchive|search|keep|vault`
 * and the daemon's library round (road-to-agent-switch-v3-central Phase 4).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { configDir, die, listProfiles, ROOT } from "../profiles.js";
import { locateCodexSession, locateSession } from "../sessions.js";
import { Store, storeFile } from "../store/store.js";
import { StoreUnavailable } from "../store/driver.js";
import {
  cleanupPeriodDays,
  kept,
  keptState,
  libraryAll,
  libraryEntry,
  searchSessions,
  updateLibrary,
  vaultBytes,
  vaultCopy,
  vaultDir,
  vaultEntry,
  vaultRestore,
  type LibraryEntry,
  type SessionFiles,
} from "../library.js";
import { githubRepo, prCacheFile, prsForHead, readPrCache } from "../pr-facts.js";
import { sessionsWithGit, type SessionGitRow } from "./pr.js";
import { eventFile, lastHookCwd, readEvents } from "../hooks.js";
import { gitFacts } from "../git-facts.js";
import { handoffDir } from "../handoff.js";
import { identity } from "../profiles.js";
import { codexSessionMeta, readSessionHeader } from "../sessions.js";
import { codexResumeCommand, preflight, shellLine, type How } from "../resume.js";
import { cachedUsage } from "./shared.js";

/** Auto-keep sessions with an open PR (spec §10.3): on unless the user turned it off. */
const SETTINGS = () => path.join(ROOT, "library.json");
export function autoKeepOn(): boolean {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS(), "utf8")).autoKeepOpenPr !== false;
  } catch {
    return true;
  }
}

async function openStore(): Promise<Store> {
  try {
    return await Store.open(storeFile(ROOT));
  } catch (err) {
    if (err instanceof StoreUnavailable) die(`the library needs the event store: ${err.message}`);
    throw err;
  }
}

/** A session id (or full key) → its key and files, searching every Claude, then Codex account. */
export function resolveSession(idOrKey: string): { key: string; files: SessionFiles; account: string } | null {
  const parts = idOrKey.split("/");
  const id = parts[parts.length - 1];
  if (!/^[A-Za-z0-9-]{4,64}$/.test(id)) return null;
  const want = parts.length === 3 ? parts[0] : null;
  if (!want || want === "claude") {
    for (const account of want ? [parts[1]] : listProfiles("claude")) {
      const cfg = configDir("claude", account);
      const loc = locateSession(cfg, id);
      if (loc) return { key: `claude/${account}/${id}`, account, files: filesFor(cfg, loc.projectDir, id) };
    }
  }
  if (!want || want === "codex") {
    // A Codex session is one rollout file; there is no session folder or file history.
    for (const account of want ? [parts[1]] : listProfiles("codex")) {
      const cfg = configDir("codex", account);
      const loc = locateCodexSession(cfg, id);
      if (loc) return { key: `codex/${account}/${id}`, account, files: { transcript: loc.rollout, sessionDir: path.join(cfg, ".none", id), fileHistory: path.join(cfg, ".none", `${id}-history`) } };
    }
  }
  // A transcript Claude already deleted is still known to the vault, with the paths it came from.
  if (parts.length === 3) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(vaultDir(ROOT, idOrKey), "manifest.json"), "utf8"));
      const cfg = configDir(parts[0] === "codex" ? "codex" : "claude", parts[1]);
      const inside = (p: unknown) => typeof p === "string" && path.resolve(p).startsWith(cfg + path.sep);
      if (inside(m.source?.transcript) && inside(m.source?.sessionDir) && inside(m.source?.fileHistory)) return { key: idOrKey, account: parts[1], files: m.source };
    } catch {
      // not in the vault either
    }
  }
  return null;
}

function filesFor(cfg: string, projectDir: string, id: string): SessionFiles {
  return {
    transcript: path.join(cfg, "projects", projectDir, `${id}.jsonl`),
    sessionDir: path.join(cfg, "projects", projectDir, id),
    fileHistory: path.join(cfg, "file-history", id),
  };
}

export async function cmdLibrary(action: string, arg: string | undefined, value: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const store = await openStore();
  try {
    if (action === "search") {
      const rows = sessionsWithGit(50);
      const lib = new Map(libraryAll(store).map((e) => [e.key, e]));
      const cache = readPrCache(prCacheFile(ROOT));
      const searchable = rows.map((r) => ({
        key: r.key,
        summary: r.row.summary,
        cwd: r.git?.cwd ?? r.row.cwd,
        branch: r.git?.branch ?? null,
        prs: prsForRow(r, cache).map((p) => p.number),
      }));
      const hits = searchSessions(searchable, lib, [arg, value].filter(Boolean).join(" "));
      if (flags.json) console.log(JSON.stringify(hits.map((h) => ({ ...h, library: lib.get(h.key) ?? null })), null, 2));
      else for (const h of hits) console.log(`${h.key}  ${lib.get(h.key)?.name ?? h.summary ?? ""}  ${h.branch ?? ""}`);
      return;
    }
    if (action === "library") {
      const l = libraryList(store);
      if (flags.json) console.log(JSON.stringify(l, null, 2));
      else for (const e of l.entries) console.log(`${describe(e)}  ${e.kept.state === "kept" ? "kept" : e.kept.state === "at-risk" ? `${e.kept.daysLeft}d left` : "lost"}`);
      return;
    }
    if (action === "keep") {
      // `sessions keep auto on|off`: the Library's "Auto-keep sessions with an open PR".
      if (arg !== "auto" || (value !== "on" && value !== "off")) die("usage: agent-switch sessions keep auto on|off");
      fs.writeFileSync(SETTINGS(), JSON.stringify({ autoKeepOpenPr: value === "on" }) + "\n", { mode: 0o600 });
      console.log(`Auto-keep sessions with an open PR: ${value}.`);
      return;
    }
    if (!arg) die(`usage: agent-switch sessions ${action} <session>${["name", "tag", "untag"].includes(action) ? " <value>" : ""}`);
    const s = resolveSession(arg);
    if (!s) die(`no Claude session ${arg}`);
    if (action === "vault") {
      if (value === "restore") {
        vaultRestore(store, s.key, s.files);
        console.log(`Restored ${s.key} from the vault.`);
        return;
      }
      if (!fs.existsSync(s.files.transcript)) die(`${s.key} has no transcript to copy`);
      const r = vaultCopy(store, ROOT, s.key, s.files);
      console.log(`Copied ${s.key} into the vault (${r.bytes} bytes, verified).`);
      return;
    }
    const change: Parameters<typeof updateLibrary>[2] =
      action === "pin" ? { pinned: true } :
      action === "unpin" ? { pinned: false } :
      action === "archive" ? { archived: true } :
      action === "unarchive" ? { archived: false } :
      action === "name" ? { name: value ?? "" } :
      action === "tag" ? { addTag: value ?? die("usage: agent-switch sessions tag <session> <tag>") } :
      action === "untag" ? { removeTag: value ?? die("usage: agent-switch sessions untag <session> <tag>") } :
      die(`unknown library action ${action}`);
    const e = updateLibrary(store, s.key, change);
    // A new pin is copied right away; later turns are copied by the background round.
    if (action === "pin" && fs.existsSync(s.files.transcript) && !vaultEntry(store, s.key)) vaultCopy(store, ROOT, s.key, s.files);
    if (flags.json) console.log(JSON.stringify(e));
    else console.log(describe(e));
  } finally {
    store.close();
  }
}

function describe(e: LibraryEntry): string {
  const flags = [e.pinned && "pinned", e.autoKept && "auto-kept", e.archived && "archived"].filter(Boolean).join(", ");
  return `${e.key}${e.name ? ` "${e.name}"` : ""}${flags ? `  (${flags})` : ""}${e.tags.length ? `  #${e.tags.join(" #")}` : ""}`;
}

function prsForRow(r: SessionGitRow, cache = readPrCache(prCacheFile(ROOT))) {
  const repo = githubRepo(r.git?.remote ?? null);
  return repo ? prsForHead(cache, repo, r.git?.headSha ?? null) : [];
}

const DAY = 86_400_000;

/**
 * The background round: auto-keep open-PR sessions (and release them when the
 * PR closes), archive sessions whose PR merged more than 24 h ago (once — an
 * unarchive by the user sticks), and copy every kept session whose transcript
 * changed since its vault copy. Returns what it did, for the log.
 */
export async function libraryRound(nowMs = Date.now()): Promise<{ autoKept: number; released: number; archived: number; copied: number }> {
  const out = { autoKept: 0, released: 0, archived: 0, copied: 0 };
  let store: Store;
  try {
    store = await Store.open(storeFile(ROOT));
  } catch {
    return out;
  }
  try {
    const cache = readPrCache(prCacheFile(ROOT));
    const auto = autoKeepOn();
    for (const r of sessionsWithGit(20)) {
      const prs = prsForRow(r, cache);
      const e = libraryEntry(store, r.key);
      const open = prs.some((p) => p.lifecycle === "OPEN" || p.lifecycle === "DRAFT");
      if (auto && open && !e?.autoKept) (updateLibrary(store, r.key, { autoKept: true }), out.autoKept++);
      if (e?.autoKept && !open && prs.length) (updateLibrary(store, r.key, { autoKept: false }), out.released++);
      const merged = prs.find((p) => p.lifecycle === "MERGED");
      if (merged && nowMs - Date.parse(merged.updatedAt) > DAY && !autoArchived(store, r.key)) {
        updateLibrary(store, r.key, { archived: true });
        store.db.run("INSERT OR IGNORE INTO library_auto_archived (key, at) VALUES (?, ?)", r.key, new Date(nowMs).toISOString());
        out.archived++;
      }
    }
    for (const e of libraryAll(store).filter(kept)) {
      const s = resolveSession(e.key);
      if (!s || !fs.existsSync(s.files.transcript)) continue;
      const v = vaultEntry(store, e.key);
      if (v && fs.statSync(s.files.transcript).mtimeMs <= v.sourceMtime) continue;
      try {
        vaultCopy(store, ROOT, e.key, s.files);
        out.copied++;
      } catch {
        // a transcript being written right now: the next round copies it
      }
    }
  } finally {
    store.close();
  }
  return out;
}

function autoArchived(store: Store, key: string): boolean {
  return !!store.db.get("SELECT 1 AS x FROM library_auto_archived WHERE key = ?", key);
}

/** The Library page: every library entry with its session facts where the
 *  session is still on disk, plus the vault total and the auto-keep switch. */
export function libraryList(store: Store, nowMs = Date.now()) {
  const recent = new Map(sessionsWithGit(50).map((r) => [r.key, r]));
  const cache = readPrCache(prCacheFile(ROOT));
  const entries = libraryAll(store).map((e) => {
    const s = resolveSession(e.key);
    const r = recent.get(e.key);
    const pr = r ? prsForRow(r, cache)[0] : undefined;
    const f = libraryFacts(store, e.key, s?.files ?? null, nowMs);
    const mtime = s && fs.existsSync(s.files.transcript) ? fs.statSync(s.files.transcript).mtimeMs : null;
    return {
      ...e,
      summary: r?.row.summary ?? null,
      cwd: r?.git?.cwd ?? r?.row.cwd ?? null,
      branch: r?.git?.branch ?? null,
      pr: pr ? { number: pr.number, lifecycle: pr.lifecycle } : null,
      lastMs: mtime ?? Date.parse(e.updatedAt),
      kept: f.kept,
      canResume: f.canResume,
    };
  });
  return { autoKeep: autoKeepOn(), vaultBytes: vaultBytes(store), entries };
}

/** The Library page's facts per session: entry, kept state, deadline. */
export function libraryFacts(store: Store, key: string, files: SessionFiles | null, nowMs = Date.now()) {
  const e = libraryEntry(store, key);
  const v = vaultEntry(store, key);
  const exists = !!files && fs.existsSync(files.transcript);
  const cfg = files ? path.resolve(files.fileHistory, "..", "..") : null;
  const state = keptState({ vaultBytes: v?.bytes ?? null, transcriptExists: exists, mtimeMs: exists ? fs.statSync(files!.transcript).mtimeMs : null, periodDays: cfg ? cleanupPeriodDays(cfg) : 30, nowMs });
  return { library: e, kept: state, vault: v ? { bytes: v.bytes, copiedAt: v.copiedAt } : null, canResume: exists };
}

export { vaultBytes };

/** A linked worktree of a session whose PR is merged, with the live sessions that still work in it. */
export interface MergedWorktree {
  path: string;
  dirty: boolean;
  keys: string[];
  /** Live sessions in this worktree, merged or not: removing it would pull the folder from under them. */
  live: string[];
}

/**
 * Remove the linked worktrees of sessions whose PR is merged, skipping any
 * worktree with changes or with a live session in it. Asks first unless --yes.
 */
export function mergedWorktrees(): MergedWorktree[] {
  const cache = readPrCache(prCacheFile(ROOT));
  const rows = sessionsWithGit(50);
  const out = new Map<string, MergedWorktree>();
  for (const r of rows) {
    if (!r.git?.worktree) continue;
    if (!prsForRow(r, cache).some((p) => p.lifecycle === "MERGED")) continue;
    const top = r.git.toplevel;
    const cur = out.get(top) ?? { path: top, dirty: r.git.dirty, keys: [], live: rows.filter((o) => o.row.live && o.git?.toplevel === top).map((o) => o.key) };
    cur.keys.push(r.key);
    out.set(top, cur);
  }
  return [...out.values()];
}

/** The merged worktrees the named sessions work in; every one when none is named. Pure. */
export function worktreesFor<W extends { keys: string[] }>(list: readonly W[], sessions: readonly string[]): W[] {
  return sessions.length ? list.filter((w) => w.keys.some((k) => sessions.includes(k))) : [...list];
}

export interface CleanupResult {
  removed: string[];
  skipped: { path: string; reason: string }[];
  /** Without --yes: what would be removed. */
  wouldRemove: string[];
}

/** Removes (with `yes`) the worktrees that can go and says why the others stay. `remove` returns git's refusal, or null. */
export function cleanupWorktrees(list: readonly MergedWorktree[], yes: boolean, remove: (path: string) => string | null = removeLinkedWorktree): CleanupResult {
  const res: CleanupResult = { removed: [], skipped: [], wouldRemove: [] };
  for (const w of list) {
    const why = w.live.length ? `a live session works in it (${w.live.join(", ")})` : w.dirty ? "it has changes" : null;
    if (why) res.skipped.push({ path: w.path, reason: why });
    else if (!yes) res.wouldRemove.push(w.path);
    else {
      const refused = remove(w.path);
      if (refused === null) res.removed.push(w.path);
      else res.skipped.push({ path: w.path, reason: `git kept it: ${refused}` });
    }
  }
  return res;
}

/** From the main checkout (a worktree cannot remove itself); no --force: git refuses on its own if anything is left to lose. */
function removeLinkedWorktree(dir: string): string | null {
  const common = spawnSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 1000 }).stdout?.trim();
  const main = common ? path.dirname(common) : dir;
  const r = spawnSync("git", ["-C", main, "worktree", "remove", dir], { encoding: "utf8", timeout: 10_000 });
  return r.status === 0 ? null : (r.stderr || "").trim().split("\n")[0] || `exited ${r.status}`;
}

export function cmdCleanup(sessions: readonly string[], flags: Record<string, string | boolean>): void {
  const list = worktreesFor(mergedWorktrees(), sessions);
  const res = cleanupWorktrees(list, !!flags.yes);
  if (flags.json) return void console.log(JSON.stringify(res));
  if (list.length === 0) return void console.log(sessions.length ? "None of these sessions works in the worktree of a merged PR." : "No worktree of a merged session to clean up.");
  for (const s of res.skipped) console.log(`skip ${s.path}: ${s.reason}`);
  for (const p of res.wouldRemove) console.log(`would remove ${p} (merged; ${list.find((w) => w.path === p)!.keys.join(", ")})`);
  for (const p of res.removed) console.log(`removed ${p}`);
  if (res.wouldRemove.length) console.log("\nRun again with --yes to remove them.");
}

/** A Codex session resumes as it is, with `codex resume <id>` on its own account
 *  in the folder it ran in; the preflight's other ways are Claude's. */
function resumeCodex(key: string, transcript: string, how: How, flags: Record<string, string | boolean>): void {
  const [, account, id] = key.split("/");
  if (how !== "continue") die(`a Codex session resumes as it is (--how continue); to move it to another account: agent-switch takeover ${id} --provider codex --to <profile>`);
  if (!fs.existsSync(transcript)) die(`no Codex session ${key} with a rollout`);
  const cwd = codexSessionMeta(transcript)?.cwd ?? null;
  const folder = cwd && fs.existsSync(cwd) ? cwd : null;
  const command = codexResumeCommand(account, id, folder);
  if (flags.json) return void console.log(JSON.stringify({ key, cwd: folder, commands: [command], commandLines: [shellLine(command)] }, null, 2));
  console.log(folder ? `✓ resumes in ${folder}` : `! its folder ${cwd ?? "(not recorded)"} is gone; it resumes where this runs`);
  console.log(`\n  ${shellLine(command)}`);
  if (!flags.yes) return void console.log("\nRun it with --yes.");
  const r = spawnSync(process.execPath, [process.argv[1], ...command.slice(1)], { stdio: "inherit" });
  if (r.status !== 0) die(`stopped: ${shellLine(command)} exited ${r.status}`);
}

/**
 * `agent-switch sessions resume <session> [--how continue|fork|account|brief]
 * [--to <account>] [--json] [--yes]` — the preflight, the suggestion and the
 * exact commands (spec §8.4). Without --yes it only shows them.
 */
export function cmdResume(arg: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg) die("usage: agent-switch sessions resume <session> [--how continue|fork|account|brief] [--to <account>] [--yes]");
  const how = (typeof flags.how === "string" ? flags.how : "continue") as How;
  if (!["continue", "fork", "account", "brief"].includes(how)) die("--how is one of continue, fork, account, brief");
  const s = resolveSession(arg);
  if (s?.key.startsWith("codex/")) return resumeCodex(s.key, s.files.transcript, how, flags);
  if (!s || !fs.existsSync(s.files.transcript)) die(`no Claude session ${arg} with a transcript${s ? "; restore it from the vault first: agent-switch sessions vault " + s.key + " restore" : ""}`);
  const id = s.key.split("/")[2];
  const cfg = configDir("claude", s.account);
  const header = readSessionHeader(s.files.transcript);
  const events = readEvents(eventFile(ROOT, "claude", s.account));
  const cwd = lastHookCwd(events, id) ?? header.cwd ?? null;
  const git = cwd ? gitFacts(cwd) : null;
  const toAccount = typeof flags.to === "string" ? flags.to : undefined;
  const acct = how === "account" ? (toAccount ?? die("--how account needs --to <account>")) : s.account;
  const usage = cachedUsage("claude", acct).snapshot;
  const tight = usage?.windows.reduce<number | null>((m, w) => (w.utilization === null ? m : Math.max(m ?? 0, w.utilization)), null) ?? null;
  const p = preflight({
    sessionId: id,
    account: s.account,
    cwd,
    branch: git?.branch ?? null,
    headSha: git?.headSha ?? null,
    worktree: git?.worktree ?? false,
    how,
    toAccount,
    briefPath: path.join(handoffDir(cfg), `${id}.md`),
    account_ready: { signedIn: identity("claude", acct) !== null, tightestPct: tight },
  });
  if (flags.json) {
    console.log(JSON.stringify({ key: s.key, ...p, commandLines: p.commands.map(shellLine) }, null, 2));
    return;
  }
  for (const c of p.checks) console.log(`${c.ok ? "✓" : "!"} ${c.text}`);
  console.log(`\n${p.suggestion}\n`);
  for (const c of p.commands) console.log(`  ${shellLine(c)}`);
  if (!flags.yes) return void console.log("\nRun them with --yes.");
  for (const c of p.commands) {
    const r = spawnSync(c[0] === "agent-switch" ? process.execPath : c[0], c[0] === "agent-switch" ? [process.argv[1], ...c.slice(1)] : c.slice(1), { stdio: "inherit" });
    if (r.status !== 0) die(`stopped: ${shellLine(c)} exited ${r.status}`);
  }
}
