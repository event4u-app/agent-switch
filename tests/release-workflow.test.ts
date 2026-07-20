import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Compiled to dist-test/tests/, so the repo root is two levels up. These read
// the REAL tracked files (never the compiled copies) — the point is to guard
// the release config a live Actions run would otherwise be the first to catch.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = path.join(REPO, ".github", "workflows", "release.yml");
const TAURI_CONF = path.join(REPO, "gui", "src-tauri", "tauri.conf.json");

const yml = fs.readFileSync(WORKFLOW, "utf8");
const lines = yml.split("\n");

/** apt packages that must never be installed together — the transitional
 *  libappindicator3-dev conflicts with the Ayatana one and breaks apt (the bug
 *  that took the Linux job down). Extend as new incompatibilities surface. */
const APT_CONFLICTS: [string, string][] = [["libappindicator3-dev", "libayatana-appindicator3-dev"]];

/** The three OS runners the release matrix must cover. */
const REQUIRED_RUNNERS = ["macos-latest", "ubuntu-22.04", "windows-latest"];

/** Lines of the "Install Linux bundling dependencies" step, name → next step. */
function linuxAptBlock(): string {
  const start = lines.findIndex((l) => l.includes("Install Linux bundling dependencies"));
  assert.notEqual(start, -1, "release.yml must have an 'Install Linux bundling dependencies' step");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // Next step marker at the 6-space step indentation (`      - uses:` / `- name:`).
    if (/^ {6}- /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("release workflow is present and tab-free (YAML forbids literal tabs)", () => {
  assert.ok(fs.existsSync(WORKFLOW), "release.yml must exist");
  const tabLine = lines.findIndex((l) => l.includes("\t"));
  assert.equal(tabLine, -1, `release.yml line ${tabLine + 1} uses a tab; YAML indentation must be spaces`);
});

test("release triggers on v* tag pushes", () => {
  assert.match(yml, /on:/);
  assert.match(yml, /tags:/, "release must trigger on tag pushes");
  assert.match(yml, /["']v\*["']/, "release must trigger on the v* tag pattern");
});

test("release matrix covers macOS, Linux, and Windows", () => {
  for (const runner of REQUIRED_RUNNERS) {
    assert.ok(yml.includes(runner), `release matrix must include a ${runner} job`);
  }
});

test("release builds via tauri-action from the gui project", () => {
  assert.match(yml, /tauri-apps\/tauri-action@/, "release must build with tauri-action");
  assert.match(yml, /projectPath:\s*gui/, "tauri-action must target the gui/ project");
});

test("Linux apt step installs the Tauri v2 prerequisites", () => {
  const block = linuxAptBlock();
  assert.ok(block.includes("libwebkit2gtk-4.1-dev"), "Linux deps must include libwebkit2gtk-4.1-dev");
  assert.ok(block.includes("libayatana-appindicator3-dev"), "Linux deps must include libayatana-appindicator3-dev");
});

test("Linux apt step never lists a known-conflicting package pair", () => {
  const block = linuxAptBlock();
  for (const [a, b] of APT_CONFLICTS) {
    const both = block.includes(a) && block.includes(b);
    assert.ok(!both, `Linux apt list must not contain both "${a}" and "${b}" — they conflict and break apt`);
  }
});

test("Tauri bundle targets cover every platform (not a mac/windows-only list)", () => {
  const conf = JSON.parse(fs.readFileSync(TAURI_CONF, "utf8"));
  // "all" lets each OS emit its native bundles (incl. Linux deb/rpm/appimage).
  // An explicit array is allowed only if it still carries a Linux target.
  const targets = conf.bundle?.targets;
  if (targets === "all") return;
  assert.ok(Array.isArray(targets), 'bundle.targets must be "all" or an array');
  const linux = ["deb", "rpm", "appimage"].some((t) => targets.includes(t));
  assert.ok(linux, 'bundle.targets array must include a Linux target (deb/rpm/appimage) or be "all"');
});
