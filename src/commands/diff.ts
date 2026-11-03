/**
 * `agent-switch diff <session> [--scope worktree|staged|session|turn] [--json]`
 * and its actions — the Review page (spec §10.9, road-to-agent-switch-v3-client
 * Phase 3).
 *
 * Every hunk says which layer it lives in: `committed` (already in a commit
 * since the base), `staged`, `unstaged` (the working tree, Bash changes and new
 * files included) or `turn` (what the last turn's edits recorded). Only staged
 * and unstaged hunks can be acted on, and only through `git apply` with the
 * exact hunk, after a preflight: no index lock, the hunk unchanged since it was
 * shown, no turn running. A discard is undoable.
 */

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { readPending } from "../bridge/pending.js";
import { die, ROOT } from "../profiles.js";
import { turnInFlight } from "../telemetry.js";
import { readClaudeTranscript } from "../timeline/claude.js";
import { parseUnifiedDiff, type DiffHunk } from "../timeline/events.js";
import { target, type Target } from "./bridge.js";
import { sessionsWithGit } from "./pr.js";

export const SCOPES = ["turn", "session", "worktree", "staged"] as const;
export type Scope = (typeof SCOPES)[number];
export type Layer = "committed" | "staged" | "unstaged" | "turn";

export interface ReviewHunk extends DiffHunk {
  layer: Layer;
  /** The hunk's identity for an action: changes when the hunk does. */
  hash: string;
  header: string;
}

export interface ReviewFile {
  path: string;
  status: "A" | "M" | "D" | "R" | "?";
  added: number;
  removed: number;
  hunks: ReviewHunk[];
}

export class ReviewRefused extends Error {}

const GIT_MS = 5000;

function git(cwd: string, args: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: GIT_MS, maxBuffer: 64 * 1024 * 1024, input });
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
}

export const hunkHash = (path: string, h: DiffHunk) => crypto.createHash("sha256").update(`${path}\0${h.oldStart}\0${h.newStart}\0${h.lines.join("\n")}`).digest("hex").slice(0, 16);

/** `git diff` output for many files → per-file hunks. Pure. */
export function splitDiff(text: string, layer: Layer): Map<string, { status: ReviewFile["status"]; hunks: ReviewHunk[] }> {
  const out = new Map<string, { status: ReviewFile["status"]; hunks: ReviewHunk[] }>();
  for (const part of text.split(/^diff --git /m).slice(1)) {
    const header = part.split("\n")[0];
    const plus = /^\+\+\+ (?:b\/)?(.+)$/m.exec(part)?.[1];
    const minus = /^--- (?:a\/)?(.+)$/m.exec(part)?.[1];
    const file = plus && plus !== "/dev/null" ? plus : minus && minus !== "/dev/null" ? minus : (/ b\/(.+)$/.exec(header)?.[1] ?? header);
    const status: ReviewFile["status"] = /^new file mode/m.test(part) ? "A" : /^deleted file mode/m.test(part) ? "D" : /^rename from/m.test(part) ? "R" : "M";
    const hunks = parseUnifiedDiff(part).map((h) => {
      const head = /^@@[^\n]*@@[^\n]*$/m.exec(part.slice(part.indexOf(`@@ -${h.oldStart}`)))?.[0] ?? `@@ -${h.oldStart} +${h.newStart} @@`;
      return { ...h, layer, hash: hunkHash(file, h), header: head };
    });
    out.set(file, { status, hunks });
  }
  return out;
}

/** The repository's main line: origin's HEAD, else main or master. */
function mainRef(cwd: string): string | null {
  const head = git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok && head.out.trim()) return head.out.trim();
  for (const r of ["origin/main", "main", "origin/master", "master"]) if (git(cwd, ["rev-parse", "--verify", "--quiet", r]).ok) return r;
  return null;
}

