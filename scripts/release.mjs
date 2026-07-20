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
//   node scripts/release.mjs 1.2.0            # exact version
//   node scripts/release.mjs --as patch       # bump patch (minor|major too)
//   node scripts/release.mjs --as minor --dry-run
//   node scripts/release.mjs 1.2.0 --push     # also push branch + tag (triggers CI publish)
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

let target;
if (asIdx !== -1) {
  const kind = args[asIdx + 1];
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) die(`current version "${current}" is not plain X.Y.Z — pass an exact version instead`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (kind === "major") [maj, min, pat] = [maj + 1, 0, 0];
  else if (kind === "minor") [min, pat] = [min + 1, 0];
  else if (kind === "patch") pat = pat + 1;
  else die(`--as expects major|minor|patch, got "${kind ?? ""}"`);
  target = `${maj}.${min}.${pat}`;
} else if (positional) {
  target = positional;
} else {
  die("pass a version (e.g. 1.2.0) or --as patch|minor|major");
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

console.log(`${dryRun ? "[dry-run] " : ""}release ${current} → ${target} (tag ${tag})`);
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
