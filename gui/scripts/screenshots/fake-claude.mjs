#!/usr/bin/env node
/**
 * A stand-in `claude -p --input-format stream-json` for the chat harness: each
 * user message replays the recorded stream (tests/fixtures/timeline/
 * claude-stream-2.1.316.jsonl) — partial text, a Write approval that waits for
 * the answer on stdin, the result. Deterministic, offline, no account.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const lines = fs.readFileSync(path.resolve(HERE, "../../../tests/fixtures/timeline/claude-stream-2.1.316.jsonl"), "utf8").split("\n").filter(Boolean);
const session = "5e55a000-0000-4000-8000-000000000001";
const out = (l) => process.stdout.write(l.replace(/"session_id": "[^"]*"/g, `"session_id": "${session}"`) + "\n");
let waiting = null;
let pos = 0;

function play() {
  while (pos < lines.length) {
    const l = lines[pos++];
    out(l);
    if (l.includes('"control_request"')) {
      waiting = JSON.parse(l).request_id;
      return;
    }
  }
}

readline.createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.type === "user") {
    pos = 0;
    play();
  } else if (m.type === "control_response" && m.response?.request_id === waiting) {
    waiting = null;
    setTimeout(play, 150);
  } else if (m.type === "control_request" && m.request?.subtype === "interrupt") {
    out(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "interrupted" }));
  }
}).on("close", () => process.exit(0));
