import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readClaudePreview,
  readCodexPreview,
  readPreview,
  extractText,
  cleanText,
  headLines,
  PREVIEW_MAX_MESSAGES,
} from "../src/session-preview.js";

function writeTranscript(lines: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-preview-"));
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

const userLine = (content: unknown) => ({ type: "user", message: { role: "user", content } });
const asstLine = (content: unknown) => ({ type: "assistant", message: { role: "assistant", content } });

test("extractText: string passthrough and text-block join, tool blocks ignored", () => {
  assert.equal(extractText("hello"), "hello");
  assert.equal(
    extractText([
      { type: "text", text: "a" },
      { type: "tool_use", name: "Bash", input: {} },
      { type: "text", text: "b" },
    ]),
    "a\nb",
  );
  assert.equal(extractText([{ type: "tool_result", content: "x" }]), ""); // no text blocks
  assert.equal(extractText(undefined), "");
});

test("cleanText strips slash-command + system-reminder envelopes, collapses whitespace", () => {
  assert.equal(cleanText("<command-name>/statusline</command-name>  configure it"), "/statusline configure it");
  assert.equal(cleanText("keep <system-reminder>SECRET machine text</system-reminder> this"), "keep this");
  assert.equal(cleanText("  spaced   out \n text "), "spaced out text");
});

test("readClaudePreview extracts the first user + assistant turns with roles", () => {
  const file = writeTranscript([
    { type: "last-prompt", leafUuid: "x" }, // meta — skipped
    userLine("first question"),
    asstLine([{ type: "text", text: "the answer" }]),
  ]);
  const p = readClaudePreview(file);
  assert.ok(p);
  assert.deepEqual(p!.messages, [
    { role: "user", text: "first question" },
    { role: "assistant", text: "the answer" },
  ]);
  assert.equal(p!.truncated, false);
});

test("tool-result-only user turns and tool_use-only assistant turns are skipped", () => {
  const file = writeTranscript([
    userLine([{ type: "tool_result", tool_use_id: "t1", content: "cmd output" }]), // no visible text
    asstLine([{ type: "tool_use", name: "Bash", input: {} }]), // no visible text
    userLine("real words"),
  ]);
  const p = readClaudePreview(file);
  assert.ok(p);
  assert.equal(p!.messages.length, 1);
  assert.deepEqual(p!.messages[0], { role: "user", text: "real words" });
});

test("caps at PREVIEW_MAX_MESSAGES and flags truncated when more turns exist", () => {
  const lines: object[] = [];
  for (let i = 0; i < PREVIEW_MAX_MESSAGES + 3; i++) lines.push(userLine(`msg ${i}`));
  const p = readClaudePreview(writeTranscript(lines));
  assert.ok(p);
  assert.equal(p!.messages.length, PREVIEW_MAX_MESSAGES);
  assert.equal(p!.truncated, true);
});

test("per-message text is truncated to the cap with an ellipsis and flags truncated", () => {
  const long = "x".repeat(500);
  const p = readClaudePreview(writeTranscript([userLine(long)]), { textCap: 20 });
  assert.ok(p);
  assert.equal(p!.messages[0].text.length, 21); // 20 chars + "…"
  assert.ok(p!.messages[0].text.endsWith("…"));
  assert.equal(p!.truncated, true);
});

test("a transcript with no conversational turns degrades to null", () => {
  const file = writeTranscript([
    { type: "mode", mode: "default" },
    { type: "file-history-snapshot", messageId: "m" },
    userLine([{ type: "tool_result", content: "only tools here" }]),
  ]);
  assert.equal(readClaudePreview(file), null);
});

test("malformed lines are fenced (skipped), not thrown", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-preview-bad-"));
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(file, `{not json\n${JSON.stringify(userLine("survives"))}\n`);
  const p = readClaudePreview(file);
  assert.ok(p);
  assert.deepEqual(p!.messages, [{ role: "user", text: "survives" }]);
});

test("missing file degrades to null, never throws", () => {
  assert.equal(readClaudePreview("/no/such/transcript.jsonl"), null);
});

test("headLines caps the read and drops the partial trailing line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-preview-head-"));
  const file = path.join(dir, "big.jsonl");
  // Three 100-byte lines; a 250-byte cap reaches into the third → it is partial, dropped.
  const line = (n: number) => JSON.stringify({ n, pad: "y".repeat(80) });
  fs.writeFileSync(file, [line(1), line(2), line(3)].join("\n") + "\n");
  const { lines, capped } = headLines(file, 250);
  assert.equal(capped, true);
  assert.ok(lines.length >= 1 && lines.length <= 2); // partial last line dropped
  for (const l of lines) JSON.parse(l); // every returned line is complete + parseable
});

test("codex preview is deferred (null by construction) and the dispatcher honors it", () => {
  const file = writeTranscript([userLine("would-be preview")]);
  assert.equal(readCodexPreview(file), null);
  assert.equal(readPreview("codex", file), null);
  assert.ok(readPreview("claude", file)); // claude path still works through the dispatcher
});
