/**
 * Session inventory and lifecycle hooks: sessions (list, preview, rm, restore),
 * hooks, compact, alerts, and the internal __hook-event entry point.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { configDir, die, listProfiles, requireProfile, readBinaryPath, ROOT } from "../profiles.js";
import { ProviderId, provider, resolveBinary } from "../providers.js";
import { armForSession, armsFile, readArms } from "../rebind-arm.js";
import { liveSessionPids } from "../api.js";
import {
  SessionRow,
  assertValidSessionId,
  codexSessionCommand,
  deleteSession,
  listSessions,
  listCodexSessions,
  locateSession,
  locateCodexSession,
  markLive,
  openQuestion,
  pidCwd,
  restoreSession,
  sharedHistory,
  sweepTrash,
  trashedSessionExists,
} from "../sessions.js";
import { turnInFlight } from "../telemetry.js";
import { readPreview, type SessionPreview } from "../session-preview.js";
import {
  installHooks,
  uninstallHooks,
  hooksInstalled,
  hooksNeedMigration,
  readSettings,
  appendEvent,
  eventFile,
  profileFromConfigDir,
  readEvents,
  waitingSessions,
  hookNotice,
  recordFromPayload,
  lastHookCwd,
  lineageFromEnv,
  clearedFrom,
  pidFrom,
  hooksRecordSubagents,
  HookEventRecord,
} from "../hooks.js";
import { buildTree, childSource, childrenWithHooks, countSubagentFiles, helperIndex, relationUnknown, type TreeNode } from "../lineage.js";
import { gitFacts, type GitFacts } from "../git-facts.js";
import { githubRepo, prCacheFile, prsForHead, readPrCache } from "../pr-facts.js";
import { Store, storeFile } from "../store/store.js";
import { libraryFacts } from "./library.js";
import { readTelemetryConfig, writeTelemetryConfig } from "../notify.js";
import { appendNotification } from "../notifications.js";
import { readTmuxRegistry, sendKeysArgs, tmuxSessionName } from "../tmux.js";
import { TmuxHost } from "../host/tmux-host.js";
import { InputLeases, LeaseHeld } from "../host/lease.js";
import { cacheForRow, contextForRow, desktopScan, formatContext } from "./shared.js";
import { compactCacheLine, formatCache } from "../cache-words.js";

/** Relative age like "3m" / "2h" / "5d" for the sessions table. */
function ageOf(mtimeMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - mtimeMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/**
 * `agent-switch hooks install|uninstall|status [profile]` — manage the
 * lifecycle push hooks in Claude profiles' settings.json. Additive,
 * marker-keyed, idempotent, share-aware (settings.json may be a shared,
 * fork-prone link — after an edit the user should run `share sync`). Claude
 * only (the hook contract is Claude Code's).
 */
export function cmdHooks(sub?: string, name?: string): void {
  const action = sub ?? "status";
  if (!["install", "uninstall", "status"].includes(action)) {
    die("usage: agent-switch hooks install|uninstall|status [profile]");
  }
  const profiles = name ? [requireProfile("claude", name, "hooks")] : listProfiles("claude");
  if (profiles.length === 0) die("no claude profiles");

  let sharedWarn = false;
  for (const p of profiles) {
    const cfg = configDir("claude", p);
    if (action === "status") {
      const settings = readSettings(cfg);
      // An install from ≤ 2.11 held every turn until the hook exited; bring it
      // to the non-blocking shape on sight. Only our own entries change.
      if (hooksNeedMigration(settings)) {
        installHooks(cfg);
        console.log(`claude/${p}: installed (migrated to non-blocking hooks)`);
        sharedWarn = true;
        continue;
      }
      console.log(`claude/${p}: ${hooksInstalled(settings) ? "installed" : "not installed"}`);
      continue;
    }
    const res = action === "install" ? installHooks(cfg) : uninstallHooks(cfg);
    console.log(`claude/${p}: ${action} ${res.changed ? "done" : "(no change)"}`);
    if (res.changed) sharedWarn = true;
  }
  if (sharedWarn) {
    console.log(
      "\nsettings.json changed. If you use `share on`, run `agent-switch share sync` so the edit propagates and the link is restored.",
    );
  }
}


/**
 * Git facts for a session, from the folder it works in now: the newest hook
 * (start or turn end), else the live process's folder, else the transcript's
 * first folder — `cwdSource` says which. null outside a repo.
 */
export function gitFor(r: SessionRow, events: readonly HookEventRecord[]): (GitFacts & { cwd: string; cwdSource: "hook" | "process" | "transcript" }) | null {
  const hook = lastHookCwd(events, r.sessionId);
  const proc = !hook && r.pid ? pidCwd(r.pid) : null;
  const cwd = hook ?? proc ?? r.cwd;
  if (!cwd) return null;
  // Many sessions share a folder: ask git once per folder per run.
  if (!gitMemo.has(cwd)) gitMemo.set(cwd, gitFacts(cwd));
  const facts = gitMemo.get(cwd)!;
  return facts ? { ...facts, cwd, cwdSource: hook ? "hook" : proc ? "process" : "transcript" } : null;
}
const gitMemo = new Map<string, GitFacts | null>();

/** Where helper runs (council seats, scripted `claude -p`) usually work. */
const TEMP_ROOTS = [...new Set([os.tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"])];

/** Idle-guard window per provider (council #10): a Claude turn runs 15–60s, a
 *  Codex turn can be sub-second. In-flight = last transcript entry non-finalized
 *  AND younger than this. */
const IDLE_GUARD_MS: Record<string, number> = { claude: 15_000, codex: 5_000 };

/**
 * `agent-switch compact <profile> [--clear] [--dry-run] [--force] [--provider P]`
 * — type `/compact` (or `/clear`, gated) into the profile's agent-switch-MANAGED
 * tmux pane. MANAGED panes only (registry check); never a user's own terminal.
 * Refuses while a turn is in flight (idle guard) unless --force. Own-session.
 */
export function cmdCompact(providerId: ProviderId, name?: string, flags: Record<string, string | boolean> = {}): void {
  if (name?.includes("/")) return compactHosted(name, flags);
  if (providerId !== "claude" && providerId !== "codex") die(`compact supports claude and codex (not ${providerId})`);
  const profile = requireProfile(providerId, name, "compact");
  const clear = !!flags.clear;
  const dryRun = !!flags["dry-run"];
  const force = !!flags.force;
  const literal = clear ? "/clear" : "/compact";

  // 1. resolve the managed pane (profile-keyed; a profile has one managed name).
  const sess = tmuxSessionName(providerId, profile);
  const registry = readTmuxRegistry();
  if (!registry[sess]) {
    die(
      `no agent-switch-managed tmux pane for ${providerId}/${profile}.\n` +
        `We only ever type into panes we own. Start one with:  agent-switch run ${profile} --tmux\n` +
        `Or run this yourself in the session's terminal:  ${literal}`,
    );
  }

  // 2. /clear is destructive — gate behind --force (no interactive confirm in a one-shot CLI).
  if (clear && !force) {
    die("/clear discards the whole conversation. Re-run with --force if you really mean it (or use /compact to summarize instead).");
  }

  // 3. idle guard — never type into a running turn.
  const cfg = configDir(providerId, profile);
  const rows = providerId === "codex" ? listCodexSessions(cfg, 10) : listSessions(cfg, 10);
  if (providerId === "claude") markLive(cfg, rows);
  const target = rows.find((r) => r.live && r.file) ?? rows.find((r) => r.file);
  if (target?.file && !force && turnInFlight(target.file, Date.now(), IDLE_GUARD_MS[providerId] ?? 15_000)) {
    die(`a turn looks in-flight in ${providerId}/${profile} (last entry is unfinished + recent). Wait for it, or pass --force.`);
  }

  // 4. a cold /compact re-reads the whole history uncached — say so, never refuse.
  if (!clear && target) {
    const line = compactCacheLine(cacheForRow(providerId, target, readEvents(eventFile(ROOT, providerId, profile))), Date.now());
    if (line) console.log(line);
  }

  // 5. act (or dry-run).
  const argv = sendKeysArgs(sess, literal);
  if (dryRun) {
    console.log(`[dry-run] tmux ${argv.map((a) => (a.includes(" ") ? `'${a}'` : a)).join(" ")}`);
    return;
  }
  const res = spawnSync("tmux", argv, { stdio: "ignore" });
  if (res.status === 0) console.log(`Sent ${literal} to the managed pane "${sess}".`);
  else die(`tmux send-keys failed (is the pane still open?). Run ${literal} yourself in the session.`);
}

/**
 * `compact <provider/account/session>` on a v3 hosted session: the same gates as
 * above, and the text goes in through the input lease — so it is refused while
 * the app (or anyone else) is typing into that session.
 */
function compactHosted(key: string, flags: Record<string, string | boolean>): void {
  const [providerId, account, sessionId] = key.split("/");
  if ((providerId !== "claude" && providerId !== "codex") || !account || !sessionId) die(`not a hosted session key: ${key}`);
  const clear = !!flags.clear;
  const force = !!flags.force;
  const literal = clear ? "/clear" : "/compact";
  if (!TmuxHost.available()) die("hosted sessions need tmux");
  const host = new TmuxHost(ROOT);
  if (!host.windowOf(key)) die(`no hosted session ${key}. List them with: agent-switch host list`);
  if (clear && !force) die("/clear discards the whole conversation. Re-run with --force if you really mean it (or use /compact to summarize instead).");
  const cfg = configDir(providerId, account);
  const rows = providerId === "codex" ? listCodexSessions(cfg, 50) : listSessions(cfg, 50);
  const target = rows.find((r) => r.sessionId === sessionId && r.file);
  if (target?.file && !force && turnInFlight(target.file, Date.now(), IDLE_GUARD_MS[providerId] ?? 15_000)) {
    die(`a turn looks in-flight in ${key}. Wait for it, or pass --force.`);
  }
  if (!clear && target) {
    const line = compactCacheLine(cacheForRow(providerId, target, readEvents(eventFile(ROOT, providerId, account))), Date.now());
    if (line) console.log(line);
  }
  if (flags["dry-run"]) {
    console.log(`[dry-run] would type ${literal} into ${key}`);
    return;
  }
  const leases = new InputLeases(ROOT);
  const me = { id: `cli-${process.pid}`, pid: process.pid, kind: "cli" };
  try {
    leases.acquire(key, me);
  } catch (err) {
    if (err instanceof LeaseHeld) die(`${key} is being typed into by ${err.lease.holder.kind}; wait, or hand the input over there.`);
    throw err;
  }
  try {
    leases.type(host, key, me, literal, { enter: true });
  } finally {
    leases.release(key, me);
  }
  console.log(`Sent ${literal} to ${key}.`);
}

/**
 * `agent-switch alerts on|off|status [--threshold a,b]` — toggle whether the
 * daemon records context/usage crossings into the shared notification log
 * (off by default) and set the per-session context thresholds. Own-session
 * only. (Named `alerts` to avoid the `notify` command, which records a raw
 * notification event into the log.)
 */
export function cmdAlerts(sub?: string, flags: Record<string, string | boolean> = {}): void {
  const action = sub ?? "status";
  const cfg = readTelemetryConfig(ROOT);
  if (typeof flags.threshold === "string") {
    const parsed = flags.threshold.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
    if (parsed.length === 0) die("--threshold must be a comma-separated list of 1–100 numbers, e.g. --threshold 80,95");
    cfg.contextThresholds = parsed.sort((a, b) => a - b);
    writeTelemetryConfig(ROOT, cfg);
  }
  if (action === "on" || action === "off") {
    cfg.notify = action === "on";
    writeTelemetryConfig(ROOT, cfg);
  } else if (action !== "status") {
    die("usage: agent-switch alerts on|off|status [--threshold 80,95]");
  }
  if (flags.json) { console.log(JSON.stringify({ notify: cfg.notify, contextThresholds: cfg.contextThresholds }, null, 2)); return; }
  console.log(`notifications: ${cfg.notify ? "on" : "off"}  ·  context thresholds: ${cfg.contextThresholds.join(", ")}%`);
  if (!cfg.notify && action === "status") {
    console.log("(enable with `agent-switch alerts on`; the daemon records one coalesced notification per cycle when a live session crosses a threshold)");
  }
}

/**
 * Internal: the command Claude runs for each installed hook. Reads the hook's
 * stdin JSON and its own CLAUDE_CONFIG_DIR env, maps the dir back to a profile
 * (works even under a shared settings.json), and appends one event to the ring.
 * Silent + best-effort — a hook must never disrupt the session it fires in.
 */
export function cmdHookEvent(): void {
  try {
    const raw = fs.readFileSync(0, "utf8"); // stdin
    const o = JSON.parse(raw);
    const cfg = process.env.CLAUDE_CONFIG_DIR;
    if (!cfg) return;
    const who = profileFromConfigDir(cfg, ROOT);
    if (!who) return;
    const rec = recordFromPayload(o, new Date().toISOString());
    if (rec.event === "SessionStart") {
      const hostPid = pidFrom(process.env.CLAUDE_PID);
      if (hostPid) rec.hostPid = hostPid;
      const cleared = clearedFrom(rec, rec.source === "clear" ? readEvents(eventFile(ROOT, who.provider, who.profile)) : []);
      const lineage = cleared
        ? ({ parent: `${who.provider}/${who.profile}/${cleared}`, kind: "cleared", source: "hook" } as const)
        : lineageFromEnv(process.env, rec.sessionId, rec.sessionId ? `${who.provider}/${who.profile}/${rec.sessionId}` : undefined);
      if (lineage) rec.lineage = lineage;
    }
    appendEvent(eventFile(ROOT, who.provider, who.profile), rec);
    // Session awareness: surface "Claude needs you / finished / stopped" as a
    // notification the GUI routes to the pet. dedupe=false — each turn is a
    // distinct moment, so a solo session's repeated turns are never collapsed.
    // Best-effort; a hook must never throw.
    const notice = hookNotice(rec, who);
    if (notice) appendNotification(notice, undefined, undefined, false);
  } catch {
    // never throw from a hook
  }
}

export async function cmdSessions(
  providerId: ProviderId,
  providerExplicit: boolean,
  name?: string,
  flags: Record<string, string | boolean> = {},
): Promise<void> {
  if (providerExplicit && providerId === "antigravity") {
    // Not readable: Antigravity keeps no transcript Agent Switch can parse yet (an ACP source is v3.2).
    if (flags.json) console.log("[]");
    else console.log("Antigravity sessions are not readable yet. Start one hosted with: agent-switch host start <profile> --provider antigravity");
    return;
  }
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions supports claude and codex for now (${providerId} parity is gated on its Phase-0 spike — see scripts/spikes/)`);
  }
  const recentFlag = flags.recent;
  const limit = typeof recentFlag === "string" ? Number(recentFlag) : 10;
  if (!Number.isFinite(limit) || limit < 1) die("--recent must be a positive number");

  const profiles = name ? [requireProfile(providerId, name, "sessions")] : listProfiles(providerId);
  if (profiles.length === 0) die(`no ${providerId} profiles`);

  const all: (SessionRow & { profile: string; surface?: string })[] = [];
  const eventsOf = new Map<string, HookEventRecord[]>();
  // Profiles whose hooks see subagents; elsewhere `children` stays absent.
  const seesChildren = new Set<string>();
  // Claude Desktop's own sessions, filed by account (see desktop-sessions.ts).
  const desktop = providerId === "claude" ? desktopScan().rows : [];
  for (const p of profiles) {
    const cfg = configDir(providerId, p);
    // Codex stores date-partitioned rollout files (no encoded-cwd dir); its live
    // detection is not available via the Claude pid-file mechanism, so codex rows
    // stay recent-only (no live marking).
    const rows: (SessionRow & { surface?: string })[] = providerId === "codex" ? listCodexSessions(cfg, limit) : listSessions(cfg, limit);
    if (providerId === "claude") markLive(cfg, rows); // POSIX: pid→cwd→dir match; win32: recent-only
    if (providerId === "claude") {
      const mtime = new Map(rows.map((r) => [r.sessionId, r.mtimeMs]));
      const events = readEvents(eventFile(ROOT, providerId, p));
      eventsOf.set(p, events);
      if (hooksRecordSubagents(readSettings(cfg))) seesChildren.add(p);
      const waiting = waitingSessions(events, (id) => mtime.get(id) ?? null);
      // Hooks report a prompt; an open question also shows in the transcript itself.
      for (const r of rows) {
        const why = (r.file ? openQuestion(r.file) : null) ?? waiting.get(r.sessionId) ?? null;
        if (why) Object.assign(r, { waiting: true, waitingFor: why });
      }
    }
    const own = new Set(rows.map((r) => r.sessionId));
    for (const d of desktop) if (d.profile === p && !own.has(d.sessionId)) {
      const q = d.file ? openQuestion(d.file) : null;
      rows.push(q ? { ...d, waiting: true, waitingFor: q } : d);
    }
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
    all.push(...rows.slice(0, limit).map((r) => ({ ...r, profile: p })));
  }

  // D3: a switch armed for the end of this session's turn.
  const arms = providerId === "claude" ? readArms(armsFile(ROOT)) : {};
  const armedFor = (r: { profile: string; sessionId: string }) => {
    const a = armForSession(arms, r.profile, r.sessionId);
    return a ? { target: a.target, createdAt: a.createdAt, expiresAt: a.expiresAt } : null;
  };
  const cacheOf = (r: SessionRow & { profile: string }) => cacheForRow(providerId, r, eventsOf.get(r.profile) ?? []);
  if (flags.json || flags.tree) {
    // Helpers can name a parent on another account, so every account's events count.
    const allEvents = new Map(listProfiles(providerId).map((p) => [p, eventsOf.get(p) ?? (providerId === "claude" ? readEvents(eventFile(ROOT, providerId, p)) : [])]));
    const helpers = helperIndex(providerId, allEvents);
    const prCache = readPrCache(prCacheFile(ROOT));
    // The library lives in the event store; without SQLite (Node 20) it is left out.
    const store = providerId === "claude" ? await Store.open(storeFile(ROOT)).catch(() => null) : null;
    const json = all.map((r) => {
      const c = contextForRow(providerId, r);
      const key = `${providerId}/${r.profile}/${r.sessionId}`;
      let kids: Record<string, unknown> = {};
      if (seesChildren.has(r.profile)) {
        const children = childrenWithHooks(key, eventsOf.get(r.profile) ?? [], helpers);
        kids = { children, childCount: children.length, childSource: childSource(children) };
      } else {
        const named = childrenWithHooks(key, [], helpers);
        const counted = providerId === "claude" ? countSubagentFiles(configDir(providerId, r.profile), r.projectDir, r.sessionId) : 0;
        if (named.length) kids = { children: named, childCount: named.length + counted, childSource: counted ? `${childSource(named)}+counted` : childSource(named) };
        else if (counted) kids = { childCount: counted, childSource: "counted" };
      }
      const parent = helpers.parentOf.get(key);
      const git = gitFor(r, eventsOf.get(r.profile) ?? []);
      const repo = githubRepo(git?.remote ?? null);
      const prs = repo ? prsForHead(prCache, repo, git?.headSha ?? null) : [];
      return {
        provider: providerId,
        ...r,
        armed: armedFor(r),
        context: c
          ? { pct: c.pct, contextTokens: c.contextTokens, windowTokens: c.windowTokens, model: c.model, effort: c.effort ?? null, confidence: c.confidence, source: "transcript" }
          : null,
        cache: cacheOf(r),
        git,
        // From the cache the background refresh keeps; this call reads no network.
        prs,
        ...(store ? libraryFacts(store, key, { transcript: r.file ?? "", sessionDir: path.join(configDir(providerId, r.profile), "projects", r.projectDir, r.sessionId), fileHistory: path.join(configDir(providerId, r.profile), "file-history", r.sessionId) }) : {}),
        ...kids,
        ...(parent ? { parent } : r.codexThreadSource ? { root: false, relation: "unknown" } : relationUnknown(r.cwd, false, TEMP_ROOTS) ? { relation: "unknown" } : {}),
      };
    });
    store?.close();
    if (flags.tree) {
      type Row = (typeof json)[number];
      const keyOf = (r: Row) => `${providerId}/${r.profile}/${r.sessionId}`;
      const nest = (n: TreeNode<Row>): unknown => ({ ...n.row, sessions: n.children.map(nest) });
      // A Codex subagent thread is no root; without a parent it can name, it is grouped apart.
      const isRoot = (r: Row) => (r as { root?: boolean }).root !== false;
      const tree: unknown[] = buildTree(json.filter(isRoot), keyOf, (r) => (r as { parent?: string }).parent).map(nest);
      const loose = json.filter((r) => !isRoot(r));
      if (loose.length) tree.push({ relation: "unknown", sessions: loose });
      console.log(JSON.stringify(tree, null, 2));
      return;
    }
    console.log(JSON.stringify(json, null, 2));
    return;
  }
  const providerFlag = providerId === "claude" ? "" : ` --provider ${providerId}`;
  let any = false;
  for (const p of profiles) {
    const rows = all.filter((r) => r.profile === p);
    if (rows.length === 0) continue;
    any = true;
    console.log(`${providerId}/${p}:`);
    for (const r of rows) {
      const mark = r.live ? "*" : " ";
      const where = r.cwd ?? r.projectDir;
      const summary = r.summary ? `  ${r.summary}` : "";
      const ctx = formatContext(contextForRow(providerId, r));
      const ctxCol = ctx ? `  ${ctx}` : "";
      const cache = formatCache(cacheOf(r));
      const cacheCol = cache ? `  ${cache}` : "";
      console.log(`${mark} ${r.sessionId}  ${where}  ${ageOf(r.mtimeMs)}${ctxCol}${cacheCol}${r.live ? (r.hostStatus ? `  [live: ${r.hostStatus}]` : "  [live]") : ""}${armedFor(r) ? `  [switches to ${armedFor(r)!.target} when this turn ends]` : ""}${summary}`);
    }
  }
  if (!any) {
    console.log(`No sessions found. Sessions appear after a \`${provider(providerId).binary}\` run on a profile.`);
  } else {
    console.log(`\nTake one over with: agent-switch takeover <session-id> --to <profile>${providerFlag}`);
  }
}

/**
 * `agent-switch sessions preview <id> [--provider claude|codex] [--from <profile>]`
 * — the first few conversation turns of ONE session, for the GUI's collapsible
 * preview. Uses the sanctioned bounded reader (src/session-preview.ts, ADR-002):
 * a capped head read, fenced, degraded to an EMPTY preview on any failure or
 * unknown id (never an error — the GUI degrades to "no preview"). Codex is
 * deferred (opaque/often-compressed rollout) → always an empty preview. JSON.
 */
export function cmdSessionsPreview(
  providerId: ProviderId,
  providerExplicit: boolean,
  sessionId?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions preview supports claude and codex (not ${providerId})`);
  }
  if (!sessionId) {
    die("usage: agent-switch sessions preview <session-id> [--provider claude|codex] [--from <profile>]");
  }
  try {
    assertValidSessionId(sessionId);
  } catch (e) {
    die((e as Error).message);
  }

  const empty: SessionPreview = { messages: [], truncated: false };
  const emit = (preview: SessionPreview, profile: string | null) =>
    console.log(JSON.stringify({ provider: providerId, profile, sessionId, ...preview }, null, 2));

  if (providerId === "codex") {
    emit(empty, null); // deferred: opaque, often .zst-compressed rollout blob (ADR-002)
    return;
  }

  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "sessions preview --from")]
    : listProfiles("claude");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateSession(configDir("claude", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) {
    emit(empty, null); // unknown id → empty preview, never an error
    return;
  }
  const { profile, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateSession>> };
  emit(readPreview("claude", loc.jsonl) ?? empty, profile);
}

/**
 * `agent-switch sessions rm <id> [--provider claude|codex] [--from <profile>]
 * [--purge] [--yes] [--ack <id>] [--json]` — delete ONE session. Claude: a
 * recoverable trash-move (undo via `sessions restore`), `--purge` for true
 * deletion. Codex: the native `codex archive` (trash) / `codex delete` (purge),
 * because Codex owns its store format (.zst / indexes). Guards: strict id
 * validation, no-`--force`-over-live (Claude pids re-checked HERE; Codex mtime
 * freshness), multi-profile ambiguity refusal, shared-history acknowledgment.
 * `--yes` is mandatory (the GUI passes it after its own confirmation).
 */
export function cmdSessionsRm(
  providerId: ProviderId,
  providerExplicit: boolean,
  sessionId?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions rm supports claude and codex (not ${providerId})`);
  }
  if (!sessionId) {
    die("usage: agent-switch sessions rm <session-id> [--provider claude|codex] [--from <profile>] [--purge] [--yes] [--json]");
  }
  try {
    assertValidSessionId(sessionId);
  } catch (e) {
    die((e as Error).message);
  }
  const purge = !!flags.purge;
  const json = !!flags.json;
  if (!flags.yes) die("refusing to delete without --yes (the GUI passes it after its own confirmation)");

  if (providerId === "codex") return sessionsRmCodex(sessionId, flags, purge, json);

  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "sessions rm --from")]
    : listProfiles("claude");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateSession(configDir("claude", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) die(`session ${sessionId} not found in any claude profile (see: agent-switch sessions)`);
  if (hits.length > 1) {
    die(`session ${sessionId} exists in MULTIPLE profiles (${hits.map((h) => h.profile).join(", ")}) — pick one with --from`);
  }
  const { profile, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateSession>> };
  const cfg = configDir("claude", profile);

  // Live-guard, re-checked at exec time. --force does NOT override delete.
  const livePids = liveSessionPids(cfg);
  if (livePids.length > 0) {
    die(`profile "${profile}" has live Claude sessions (PIDs ${livePids.join(", ")}). Stop the session first — --force does not override delete.`);
  }

  // Shared-history: deleting removes the transcript for EVERY profile sharing the tree.
  const sharers = listProfiles("claude").filter(
    (p) => p !== profile && sharedHistory(cfg, configDir("claude", p)),
  );
  if (sharers.length > 0 && flags.ack !== sessionId) {
    die(`profiles [${sharers.join(", ")}] share this history tree — deleting removes the session for all of them. Re-run with --ack ${sessionId} to confirm.`);
  }

  const res = deleteSession(loc, { purge });
  sweepTrash(cfg);
  if (json) {
    console.log(JSON.stringify({ provider: "claude", profile, sessionId, ...res }, null, 2));
    return;
  }
  if (res.mode === "trash") {
    console.log(`Trashed claude session ${sessionId} from "${profile}". Restore: agent-switch sessions restore ${res.trashId} --from ${profile}`);
  } else {
    console.log(`Purged claude session ${sessionId} from "${profile}" (irreversible).`);
    if (res.residue.length) console.log(`  could not remove: ${res.residue.join(", ")}`);
  }
}

