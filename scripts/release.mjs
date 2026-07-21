#!/usr/bin/env node
// Release helper — one interactive command: work out the next version, show it,
// ask y/n, then bump every version file, commit, tag, and push. The tag push
// triggers the npm publish + installer build in CI (publish-npm.yml +
// release.yml), so `task release` needs no manual follow-up.
//
// The version is chosen to be FREE: it steps past every version ever used —
// git tags AND npm's full history, which includes "burned" versions (published
// then unpublished; npm refuses to republish those, E400). So the auto number
// can never collide with an existing tag or a burned npm version.
//
// Version lives in four files kept in lockstep (publish-npm.yml refuses to
// publish on a tag/package.json mismatch): package.json, gui/package.json,
// gui/src-tauri/tauri.conf.json, gui/src-tauri/Cargo.toml (+ Cargo.lock).
//
// Usage:
//   node scripts/release.mjs              # AUTO: next free version, confirm, release
//   node scripts/release.mjs --dry-run    # preview only, no prompt, change nothing
//   node scripts/release.mjs --as minor   # forced bump (major|minor|patch)
//   node scripts/release.mjs 1.5.0        # exact version (override)
//   node scripts/release.mjs --yes        # skip the y/n confirmation (automation)
//   node scripts/release.mjs --no-push    # commit + tag locally, do NOT push

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const assumeYes = args.includes("--yes") || args.includes("-y");

