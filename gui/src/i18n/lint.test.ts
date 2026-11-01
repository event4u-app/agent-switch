/**
 * Lint: every visible string in the redesign and the ui kit goes through `t()`.
 *
 * Parses each .tsx file under src/redesign and src/ui with the TypeScript
 * compiler and fails on language that is written inline:
 *   - JSX text nodes,
 *   - string-literal JSX attributes, except the non-visible ones below,
 *   - string literals / template text placed directly as JSX children or attribute
 *     expressions (`{"Off"}`, `{on ? "On" : "Off"}`, `` title={`${n} left`} ``),
 *   - visible-named object properties (`toast({ text: "…" })`, `{ label: "…" }`).
 * A string with no letters left after removing the allowed non-language tokens
 * (brand and product names, symbols, numbers) passes.
 */

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Read through Vite (no @types/node in this browser bundle's typecheck).
const SOURCES = import.meta.glob(["../redesign/**/*.tsx", "../ui/**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Attributes whose string value is never shown as language. */
const NON_VISIBLE_ATTRS = new Set([
  "className", "size", "variant", "role", "type", "tone", "id", "htmlFor", "value", "key", "href", "src",
  "fill", "stroke", "strokeWidth", "strokeLinejoin", "strokeLinecap", "strokeDasharray", "vectorEffect",
  "viewBox", "preserveAspectRatio", "opacity", "position", "state", "autoComplete", "inputMode",
  "aria-labelledby", "aria-describedby", "aria-live", "aria-autocomplete", "aria-controls", "aria-haspopup",
  "aria-expanded", "aria-current", "aria-hidden", "data-testid", "name", "target", "rel", "side", "align",
  "orientation", "dir", "lang", "spellCheck", "accept", "pattern", "method", "form", "kind", "provider",
  "icon", "mode", "status", "shape", "dot", "cursor", "transform", "d", "points", "x", "y", "width", "height",
]);

/** Object-literal properties that carry visible copy. */
const VISIBLE_PROPS = new Set([
  "text", "title", "label", "detail", "sub", "kicker", "hint", "description", "placeholder", "ariaLabel",
  "reason", "body", "message", "summary", "actionLabel", "cta", "tip", "tooltip", "empty", "heading", "caption",
]);

/** Non-language tokens: brand/product names, CLI names, units of keyboard UI. */
const ALLOWED_TOKENS = [
  "agent-switch", "agent-config", "Agent Switch", "Claude Code", "Claude Desktop", "Claude", "Codex", "Antigravity",
  "Gemini", "GitHub", "Reddit", "Anthropic", "OpenAI", "ChatGPT", "Google", "macOS", "Windows", "Linux", "Homebrew",
  "brew", "winget", "npm", "npx", "Tauri", "MCP", "CLI", "API", "JSON", "OAuth", "agy", "VS Code", "Cursor",
  "Superset", "iTerm", "Terminal", "Warp", "Ghostty", "WezTerm", "kitty", "tmux", "zsh", "bash", "PATH", "Keychain",
  "⌘", "Esc", "Enter", "Tab", "Shift", "Ctrl", "Alt", "Cmd",
];

function hasLanguage(text: string): boolean {
  let s = text;
  for (const tok of ALLOWED_TOKENS) s = s.split(tok).join(" ");
  // Units and single letters next to numbers ("5m", "2h", "%") are not words.
  s = s.replace(/\b\d+[a-zA-Z]{0,2}\b/g, " ");
  return /[A-Za-zÄÖÜäöüß]{2,}/.test(s);
}

type Finding = { file: string; line: number; text: string };

/** String pieces an expression renders directly (through ?: / && / || / ?? / parens / templates). */
function renderedStrings(e: ts.Expression, out: ts.Node[]): void {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) out.push(e);
  else if (ts.isTemplateExpression(e)) {
    out.push(e.head);
    for (const span of e.templateSpans) out.push(span.literal);
  } else if (ts.isParenthesizedExpression(e)) renderedStrings(e.expression, out);
  else if (ts.isConditionalExpression(e)) {
    renderedStrings(e.whenTrue, out);
    renderedStrings(e.whenFalse, out);
  } else if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) renderedStrings(e.right, out);
    else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) {
      renderedStrings(e.left, out);
      renderedStrings(e.right, out);
    }
  }
}

function textOf(n: ts.Node): string {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) return n.text;
  return n.getText();
}

function scan(file: string, code: string): Finding[] {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const report = (n: ts.Node, text: string) => {
    if (!hasLanguage(text)) return;
    const { line } = src.getLineAndCharacterOfPosition(n.getStart(src));
    found.push({ file: file.replace(/^\.\.\//, ""), line: line + 1, text: text.trim().replace(/\s+/g, " ") });
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) report(n, n.text);
    else if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(src);
      const init = n.initializer;
      if (init && !NON_VISIBLE_ATTRS.has(name) && !name.startsWith("data-")) {
        if (ts.isStringLiteral(init)) report(init, init.text);
        else if (ts.isJsxExpression(init) && init.expression) {
          const parts: ts.Node[] = [];
          renderedStrings(init.expression, parts);
          for (const p of parts) report(p, textOf(p));
        }
      }
    } else if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      const parts: ts.Node[] = [];
      renderedStrings(n.expression, parts);
      for (const p of parts) report(p, textOf(p));
    } else if (ts.isPropertyAssignment(n) && VISIBLE_PROPS.has(n.name.getText(src).replace(/["']/g, ""))) {
      const parts: ts.Node[] = [];
      renderedStrings(n.initializer, parts);
      for (const p of parts) report(p, textOf(p));
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return found;
}

describe("i18n lint", () => {
  it("routes every visible string in redesign/ and ui/ through t()", () => {
    const files = Object.keys(SOURCES);
    expect(files.length).toBeGreaterThan(10);
    const findings = files.flatMap((f) => scan(f, SOURCES[f]!));
    const lines = findings.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`);
    expect(lines, `visible text without t():\n${lines.join("\n")}`).toEqual([]);
  });

  it("catches inline text, attributes and toast copy (self-test)", () => {
    const probe = [
        'export const A = () => <div title="Hover me" className="px-2">Hello there<span>{on ? "On" : "Off"}</span></div>;',
        'export const B = () => toast({ text: "Saved", tone: "ok" });',
        'export const C = () => <b aria-label={t("x")}>{"Claude"} · 5m · Codex</b>;',
      ].join("\n");
    const texts = scan("probe.tsx", probe).map((f) => f.text);
    expect(texts).toEqual(["Hover me", "Hello there", "On", "Off", "Saved"]);
  });
});
