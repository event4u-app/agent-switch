#!/usr/bin/env node
// Release helper — the full release in one step: bump the version everywhere it
// lives, commit, tag, and push. The tag push triggers the npm publish +
// installer build in CI, so `task release` needs no manual follow-up.
//
// agent-switch carries its version in four files that MUST stay in lockstep
// (publish-npm.yml refuses to publish when the tag and package.json disagree):
//   - package.json                       (the npm package — the match gate)
//   - gui/package.json                   (the Tauri frontend)
//   - gui/src-tauri/tauri.conf.json      (the desktop app / installer version)
//   - gui/src-tauri/Cargo.toml           (the Rust crate) + Cargo.lock entry
//
// Usage:
//   node scripts/release.mjs              # AUTO: bump from commits, tag, push → CI publishes
//   node scripts/release.mjs --dry-run    # preview the auto-detected bump, change nothing
//   node scripts/release.mjs --no-push    # bump + commit + tag locally, do NOT push
//   node scripts/release.mjs 1.2.0        # exact version (override the auto bump)
//   node scripts/release.mjs --as minor   # forced bump (major|minor|patch)
//
// With no version and no --as, the bump is auto-detected from the Conventional
// Commits since the last tag: a `feat!:` / `BREAKING CHANGE` → major, a `feat:`
// → minor, otherwise → patch. Same default as the agent-config release flow.
//
// It PUSHES by default — the whole point is a one-command release. Pushing the
// version tag triggers the npm publish + GitHub Release (publish-npm.yml +
// release.yml). Use --no-push to stop at the local tag, --dry-run to preview.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// Push is the DEFAULT — `task release` is a full release: bump → commit → tag →
// push, and the tag push triggers the npm publish + installer build in CI.
// `--no-push` stops after the local tag; `--dry-run` previews without touching.
const noPush = args.includes("--no-push");

function die(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}
function git(...a) {
  return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
}

// ---------- resolve the target version ----------
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const asIdx = args.indexOf("--as");
// A bare X.Y.Z arg — excluding the value that follows --as (when present).
const positional = args.find((a, i) => !a.startsWith("-") && !(asIdx !== -1 && i === asIdx + 1));

const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const current = pkg.version;

/** Apply a semver bump kind to a plain X.Y.Z base. */
function bumpVersion(base, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(base);
  if (!m) die(`current version "${base}" is not plain X.Y.Z — pass an exact version instead`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  die(`bump kind must be major|minor|patch, got "${kind ?? ""}"`);
}

/** Auto-detect the bump from Conventional Commits since the last tag:
 *  a `type!:` / `BREAKING CHANGE` → major, a `feat:` → minor, else → patch.
 *  Returns { kind, since, count } or null when there is nothing to release. */
function detectBump() {
  let since = null;
  try {
    since = git("describe", "--tags", "--abbrev=0");
  } catch {
    since = null; // no tags yet → scan all history
  }
  let log = "";
  try {
    log = git("log", since ? `${since}..HEAD` : "HEAD", "--format=%B%x1e");
  } catch {
    log = "";
  }
  const commits = log.split("\x1e").map((c) => c.trim()).filter(Boolean);
  if (commits.length === 0) return null;
  // Per Conventional Commits: breaking = a `type!:` in the SUBJECT line, or a
  // `BREAKING CHANGE:` FOOTER (line-anchored + colon). Not a loose phrase match
  // — a commit that merely *describes* the convention must not trigger major.
  const subject = (c) => c.split("\n", 1)[0];
  const breaking = commits.some((c) => /^[a-z]+(\([^)]*\))?!:/i.test(subject(c)) || /^BREAKING[ -]CHANGE:/m.test(c));
  const feat = commits.some((c) => /^feat(\([^)]*\))?:/i.test(subject(c)));
  return { kind: breaking ? "major" : feat ? "minor" : "patch", since, count: commits.length };
}

const tagExists = (v) => git("tag", "--list", v) !== "";

