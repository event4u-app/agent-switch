#!/usr/bin/env node
// Assemble a per-platform GUI npm package from the Tauri build output, so the
// desktop app ships via npm (optionalDependencies) and `agent-switch gui` can
// launch it — no browser-downloaded installer, no Gatekeeper/SmartScreen block.
//
//   node scripts/pack-gui-platform.mjs --platform darwin|linux-x64|win32-x64 --out <dir>
//
// Produces <out>/ with a package.json (name @event4u/agent-switch-<platform>,
// os/cpu pinned) and bin/<artifact>. Version is read from the root package.json
// so it stays in lockstep. It is DEFENSIVE: if the expected build artifact is
// not found it prints what it searched + what exists and exits non-zero, so the
// first CI run surfaces the real path instead of publishing an empty package.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};

const platform = arg("platform");
const out = arg("out");
if (!platform || !out) {
  console.error("usage: pack-gui-platform.mjs --platform darwin|linux-x64|win32-x64 --out <dir>");
  process.exit(2);
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const TARGET = path.join(ROOT, "gui", "src-tauri", "target");

// Per-platform: the npm os/cpu constraints, the artifact name inside the
// package (must match gui-launch.ts), and how to find it in the Tauri output.
const SPEC = {
  darwin: { os: ["darwin"], cpu: ["arm64", "x64"], artifact: "agent-switch.app", find: () => findFirst(TARGET, (p, isDir) => isDir && p.endsWith(".app") && p.includes(`${path.sep}bundle${path.sep}macos${path.sep}`)) },
  "win32-x64": { os: ["win32"], cpu: ["x64"], artifact: "agent-switch.exe", find: () => findFirst(TARGET, (p, isDir) => !isDir && /release[\\/][^\\/]*\.exe$/i.test(p) && !/[\\/]deps[\\/]/.test(p) && /agent-switch/i.test(path.basename(p))) },
  "linux-x64": { os: ["linux"], cpu: ["x64"], artifact: "agent-switch", find: () => findFirst(TARGET, (p, isDir) => !isDir && /release[\\/]agent-switch(-gui)?$/.test(p) && isExecutable(p)) },
};

const spec = SPEC[platform];
if (!spec) {
  console.error(`unknown --platform "${platform}" (want darwin | linux-x64 | win32-x64)`);
  process.exit(2);
}

/** Depth-first search under `root` for the first path matching `pred(path, isDir)`. */
function findFirst(root, pred) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (pred(full, e.isDirectory())) return full;
      if (e.isDirectory() && !e.name.endsWith(".app")) stack.push(full);
    }
  }
  return null;
}
function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const src = spec.find();
if (!src) {
  console.error(`pack-gui-platform: could not find the ${platform} artifact under ${TARGET}`);
  console.error("Contents (2 levels):");
  for (const l of shallowList(TARGET, 2)) console.error("  " + l);
  process.exit(1);
}

function shallowList(root, depth) {
  const out = [];
  const walk = (dir, d) => {
    if (d > depth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      out.push(path.relative(ROOT, path.join(dir, e.name)));
      if (e.isDirectory() && !e.name.endsWith(".app")) walk(path.join(dir, e.name), d + 1);
    }
  };
  walk(root, 1);
  return out.slice(0, 40);
}

// Assemble <out>/ : package.json + bin/<artifact>.
const pkgName = `@event4u/agent-switch-${platform}`;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "bin"), { recursive: true });
fs.cpSync(src, path.join(out, "bin", spec.artifact), { recursive: true });
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify(
    {
      name: pkgName,
      version,
      description: `agent-switch desktop GUI binary for ${platform}.`,
      repository: { type: "git", url: "git+https://github.com/event4u-app/agent-switch.git" },
      license: "MIT",
      os: spec.os,
      cpu: spec.cpu,
      files: ["bin/"],
      publishConfig: { access: "public", provenance: true },
    },
    null,
    2,
  ) + "\n",
);
console.log(`packed ${pkgName}@${version} → ${out} (from ${path.relative(ROOT, src)})`);
