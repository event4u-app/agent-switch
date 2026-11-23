#!/usr/bin/env node
// Generates gui/design-tokens/as-tokens.css (the shadcn `:root` blocks, HSL
// channels) from gui/design-tokens/event4u-agent-tokens.json.
//
// The JSON is vendored verbatim from agent-config's tokens/event4u-agent-tokens.json:
// the shared source lives in that repository and is not published in its npm
// package, so CI cannot read it. Refresh the copy by hand, then regenerate.
// The variable map follows agent-config's tokens/build-as.mjs, so both
// generators turn one source into the same values.
//
//   node scripts/design-tokens.mjs           write the generated file
//   node scripts/design-tokens.mjs --check   regenerate in memory, exit 1 on a diff
//   --source <json> / --out <css>            other paths (tests)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = path.join(REPO, "gui", "design-tokens", "event4u-agent-tokens.json");
const DEFAULT_OUT = path.join(REPO, "gui", "design-tokens", "as-tokens.css");

function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a path`);
  return path.resolve(v);
}

function loadTokens(file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof doc._version !== "number") throw new Error(`${file}: no numeric _version`);
  for (const theme of ["dark", "light"]) {
    if (!doc.color?.[theme]) throw new Error(`${file}: no color.${theme}`);
  }
  return doc;
}

function values(group) {
  const out = {};
  for (const [name, token] of Object.entries(group ?? {})) {
    if (!name.startsWith("$")) out[name] = token.$value;
  }
  return out;
}

function rgbOfHex(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex ?? "");
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

function hexOfRgb(rgb) {
  return "#" + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
}

// A translucent border drawn on a surface, flattened to the opaque colour shadcn needs.
function over(rgba, surfaceHex) {
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(rgba ?? "");
  if (!m) throw new Error(`not an rgba() colour: ${rgba}`);
  const a = Number(m[4]);
  const bg = rgbOfHex(surfaceHex);
  return hexOfRgb([1, 2, 3].map((k, i) => Number(m[k]) * a + bg[i] * (1 - a)));
}

function oneDecimal(x) {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function hslChannels(hex) {
  const [r, g, b] = rgbOfHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${oneDecimal(h * 360)} ${oneDecimal(s * 100)}% ${oneDecimal(l * 100)}%`;
}

// shadcn variable → token, grouped as in gui/src/index.css.
const GROUPS = [
  [["--background", "bg"], ["--foreground", "text"]],
  [["--card", "surface"], ["--card-foreground", "text"]],
  [["--popover", "surface"], ["--popover-foreground", "text"]],
  [["--primary", "accent"], ["--primary-foreground", "accent-fg"]],
  [["--secondary", "surface-hover"], ["--secondary-foreground", "text"]],
  [["--muted", "surface-alt"], ["--muted-foreground", "text-muted"]],
  [["--accent", "surface-hover"], ["--accent-foreground", "text"]],
  [["--destructive", "danger"], ["--destructive-foreground", { dark: "text-inverse", light: "accent-fg" }]],
  [["--success", "success"]],
  [["--warning", "warning"]],
  [["--sidebar", "sidebar"]],
  [["--border", { over: "border" }], ["--input", { over: "border-strong" }], ["--ring", "focus-ring"]],
];

function resolve(source, theme, c) {
  if (typeof source === "string") return { hex: c[source], label: source };
  if (source.over) return { hex: over(c[source.over], c.surface), label: `${source.over} over surface` };
  return { hex: c[source[theme]], label: source[theme] };
}

function block(selector, theme, c, radius) {
  const lines = [`${selector} {`];
  if (theme === "dark") lines.push(`  --radius: ${radius};`, "");
  for (const group of GROUPS) {
    for (const [name, source] of group) {
      const { hex, label } = resolve(source, theme, c);
      lines.push(`  ${name}: ${hslChannels(hex)}; /* ${label} ${hex} */`);
    }
    lines.push("");
  }
  lines.push(`  color-scheme: ${theme};`, "}", "");
  return lines;
}

function render(doc) {
  const radius = values(doc.radius).md;
  if (!radius) throw new Error("no radius.md");
  return [
    "/* GENERATED FILE — do not hand-edit. Regenerate with `node scripts/design-tokens.mjs`.",
    ` * Source: gui/design-tokens/event4u-agent-tokens.json (_version ${doc._version}),`,
    " * vendored from agent-config's tokens/event4u-agent-tokens.json. */",
    "",
    ...block(":root", "dark", values(doc.color.dark), radius),
    ...block(':root[data-theme="light"]', "light", values(doc.color.light), radius),
  ].join("\n");
}

function main() {
  const source = flag("--source") ?? DEFAULT_SOURCE;
  const out = flag("--out") ?? DEFAULT_OUT;
  const generated = render(loadTokens(source));
  const label = path.relative(REPO, out) || out;
  if (!process.argv.includes("--check")) {
    fs.writeFileSync(out, generated, "utf8");
    console.log(`Wrote ${label}`);
    return 0;
  }
  if (!fs.existsSync(out)) {
    console.error(`DRIFT: ${label} is missing — run \`node scripts/design-tokens.mjs\`.`);
    return 1;
  }
  if (fs.readFileSync(out, "utf8") !== generated) {
    console.error(`DRIFT: ${label} differs from ${path.relative(REPO, source) || source} — regenerate it, never hand-edit.`);
    return 1;
  }
  console.log(`OK: ${label} matches its source.`);
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`design-tokens: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 2;
}