function die(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}
function git(...a) {
  return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const PACKAGE_NAME = pkg.name;

const asIdx = args.indexOf("--as");
const positional = args.find((a, i) => !a.startsWith("-") && !(asIdx !== -1 && i === asIdx + 1));

/** Compare two X.Y.Z versions (pre-release/build stripped): <0, 0, >0. */
function cmpSemver(a, b) {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Apply a semver bump kind to a plain X.Y.Z base. */
function bumpVersion(baseV, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(baseV);
  if (!m) die(`"${baseV}" is not plain X.Y.Z — pass an exact version instead`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  die(`bump kind must be major|minor|patch, got "${kind ?? ""}"`);
}

/** Every version ever taken: git tags + npm's full history (published AND
 *  unpublished/"burned" — npm never lets a burned version be republished). */
function takenVersions() {
  const taken = new Set();
  for (const t of git("tag").split("\n").map((x) => x.trim())) if (SEMVER.test(t)) taken.add(t);
  try {
    const out = execFileSync("npm", ["view", PACKAGE_NAME, "time", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const k of Object.keys(JSON.parse(out))) if (SEMVER.test(k)) taken.add(k);
  } catch {
    /* offline, or the package isn't published yet — tags only */
  }
  return taken;
}

/** Auto-detect the bump from Conventional Commits since the last tag:
 *  a `type!:` / `BREAKING CHANGE:` → major, a `feat:` → minor, else → patch. */
function detectBump() {
  let since = null;
  try {
    since = git("describe", "--tags", "--abbrev=0");
  } catch {
    since = null;
  }
  let log = "";
  try {
    log = git("log", since ? `${since}..HEAD` : "HEAD", "--format=%B%x1e");
  } catch {
    log = "";
  }
  const commits = log.split("\x1e").map((c) => c.trim()).filter(Boolean);
  if (commits.length === 0) return null;
  const subject = (c) => c.split("\n", 1)[0];
  const breaking = commits.some((c) => /^[a-z]+(\([^)]*\))?!:/i.test(subject(c)) || /^BREAKING[ -]CHANGE:/m.test(c));
  const feat = commits.some((c) => /^feat(\([^)]*\))?:/i.test(subject(c)));
  return { kind: breaking ? "major" : feat ? "minor" : "patch", since, count: commits.length };
}

// ---------- resolve the target version (always a FREE one) ----------
const taken = takenVersions();
const highestTaken = [...taken].sort(cmpSemver).at(-1) ?? null;
// Move forward past everything ever used (tags + published + burned).
const base = highestTaken && cmpSemver(highestTaken, current) > 0 ? highestTaken : current;

let target;
let note = "";
if (asIdx !== -1) {
  target = bumpVersion(base, args[asIdx + 1]);
} else if (positional) {
  target = positional;
} else if (!taken.has(base)) {
  target = base; // never released → release as-is (e.g. a fresh reset to 1.0.0)
  note = `${base} was never released — releasing as-is`;
} else {
  // Auto: bump kind from the commits since the last tag; default to patch when
  // there are none (you still asked to release — the y/n prompt is the gate).
  const d = detectBump();
  const kind = d?.kind ?? "patch";
  target = bumpVersion(base, kind);
  note = `${kind} bump from ${base}${base !== current ? ` (highest ever used; package.json was ${current})` : ""}, ${d ? `${d.count} commit(s)` : "no new commits"}`;
}
if (!SEMVER.test(target)) die(`"${target}" is not a valid X.Y.Z version`);

// Never land on a taken version (a tag, a published version, or a burned npm
// version) — patch-increment until free. This is what stops the E400.
const skipped = [];
while (taken.has(target)) {
  skipped.push(target);
  target = bumpVersion(target, "patch");
}
if (skipped.length) note += `${note ? "; " : ""}skipped already-used ${skipped.join(", ")}`;

const tag = target;
const isBump = target !== current;

// ---------- preconditions ----------
if (!dryRun && git("status", "--porcelain")) {
  die("working tree is not clean — commit or stash first so the release commit is only the version bump");
}

/** Replace an anchored version string in a file (logs in dry-run, writes otherwise). */
function bumpFile(rel, re, label) {
  const p = path.join(ROOT, rel);
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return void console.warn(`  · skip ${rel} (not found)`);
  }
  if (!re.test(text)) return void console.warn(`  · skip ${rel} (${label} version line not found)`);
  if (dryRun) console.log(`  · ${rel} → ${target}`);
  else fs.writeFileSync(p, text.replace(re, (_m, pre) => `${pre}${target}`));
}
function bumpAllFiles() {
  bumpFile("package.json", /^(  "version":\s*")[^"]+/m, "package.json");
  bumpFile("gui/package.json", /^(  "version":\s*")[^"]+/m, "gui/package.json");
  bumpFile("gui/src-tauri/tauri.conf.json", /^(  "version":\s*")[^"]+/m, "tauri.conf.json");
  bumpFile("gui/src-tauri/Cargo.toml", /^(version = ")[^"]+/m, "Cargo.toml");
  bumpFile("gui/src-tauri/Cargo.lock", /(name = "agent-switch-gui"\nversion = ")[^"]+/, "Cargo.lock");
}

/** y/n prompt (agent-config style). --yes / --dry-run skip it; a non-TTY (piped)
 *  proceeds so automation isn't blocked. */
async function confirm(question) {
  if (assumeYes || !process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes";
}

// ---------- plan → confirm → release ----------
console.log(`${dryRun ? "[dry-run] " : ""}release: ${current} → ${target}  (tag ${tag}${isBump ? "" : ", as-is"})${note ? `\n  ${note}` : ""}`);

if (dryRun) {
  if (isBump) bumpAllFiles();
  console.log("[dry-run] nothing written, no tag, no push.");
  process.exit(0);
}

if (!(await confirm(`Release ${tag}${noPush ? " (local only)" : " and push → npm publish + installers"}?`))) {
  console.log("Aborted — nothing changed.");
  process.exit(0);
}

if (isBump) {
  bumpAllFiles();
  // Resync package-lock.json with the bumped package.json so CI `npm ci` stays happy.
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: ROOT, stdio: "ignore" });
  git("add", "package.json", "package-lock.json", "gui/package.json", "gui/src-tauri/tauri.conf.json", "gui/src-tauri/Cargo.toml", "gui/src-tauri/Cargo.lock");
  git("commit", "-m", `chore(release): ${tag}`);
} else {
  console.log(`  · tagging ${current} as-is (no version bump)`);
}
git("tag", tag);
console.log(`✅  tagged ${tag}`);

if (noPush) {
  console.log(`--no-push: stopped at the local tag. To release it: git push origin HEAD ${tag}`);
} else {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  git("push", "origin", branch);
  git("push", "origin", tag);
  console.log(`✅  pushed ${branch} + ${tag} — CI is now publishing to npm and building the installers.`);
}
