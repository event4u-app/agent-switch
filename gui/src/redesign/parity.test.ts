import { describe, expect, it } from "vitest";
import parity from "./PARITY.md?raw";
import self from "./parity.test.ts?raw";

// PARITY.md is a set of claims about the tree: where each classic behaviour and
// each classic ipc export lives now. Read through Vite, not node:fs — CI installs
// inside gui/ only, without @types/node.
const RAW = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const FILES = new Map(Object.entries(RAW).map(([p, text]) => [p.slice("/src/".length), text]));
// A glob leaves out the file it is in; a journey may name a test in this one.
FILES.set("redesign/parity.test.ts", self);
const SOURCES = [...FILES].filter(([p]) => !/\.test\.tsx?$/.test(p));

/** Code without comments, so a name in a doc comment is not a use. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function uses(path: string, name: string): boolean {
  const text = FILES.get(path);
  return text !== undefined && new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(code(text));
}

/** A path as PARITY writes it (relative to gui/src, `engines/` and `screens/`
 *  short for the redesign's) → the file in the tree, or null. */
function resolve(p: string): string | null {
  for (const c of [p, `redesign/${p}`]) if (FILES.has(c)) return c;
  return null;
}

const isPath = (s: string) => /\.tsx?$/.test(s);
const isIdent = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s);
const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** The table rows of one `## ` section, split into cells (a `|` inside backticks stays). */
function section(title: string): string[][] {
  const body = parity.split(/^## /m).find((s) => s.startsWith(title));
  if (!body) throw new Error(`PARITY.md has no section "${title}"`);
  return body
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => {
      const cells: string[] = [];
      let cur = "";
      let inTick = false;
      for (const ch of l.slice(1, l.trimEnd().length - 1)) {
        if (ch === "`") inTick = !inTick;
        if (ch === "|" && !inTick) {
          cells.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    });
}

/** The files a "Reached from" cell names as direct callers: per `;` segment, the
 *  paths before the first `→` and before any "via" (those reach it indirectly). */
function directCallers(cell: string): string[] {
  return cell.split(";").flatMap((seg) => ticks(seg.split("→")[0].split(/\bvia\b/)[0]).filter(isPath));
}

const exportsRows = section("ipc.ts exports").filter(([names]) => !names.startsWith("Types"));
const ipcCode = code(FILES.get("ipc.ts") ?? "");
const exported = (name: string) => new RegExp(`^export (async )?(function|const|let|class) ${name}\\b`, "m").test(ipcCode);

describe("PARITY.md: every classic ipc export", () => {
  it("parses the table", () => {
    expect(exportsRows.length).toBeGreaterThan(60);
  });

  it("still exists in ipc.ts under the name PARITY gives it", () => {
    const stale = exportsRows.flatMap(([names]) => ticks(names)).filter((n) => !exported(n));
    expect(stale).toEqual([]);
  });

  it("is used by every file named as its direct caller, and every named file exists", () => {
    const wrong: string[] = [];
    for (const [names, reached] of exportsRows) {
      const exps = ticks(names);
      for (const p of directCallers(reached)) {
        const f = resolve(p);
        if (!f) wrong.push(`${exps.join(",")}: ${p} does not exist`);
        else if (!exps.some((e) => uses(f, e))) wrong.push(`${exps.join(",")}: ${f} does not use it`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("marked unreachable (—) is called by no window code", () => {
    const reached: string[] = [];
    for (const [names, where] of exportsRows) {
      if (where !== "—") continue;
      for (const e of ticks(names)) {
        for (const [p] of SOURCES) if (p !== "ipc.ts" && uses(p, e)) reached.push(`${e} ← ${p}`);
      }
    }
    expect(reached).toEqual([]);
  });

  it("reached only from a module no window starts stays that way", () => {
    // acEnsure / acApi live in ac-keepalive.ts, and nothing starts the keepalive.
    const starters = SOURCES.filter(([p]) => p !== "ac-keepalive.ts" && uses(p, "startKeepalive")).map(([p]) => p);
    expect(starters).toEqual([]);
  });
});

describe("PARITY.md: every background engine", () => {
  const rows = section("Background engines");

  it("parses the table", () => {
    expect(rows.length).toBeGreaterThan(15);
  });

  it("lives in the files it names, and they hold the functions it names", () => {
    const wrong: string[] = [];
    for (const [behaviour, home] of rows) {
      const paths = ticks(home).filter(isPath);
      const files = paths.map((p) => resolve(p));
      paths.forEach((p, i) => !files[i] && wrong.push(`${behaviour.slice(0, 40)}: ${p} does not exist`));
      for (const fn of ticks(home).filter(isIdent)) {
        if (!files.some((f) => f && uses(f, fn))) wrong.push(`${behaviour.slice(0, 40)}: ${fn} not in ${paths.join(", ")}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("PARITY.md: the classic tree", () => {
  const rows = section("Deleted with the classic tree");

  it("is gone, and the tests that replace it exist", () => {
    const wrong: string[] = [];
    for (const [deleted, covered] of rows) {
      for (const p of ticks(deleted).filter(isPath)) if (resolve(p)) wrong.push(`${p} still exists`);
      for (const t of ticks(covered).filter((s) => /\.test\.tsx?$/.test(s) && !s.includes("*"))) {
        const hit = [...FILES.keys()].some((f) => f === t || f.endsWith(`/${t}`));
        if (!hit) wrong.push(`${t} (covering ${deleted}) does not exist`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("PARITY.md: the gaps closed are journeys with a test each", () => {
  const body = parity.split(/^## /m).find((s) => s.startsWith("Gaps closed")) ?? "";
  const gaps = body.split("\n").filter((l) => l.startsWith("- **"));

  it("names a test for every journey, and that test exists", () => {
    expect(gaps.length).toBeGreaterThan(3);
    const wrong: string[] = [];
    for (const g of gaps) {
      const refs = [...g.matchAll(/test: `([^`]+\.test\.tsx?)` › "([^"]+)"/g)];
      if (refs.length === 0) wrong.push(`no test named: ${g.slice(0, 50)}`);
      for (const [, file, title] of refs) {
        const text = FILES.get(file);
        if (!text) wrong.push(`${file} does not exist`);
        else if (!text.includes(`"${title}"`)) wrong.push(`${file} has no test "${title}"`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