/** Where "Session" starts: the commit HEAD was on when the session began. */
function sessionBase(cwd: string, transcript: string | null): string | null {
  if (!transcript) return null;
  let first: string | null = null;
  try {
    const line = fs.readFileSync(transcript, "utf8").split("\n").find((l) => l.includes('"timestamp"'));
    first = line ? (JSON.parse(line) as { timestamp?: string }).timestamp ?? null : null;
  } catch {
    return null;
  }
  if (!first) return null;
  const r = git(cwd, ["rev-list", "-1", "--first-parent", `--before=${first}`, "HEAD"]);
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

function untracked(cwd: string): Map<string, { status: ReviewFile["status"]; hunks: ReviewHunk[] }> {
  const out = new Map<string, { status: ReviewFile["status"]; hunks: ReviewHunk[] }>();
  const list = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const file of list.out.split("\0").filter(Boolean).slice(0, 200)) {
    const abs = path.join(cwd, file);
    try {
      const st = fs.lstatSync(abs);
      if (!st.isFile() || st.size > 1_000_000) {
        out.set(file, { status: "?", hunks: [] });
        continue;
      }
      const text = fs.readFileSync(abs, "utf8").replace(/\n$/, "");
      const h: DiffHunk = { oldStart: 0, newStart: 1, lines: text ? text.split("\n").map((l) => `+${l}`) : [] };
      out.set(file, { status: "?", hunks: [{ ...h, layer: "unstaged", hash: hunkHash(file, h), header: `@@ -0,0 +1,${h.lines.length} @@` }] });
    } catch {
      // gone between the listing and the read
    }
  }
  return out;
}

function merge(into: Map<string, ReviewFile>, from: Map<string, { status: ReviewFile["status"]; hunks: ReviewHunk[] }>): void {
  for (const [p, v] of from) {
    const cur = into.get(p) ?? { path: p, status: v.status, added: 0, removed: 0, hunks: [] };
    if (cur.status === "M" && v.status !== "M") cur.status = v.status;
    cur.hunks.push(...v.hunks);
    into.set(p, cur);
  }
}

/** The review of one session in one scope. */
export function review(t: Target, scope: Scope): { base: string | null; files: ReviewFile[] } {
  const top = git(t.cwd, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) throw new ReviewRefused(`${t.key} does not work in a git repository`);
  const cwd = top.out.trim();
  const files = new Map<string, ReviewFile>();
  let base: string | null = null;
  if (scope === "turn") {
    if (!t.transcript) return { base: null, files: [] };
    const { events } = readClaudeTranscript(t.transcript);
    const lastTurn = events.map((e) => e.t).lastIndexOf("turn");
    for (const e of events.slice(Math.max(0, lastTurn))) {
      if (e.t !== "diff") continue;
      const rel = path.isAbsolute(e.path) ? path.relative(cwd, e.path) : e.path;
      merge(files, new Map([[rel, { status: "M" as const, hunks: e.hunks.map((h) => ({ ...h, layer: "turn" as const, hash: hunkHash(rel, h), header: `@@ -${h.oldStart} +${h.newStart} @@` })) }]]));
    }
  } else {
    if (scope !== "staged") {
      base = scope === "session" ? sessionBase(cwd, t.transcript) : null;
      if (!base) {
        const main = mainRef(cwd);
        const mb = main ? git(cwd, ["merge-base", main, "HEAD"]) : null;
        base = mb?.ok ? mb.out.trim() : null;
      }
      if (base) merge(files, splitDiff(git(cwd, ["diff", "--no-color", "--no-ext-diff", base, "HEAD"]).out, "committed"));
    }
    merge(files, splitDiff(git(cwd, ["diff", "--no-color", "--no-ext-diff", "--cached"]).out, "staged"));
    if (scope !== "staged") {
      merge(files, splitDiff(git(cwd, ["diff", "--no-color", "--no-ext-diff"]).out, "unstaged"));
      merge(files, untracked(cwd));
    }
  }
  const list = [...files.values()].map((f) => {
    let added = 0;
    let removed = 0;
    for (const h of f.hunks) for (const l of h.lines) l.startsWith("+") ? added++ : l.startsWith("-") && removed++;
    return { ...f, added, removed };
  });
  return { base, files: list.sort((a, b) => a.path.localeCompare(b.path)) };
}

// ---------- actions ----------

const undoDir = (key: string) => path.join(ROOT, "undo", crypto.createHash("sha256").update(key).digest("hex").slice(0, 32));