/** Compare two X.Y.Z versions (pre-release/build stripped): <0, 0, >0. */
function cmpSemver(a, b) {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
/** Highest existing bare-numeric git tag, or null. */
function latestTagVersion() {
  const tags = git("tag").split("\n").map((t) => t.trim()).filter((t) => SEMVER.test(t));
  return tags.length ? tags.sort(cmpSemver).at(-1) : null;
}

// Bump from the HIGHER of package.json and the latest tag. A package.json that
// lags the tags (a release commit that never landed on this branch) must not
// make the computed next version collide with an existing tag.
const latest = latestTagVersion();
const base = latest && cmpSemver(latest, current) > 0 ? latest : current;

let target;
let autoNote = "";
if (asIdx !== -1) {
  target = bumpVersion(base, args[asIdx + 1]);
} else if (positional) {
  target = positional;
} else if (!tagExists(base)) {
  // `base` has no tag yet → RELEASE IT AS-IS (first release of a version, e.g.
  // after a reset to 1.0.0: cut 1.0.0, not 1.1.0).
  target = base;
  autoNote = `releasing ${base} (not yet tagged)`;
} else {
  // `base` is already released → auto-detect the next bump from it.
  const d = detectBump();
  if (!d) die(`no commits since ${base} — nothing to release`);
  target = bumpVersion(base, d.kind);
  autoNote = `auto: ${d.kind} bump from ${base}${base !== current ? ` (latest tag; package.json was ${current})` : ""} — ${d.count} commit(s)`;
}
if (!SEMVER.test(target)) die(`"${target}" is not a valid X.Y.Z version`);

// Bare-numeric tag (no `v` prefix) — matches the release/publish workflows and
// the @event4u/agent-config convention.
const tag = target;
// Whether we bump version files + make a release commit, or just tag the
// current (already-committed) version as-is.
const isBump = target !== current;

// ---------- preconditions ----------
if (!dryRun) {
  if (git("status", "--porcelain")) {
    die("working tree is not clean — commit or stash first so the release commit is only the version bump");
  }
  if (tagExists(tag)) die(`tag ${tag} already exists`);
}

// ---------- the edits (one replacer per file, minimal + anchored) ----------
/** Replace via a regex that captures a prefix group $1 and swaps the version. */
function bumpFile(rel, re, label) {
  const p = path.join(ROOT, rel);
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    console.warn(`  · skip ${rel} (not found)`);
    return;
  }
  if (!re.test(text)) {
    console.warn(`  · skip ${rel} (${label} version line not found)`);
    return;
  }
  const next = text.replace(re, (_m, pre) => `${pre}${target}`);
  if (dryRun) console.log(`  · ${rel} → ${target}`);
  else fs.writeFileSync(p, next);
}

console.log(`${dryRun ? "[dry-run] " : ""}release ${current} → ${target} (tag ${tag})${autoNote ? ` — ${autoNote}` : ""}`);

if (isBump) {
  // JSON files: only the first top-level "version" key (anchored to 2-space indent).
  bumpFile("package.json", /^(  "version":\s*")[^"]+/m, "package.json");
  bumpFile("gui/package.json", /^(  "version":\s*")[^"]+/m, "gui/package.json");
  bumpFile("gui/src-tauri/tauri.conf.json", /^(  "version":\s*")[^"]+/m, "tauri.conf.json");
  // Cargo.toml: the [package] version at column 0 (dependency versions are inline).
  bumpFile("gui/src-tauri/Cargo.toml", /^(version = ")[^"]+/m, "Cargo.toml");
  // Cargo.lock: the agent-switch-gui package block's version line.
  bumpFile("gui/src-tauri/Cargo.lock", /(name = "agent-switch-gui"\nversion = ")[^"]+/, "Cargo.lock");
  // package.json: keep the per-platform GUI optionalDependencies pinned to the
  // same version (published in lockstep by release.yml). The `-<suffix>` keeps
  // this from matching the main package name.
  {
    const p = path.join(ROOT, "package.json");
    const text = fs.readFileSync(p, "utf8");
    const next = text.replace(/("@event4u\/agent-switch-[a-z0-9-]+":\s*")[^"]+/g, (_m, pre) => `${pre}${target}`);
    if (next !== text) {
      if (dryRun) console.log(`  · package.json GUI optionalDependencies → ${target}`);
      else fs.writeFileSync(p, next);
    }
  }
} else {
  console.log(`  · ${current} is not tagged yet — tagging it as-is, no version bump`);
}

if (dryRun) {
  console.log(isBump ? "[dry-run] no files written, no commit, no tag." : "[dry-run] no tag created.");
  process.exit(0);
}

// ---------- commit (only when bumping) + tag ----------
if (isBump) {
  // Resync package-lock.json with the bumped package.json (incl. the GUI
  // optionalDependencies) — otherwise CI `npm ci` fails EUSAGE ("out of sync").
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: ROOT, stdio: "ignore" });
  git("add", "package.json", "package-lock.json", "gui/package.json", "gui/src-tauri/tauri.conf.json", "gui/src-tauri/Cargo.toml", "gui/src-tauri/Cargo.lock");
  git("commit", "-m", `chore(release): ${tag}`);
}
git("tag", tag);
console.log(isBump ? `✅  committed the bump and tagged ${tag}` : `✅  tagged ${tag} (current version, no bump)`);

if (noPush) {
  console.log(`--no-push: stopped at the local tag. To release it: git push origin HEAD ${tag}`);
} else {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  git("push", "origin", branch);
  git("push", "origin", tag);
  console.log(`✅  pushed ${branch} + ${tag} — CI is now publishing to npm and building the installers.`);
}
