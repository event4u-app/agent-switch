import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "scripts", "design-tokens.mjs");
const SOURCE = path.join(REPO, "gui", "design-tokens", "event4u-agent-tokens.json");
const GENERATED = path.join(REPO, "gui", "design-tokens", "as-tokens.css");

function check(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, "--check", ...args], { encoding: "utf8" });
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "as-tokens-"));
}

test("design tokens: the committed file matches the vendored source", () => {
  const r = check();
  assert.equal(r.status, 0, r.stderr);
});

test("design tokens: an unchanged copy of the source passes from any path", () => {
  const copy = path.join(tmp(), "tokens.json");
  fs.copyFileSync(SOURCE, copy);
  const r = check("--source", copy);
  assert.equal(r.status, 0, r.stderr);
});

test("design tokens: a generated file checked out with CRLF line endings is not drift", () => {
  const crlf = path.join(tmp(), "as-tokens.css");
  fs.writeFileSync(crlf, fs.readFileSync(GENERATED, "utf8").replace(/\r?\n/g, "\r\n"));
  const r = check("--out", crlf);
  assert.equal(r.status, 0, r.stderr);
});

test("design tokens: a changed token fails the check and names the file", () => {
  const doc = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  for (const [theme, name] of [["dark", "accent"], ["light", "warning"], ["dark", "border"]] as const) {
    const changed = structuredClone(doc);
    const old: string = changed.color[theme][name].$value;
    changed.color[theme][name].$value = old.startsWith("#") ? "#123456" : "rgba(1, 2, 3, 0.5)";
    const copy = path.join(tmp(), "tokens.json");
    fs.writeFileSync(copy, JSON.stringify(changed, null, 2));
    const r = check("--source", copy);
    assert.equal(r.status, 1, `${theme}.${name} change was not caught`);
    assert.match(r.stderr, /as-tokens\.css/);
  }
});

test("design tokens: a hand-edited or missing generated file fails the check", () => {
  const edited = path.join(tmp(), "as-tokens.css");
  fs.writeFileSync(edited, fs.readFileSync(GENERATED, "utf8").replace("--primary:", "--primary: 0 0% 0%; --x:"));
  assert.equal(check("--out", edited).status, 1);
  assert.equal(check("--out", path.join(tmp(), "absent.css")).status, 1);
});

test("design tokens: a source without a version or a theme is refused", () => {
  const doc = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  delete doc.color.light;
  const copy = path.join(tmp(), "tokens.json");
  fs.writeFileSync(copy, JSON.stringify(doc));
  const r = check("--source", copy);
  assert.notEqual(r.status, 0);
});