/** One hunk as a patch `git apply` takes. Pure. */
export function hunkPatch(file: string, h: DiffHunk, newFile = false): string {
  const oldLen = h.lines.filter((l) => !l.startsWith("+")).length;
  const newLen = h.lines.filter((l) => !l.startsWith("-")).length;
  const head = newFile ? `--- /dev/null\n+++ b/${file}\n` : `--- a/${file}\n+++ b/${file}\n`;
  return `diff --git a/${file} b/${file}\n${newFile ? "new file mode 100644\n" : ""}${head}@@ -${h.oldStart}${oldLen === 1 ? "" : `,${oldLen}`} +${h.newStart}${newLen === 1 ? "" : `,${newLen}`} @@\n${h.lines.join("\n")}\n`;
}

function preflight(t: Target, cwd: string): void {
  const gitDir = git(cwd, ["rev-parse", "--absolute-git-dir"]).out.trim();
  if (gitDir && fs.existsSync(path.join(gitDir, "index.lock"))) throw new ReviewRefused("git is busy (index.lock exists); try again in a moment");
  const busy = (t.transcript && turnInFlight(t.transcript, Date.now(), 120_000)) || readPending(ROOT).some((p) => p.key === t.key && p.items.length > 0);
  if (busy) throw new ReviewRefused("a turn is running — this unlocks when it ends");
}

export type Action = "stage" | "unstage" | "discard";

/** Stage, unstage or discard one hunk (or every hunk of the file's layer). */
export function act(t: Target, action: Action, file: string, expect: string | null): { done: string; undo: boolean } {
  const cwd = git(t.cwd, ["rev-parse", "--show-toplevel"]).out.trim();
  if (!cwd) throw new ReviewRefused(`${t.key} does not work in a git repository`);
  preflight(t, cwd);
  const layer: Layer = action === "unstage" ? "staged" : "unstaged";
  const cur = review(t, "worktree").files.find((f) => f.path === file);
  const hunks = (cur?.hunks ?? []).filter((h) => h.layer === layer && (!expect || h.hash === expect));
  if (!hunks.length) throw new ReviewRefused(expect ? "that change is no longer there as shown — refresh" : `nothing ${layer} in ${file}`);
  const isNew = cur?.status === "?";
  if (isNew) {
    if (action === "stage") {
      if (!git(cwd, ["add", "--", file]).ok) throw new ReviewRefused(`could not stage ${file}`);
      return { done: `staged ${file}`, undo: false };
    }
    // Discarding a new file deletes it: keep a copy for undo first.
    const dir = undoDir(t.key);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}`;
    fs.copyFileSync(path.join(cwd, file), path.join(dir, `${id}.file`));
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ kind: "file", file }), { mode: 0o600 });
    fs.rmSync(path.join(cwd, file));
    return { done: `discarded ${file}`, undo: true };
  }
  const patch = hunks.map((h) => hunkPatch(file, h)).join("");
  const args = action === "stage" ? ["apply", "--cached", "--whitespace=nowarn", "-"] : action === "unstage" ? ["apply", "--cached", "-R", "--whitespace=nowarn", "-"] : ["apply", "-R", "--whitespace=nowarn", "-"];
  const check = git(cwd, [...args.slice(0, -1), "--check", "-"], patch);
  if (!check.ok) throw new ReviewRefused(`git would not apply it: ${check.err.split("\n")[0]}`);
  if (action === "discard") {
    const dir = undoDir(t.key);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}`;
    fs.writeFileSync(path.join(dir, `${id}.patch`), patch, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ kind: "patch", file }), { mode: 0o600 });
  }
  const r = git(cwd, args, patch);
  if (!r.ok) throw new ReviewRefused(`git apply failed: ${r.err.split("\n")[0]}`);
  return { done: `${action === "stage" ? "staged" : action === "unstage" ? "unstaged" : "discarded"} ${hunks.length === 1 ? "a change" : `${hunks.length} changes`} in ${file}`, undo: action === "discard" };
}

