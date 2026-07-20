#!/usr/bin/env node
// Release helper — bump the version everywhere it lives, commit, and tag.
//
// agent-switch carries its version in four files that MUST stay in lockstep
// (publish-npm.yml refuses to publish when the tag and package.json disagree):
//   - package.json                       (the npm package — the match gate)
//   - gui/package.json                   (the Tauri frontend)
//   - gui/src-tauri/tauri.conf.json      (the desktop app / installer version)
//   - gui/src-tauri/Cargo.toml           (the Rust crate) + Cargo.lock entry
//
// Usage:
//   node scripts/release.mjs                  # AUTO: bump from commits since the last tag
//   node scripts/release.mjs --dry-run        # preview the auto-detected bump
//   node scripts/release.mjs 1.2.0            # exact version (override)
//   node scripts/release.mjs --as patch       # forced bump (minor|major too)
//   node scripts/release.mjs 1.2.0 --push     # also push branch + tag (triggers CI publish)
//
// With no version and no --as, the bump is auto-detected from the Conventional
// Commits since the last tag: a `feat!:` / `BREAKING CHANGE` → major, a `feat:`
// → minor, otherwise → patch. Same default as the agent-config release flow.
//
// By default it bumps + commits + tags but does NOT push: pushing the vX.Y.Z
// tag triggers the real npm publish and GitHub Release (publish-npm.yml +
// release.yml), so that step stays an explicit, deliberate `--push` or a manual
// `git push --follow-tags`.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const push = args.includes("--push");

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
  const breaking = commits.some((c) => /^[a-z]+(\([^)]*\))?!:/im.test(c) || /BREAKING[ -]CHANGE/.test(c));
  const feat = commits.some((c) => /^feat(\([^)]*\))?:/im.test(c));
  return { kind: breaking ? "major" : feat ? "minor" : "patch", since, count: commits.length };
}

let target;
let autoNote = "";
if (asIdx !== -1) {
  target = bumpVersion(current, args[asIdx + 1]);
} else if (positional) {
  target = positional;
} else {
  // No version and no --as: auto-detect from the commit history (the default).
  const d = detectBump();
  if (!d) die(`no commits since ${git("describe", "--tags", "--abbrev=0")} — nothing to release`);
  target = bumpVersion(current, d.kind);
  autoNote = `auto: ${d.kind} bump from ${d.count} commit(s)${d.since ? ` since ${d.since}` : " (no prior tag)"}`;
}
if (!SEMVER.test(target)) die(`"${target}" is not a valid X.Y.Z version`);
if (target === current) die(`target ${target} equals the current version`);

const tag = `v${target}`;

// ---------- preconditions ----------
if (!dryRun) {
  if (git("status", "--porcelain")) {
    die("working tree is not clean — commit or stash first so the release commit is only the version bump");
  }
  const tags = git("tag", "--list", tag);
  if (tags) die(`tag ${tag} already exists`);
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
// JSON files: only the first top-level "version" key (anchored to 2-space indent).
bumpFile("package.json", /^(  "version":\s*")[^"]+/m, "package.json");
bumpFile("gui/package.json", /^(  "version":\s*")[^"]+/m, "gui/package.json");
bumpFile("gui/src-tauri/tauri.conf.json", /^(  "version":\s*")[^"]+/m, "tauri.conf.json");
// Cargo.toml: the [package] version at column 0 (dependency versions are inline).
bumpFile("gui/src-tauri/Cargo.toml", /^(version = ")[^"]+/m, "Cargo.toml");
// Cargo.lock: the agent-switch-gui package block's version line.
bumpFile(
  "gui/src-tauri/Cargo.lock",
  /(name = "agent-switch-gui"\nversion = ")[^"]+/,
  "Cargo.lock",
);

if (dryRun) {
  console.log("[dry-run] no files written, no commit, no tag.");
  process.exit(0);
}

// ---------- commit + tag ----------
git("add", "package.json", "gui/package.json", "gui/src-tauri/tauri.conf.json", "gui/src-tauri/Cargo.toml", "gui/src-tauri/Cargo.lock");
git("commit", "-m", `chore(release): ${tag}`);
git("tag", tag);
console.log(`✅  committed the bump and tagged ${tag}`);

if (push) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  git("push", "origin", branch);
  git("push", "origin", tag);
  console.log(`✅  pushed ${branch} + ${tag} — CI will publish to npm and build the installers`);
} else {
  console.log("Next (this triggers the npm publish + installer build):");
  console.log(`  git push --follow-tags`);
}