/** Codex delete path — native `codex archive`/`delete` in the profile's
 *  CODEX_HOME (codex exits 0 even on not-found, so success is read from output). */
function sessionsRmCodex(sessionId: string, flags: Record<string, string | boolean>, purge: boolean, json: boolean): void {
  const candidates = typeof flags.from === "string"
    ? [requireProfile("codex", flags.from, "sessions rm --from")]
    : listProfiles("codex");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateCodexSession(configDir("codex", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) die(`session ${sessionId} not found in any codex profile`);
  if (hits.length > 1) {
    die(`session ${sessionId} exists in MULTIPLE codex profiles (${hits.map((h) => h.profile).join(", ")}) — pick one with --from`);
  }
  const { profile, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateCodexSession>> };
  const cfg = configDir("codex", profile);

  // Codex has no live-pid signal → mtime-freshness proxy; typed --ack overrides.
  const ageMs = Date.now() - fs.statSync(loc.rollout).mtimeMs;
  if (ageMs < 60_000 && flags.ack !== sessionId) {
    die(`codex session ${sessionId} was written ${Math.round(ageMs / 1000)}s ago and may be live (codex has no liveness signal). Re-run with --ack ${sessionId} if it is idle.`);
  }

  const action = purge ? "delete" : "archive";
  const p = provider("codex");
  const env: NodeJS.ProcessEnv = { ...process.env, [p.envVar]: cfg };
  const r = spawnSync(resolveBinary(p.binary, readBinaryPath(p.id)), codexSessionCommand(action, sessionId), { env, encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (/no .*session.*found/i.test(out)) die(`codex could not find session ${sessionId} in "${profile}": ${out}`);
  if (r.status && r.status !== 0) die(`codex ${action} failed: ${out || `exit ${r.status}`}`);
  if (json) {
    console.log(JSON.stringify({ provider: "codex", profile, sessionId, mode: purge ? "purge" : "trash", action }, null, 2));
    return;
  }
  console.log(
    purge
      ? `Deleted codex session ${sessionId} from "${profile}" via \`codex delete\` (irreversible).`
      : `Archived codex session ${sessionId} from "${profile}" via \`codex archive\`. Restore: agent-switch sessions restore ${sessionId} --provider codex --from ${profile}`,
  );
}

/**
 * `agent-switch sessions restore <handle> [--provider codex] [--from <profile>]`
 * — undo a delete. Claude: `<handle>` is the trash-id; the owning profile is
 * scanned (or `--from`). Codex: `<handle>` is the session id; runs native
 * `codex unarchive` and needs `--from` for the CODEX_HOME.
 */
export function cmdSessionsRestore(
  providerId: ProviderId,
  providerExplicit: boolean,
  handle?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions restore supports claude and codex (not ${providerId})`);
  }
  if (!handle) die("usage: agent-switch sessions restore <trash-id|session-id> [--provider codex] [--from <profile>]");

  if (providerId === "codex") {
    try {
      assertValidSessionId(handle);
    } catch (e) {
      die((e as Error).message);
    }
    if (typeof flags.from !== "string") die("codex restore needs --from <profile> (the session's home)");
    const profile = requireProfile("codex", flags.from, "sessions restore --from");
    const p = provider("codex");
    const env: NodeJS.ProcessEnv = { ...process.env, [p.envVar]: configDir("codex", profile) };
    const r = spawnSync(resolveBinary(p.binary, readBinaryPath(p.id)), codexSessionCommand("unarchive", handle), { env, encoding: "utf8" });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (/no .*session.*found/i.test(out)) die(`codex could not find an archived session ${handle} in "${profile}": ${out}`);
    console.log(`Unarchived codex session ${handle} in "${profile}".`);
    return;
  }

  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "sessions restore --from")]
    : listProfiles("claude");
  const owner = candidates.find((p) => trashedSessionExists(configDir("claude", p), handle));
  if (!owner) {
    die(`no trashed session "${handle}" found${typeof flags.from === "string" ? ` in ${flags.from}` : ""} (use the trash-id printed when you deleted it)`);
  }
  const r = restoreSession(configDir("claude", owner), handle);
  console.log(`Restored claude session to ${r.restored} in "${owner}".`);
}
