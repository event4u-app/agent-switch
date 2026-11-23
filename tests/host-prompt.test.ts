import { test } from "node:test";
import assert from "node:assert/strict";

import { promptDraft } from "../src/host/prompt.js";
import { InputLeases, TypeFailed } from "../src/host/lease.js";
import type { TmuxHost } from "../src/host/tmux-host.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DIM = "\x1b[2m";
const UNDIM = "\x1b[22m";
const INV = "\x1b[7m";
const UNINV = "\x1b[27m";

test("promptDraft: an empty input line, and one showing only its dimmed placeholder, are empty", () => {
  assert.deepEqual(promptDraft(["╭──────╮", "│ > ", "╰──────╯", "  ? for shortcuts"].join("\n")), { found: true, draft: "", menu: false });
  assert.deepEqual(promptDraft(["> earlier message", "", "───", `> ${INV}T${UNINV}${DIM}ry "fix lint errors"${UNDIM}`, "───"].join("\n")), { found: true, draft: "", menu: false });
  assert.deepEqual(promptDraft(`› ${DIM}Ask Codex to do anything${UNDIM}\n\n  ⏎ send`), { found: true, draft: "", menu: false });
});

test("promptDraft: text the user typed and left there is a draft, wherever the cursor sits", () => {
  assert.deepEqual(promptDraft(["│ > half a thought" + INV + " " + UNINV + "   │", "╰────╯"].join("\n")), { found: true, draft: "half a thought", menu: false });
  assert.equal(promptDraft(`› fix th${INV}e${UNINV} tests`).draft, "fix the tests", "the character under the cursor is typed too");
  // The bottom-most input line counts; the conversation above it echoes earlier messages.
  assert.equal(promptDraft("> earlier message\n\n> \n").draft, "");
});

const PANES = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/panes/claude-2.1.316.json"), "utf8")) as { screens: Record<string, string[]> };
const pane = (name: string) => PANES.screens[name].join("\n");

test("promptDraft on Claude Code's own panes: the empty input, focused or not, is empty", () => {
  assert.deepEqual(promptDraft(pane("empty-unfocused")), { found: true, draft: "", menu: false });
  assert.deepEqual(promptDraft(pane("empty-focused")), { found: true, draft: "", menu: false });
});

test("promptDraft: one typed character under the cursor is a draft (arena r3 01 F4c)", () => {
  assert.equal(promptDraft(pane("one-char-under-cursor")).draft, "x");
});

test("promptDraft: every line of the input counts, also when the first is empty (arena r3 01 F4b)", () => {
  assert.equal(promptDraft(pane("multi-line-first-empty")).draft, "please also rename the helper and keep the tests green");
});

test("promptDraft: an open permission menu is not a draft; it is a menu waiting for an answer (arena r3 01 F4a)", () => {
  assert.deepEqual(promptDraft(pane("permission-menu")), { found: true, draft: "", menu: true });
});

test("a hosted send at an open permission menu is refused with that reason, and nothing is typed", () => {
  const { host, calls } = fakeHost(pane("permission-menu"));
  assert.throws(() => held("claude/w/s").type(host, "claude/w/s", me, "go on", { enter: true }), (e: unknown) => e instanceof TypeFailed && /waiting for an answer/.test(e.message) && !/draft/.test(e.message));
  assert.deepEqual(calls.filter((c) => c[0] === "send-keys"), []);
});

test("promptDraft: a screen without an input line says so, so nothing is typed blind", () => {
  assert.deepEqual(promptDraft("Compiling…\n$ "), { found: false, draft: "", menu: false });
  assert.deepEqual(promptDraft(""), { found: false, draft: "", menu: false });
});

/** A hosted window stand-in: what tmux shows, and every call made to it. */
function fakeHost(screen: string, fail: string | null = null) {
  const calls: string[][] = [];
  const host = {
    windowOf: () => "@1",
    run: (args: string[]) => {
      calls.push(args);
      if (args[0] === "capture-pane") return { ok: true, out: screen, err: "" };
      return fail && args.includes(fail) ? { ok: false, out: "", err: "can't find pane: @1" } : { ok: true, out: "", err: "" };
    },
  } as unknown as TmuxHost;
  return { host, calls };
}
const me = { id: "cli-1", pid: process.pid, kind: "cli" };
const held = (key: string) => {
  const leases = new InputLeases(fs.mkdtempSync(path.join(os.tmpdir(), "asw-prompt-")));
  leases.acquire(key, me);
  return leases;
};

test("a hosted send never submits a draft the user left in the input: it is refused, nothing is typed", () => {
  const { host, calls } = fakeHost("│ > my own half-written message │");
  assert.throws(() => held("claude/w/s").type(host, "claude/w/s", me, "Continue where you left off.", { enter: true }), (e: unknown) => e instanceof TypeFailed && /your draft is in the way/.test(e.message));
  assert.deepEqual(calls.filter((c) => c[0] === "send-keys"), [], "not a key reaches the window");
});

test("a hosted send whose input line cannot be seen is refused too", () => {
  const { host, calls } = fakeHost("$ ");
  assert.throws(() => held("claude/w/s").type(host, "claude/w/s", me, "go on", { enter: true }), (e: unknown) => e instanceof TypeFailed && /input line/.test(e.message));
  assert.deepEqual(calls.filter((c) => c[0] === "send-keys"), []);
});

test("a hosted send into an empty input types the text literally, then Enter; a failed tmux call is reported", () => {
  const ok = fakeHost(`> ${DIM}Try "refactor"${UNDIM}`);
  held("claude/w/s").type(ok.host, "claude/w/s", me, "go on", { enter: true });
  assert.deepEqual(ok.calls.filter((c) => c[0] === "send-keys"), [["send-keys", "-t", "@1", "-l", "go on"], ["send-keys", "-t", "@1", "Enter"]]);
  const broken = fakeHost("> ", "-l");
  assert.throws(() => held("claude/w/s").type(broken.host, "claude/w/s", me, "go on", { enter: true }), (e: unknown) => e instanceof TypeFailed && /can't find pane/.test(e.message));
  assert.deepEqual(broken.calls.filter((c) => c[0] === "send-keys" && c.includes("Enter")), [], "no Enter after the text failed");
});