/** Put the last discard back. */
export function undo(t: Target): string {
  const dir = undoDir(t.key);
  const ids = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const id = ids.at(-1);
  if (!id) throw new ReviewRefused("nothing to undo");
  const cwd = git(t.cwd, ["rev-parse", "--show-toplevel"]).out.trim();
  preflight(t, cwd);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as { kind: "file" | "patch"; file: string };
  if (meta.kind === "file") {
    const dest = path.join(cwd, meta.file);
    if (fs.existsSync(dest)) throw new ReviewRefused(`${meta.file} exists again; not overwriting it`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(dir, `${id}.file`), dest);
    fs.rmSync(path.join(dir, `${id}.file`));
  } else {
    const patch = fs.readFileSync(path.join(dir, `${id}.patch`), "utf8");
    const r = git(cwd, ["apply", "--whitespace=nowarn", "-"], patch);
    if (!r.ok) throw new ReviewRefused(`the file changed since; the discard cannot be put back cleanly (${r.err.split("\n")[0]})`);
    fs.rmSync(path.join(dir, `${id}.patch`));
  }
  fs.rmSync(path.join(dir, `${id}.json`));
  return `restored the last discard in ${meta.file}`;
}

/** Commit what is staged, with the hooks the repository has. */
export function commitStaged(t: Target, message: string): string {
  const cwd = git(t.cwd, ["rev-parse", "--show-toplevel"]).out.trim();
  preflight(t, cwd);
  if (!message.trim()) throw new ReviewRefused("a commit needs a message");
  if (git(cwd, ["diff", "--cached", "--quiet"]).ok) throw new ReviewRefused("nothing is staged");
  const r = git(cwd, ["commit", "-m", message]);
  if (!r.ok) throw new ReviewRefused(`git commit failed: ${(r.err || r.out).split("\n")[0]}`);
  return git(cwd, ["rev-parse", "--short", "HEAD"]).out.trim();
}

/** Other live sessions working in the same worktree (a conflict risk for stage/discard). */
export function sharedWorktree(t: Target, others: readonly { key: string; toplevel: string | null; live: boolean }[]): string[] {
  const top = samePathKey(git(t.cwd, ["rev-parse", "--show-toplevel"]).out.trim());
  return others.filter((o) => o.live && o.key !== t.key && o.toplevel && samePathKey(o.toplevel) === top).map((o) => o.key);
}

/** One spelling per folder: git writes `C:/Users/…`, Node `C:\Users\…` and 8.3 short names; Windows ignores case. */
function samePathKey(p: string): string {
  let r = path.resolve(p);
  try {
    r = fs.realpathSync.native(r);
  } catch {
    /* gone: compare as written */
  }
  return process.platform === "win32" ? r.toLowerCase() : r;
}

export function cmdDiff(arg: string | undefined, action: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg) die("usage: agent-switch diff <session> [--scope turn|session|worktree|staged] [--json] · diff <session> stage|unstage|discard --file F [--hunk HASH] · diff <session> undo · diff <session> commit --message M");
  const t = target(arg);
  const json = !!flags.json;
  const say = (o: Record<string, unknown>, text: string) => console.log(json ? JSON.stringify(o) : text);
  try {
    if (!action) {
      const scope = (typeof flags.scope === "string" ? flags.scope : "worktree") as Scope;
      if (!SCOPES.includes(scope)) die(`--scope is one of ${SCOPES.join(", ")}`);
      const r = review(t, scope);
      const shared = sharedWorktree(t, sessionsWithGit(20).map((x) => ({ key: x.key, toplevel: x.git?.toplevel ?? null, live: x.row.live })));
      if (json) return void console.log(JSON.stringify({ key: t.key, scope, shared, ...r }));
      if (shared.length) console.log(`Also working here: ${shared.join(", ")} — stage and discard affect them too.`);
      for (const f of r.files) console.log(`${f.status} ${f.path}  +${f.added} -${f.removed}`);
      return;
    }
    if (action === "stage" || action === "unstage" || action === "discard") {
      if (typeof flags.file !== "string") die(`usage: agent-switch diff <session> ${action} --file F [--hunk HASH]`);
      const r = act(t, action, flags.file, typeof flags.hunk === "string" ? flags.hunk : null);
      return say({ ok: true, ...r }, r.done);
    }
    if (action === "undo") {
      const m = undo(t);
      return say({ ok: true, done: m }, m);
    }
    if (action === "commit") {
      const sha = commitStaged(t, typeof flags.message === "string" ? flags.message : "");
      return say({ ok: true, commit: sha }, `Committed ${sha}.`);
    }
    die(`unknown diff action ${action}`);
  } catch (err) {
    if (!(err instanceof ReviewRefused)) throw err;
    if (json) {
      console.log(JSON.stringify({ ok: false, error: err.message }));
      process.exitCode = 2;
      return;
    }
    die(err.message);
  }
}
