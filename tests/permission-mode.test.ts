import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { chatMode, findTranscript, inheritedMode, lastPermissionMode, settingsDefaultMode } from "../src/bridge/permission-mode.js";

function account(): { dir: string; transcript: (lines: object[]) => string; settings: (o: object) => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-pmode-"));
  fs.mkdirSync(path.join(dir, "projects", "-w"), { recursive: true });
  return {
    dir,
    transcript: (lines) => {
      const f = path.join(dir, "projects", "-w", "s1.jsonl");
      fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      return f;
    },
    settings: (o) => fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(o)),
  };
}

test("chatMode: the chat's modes, `manual` as `default`; a mode that skips approvals is never taken over", () => {
  assert.equal(chatMode("auto"), "auto");
  assert.equal(chatMode("plan"), "plan");
  assert.equal(chatMode("manual"), "default");
  assert.equal(chatMode("bypassPermissions"), null);
  assert.equal(chatMode("dontAsk"), null);
  assert.equal(chatMode(undefined), null);
});

test("the mode a chat takes over: the session's newest line, else the account's defaultMode, else default", () => {
  const a = account();
  const t = a.transcript([
    { type: "user", permissionMode: "default" },
    { type: "assistant" },
    { type: "user", permissionMode: "auto" },
    { type: "assistant" },
  ]);
  assert.equal(lastPermissionMode(t), "auto");
  assert.equal(findTranscript(a.dir, "s1"), t);
  assert.equal(findTranscript(a.dir, "nope"), null);
  a.settings({ permissions: { defaultMode: "plan" } });
  assert.equal(inheritedMode(t, a.dir), "auto", "what the session last ran in wins");
  assert.equal(inheritedMode(null, a.dir), "plan", "a new chat: the account's default");
  assert.equal(settingsDefaultMode(a.dir), "plan");
  const bypass = a.transcript([{ type: "user", permissionMode: "bypassPermissions" }]);
  assert.equal(inheritedMode(bypass, a.dir), "plan", "bypass is never taken over");
  a.settings({ permissions: { defaultMode: "bypassPermissions" } });
  assert.equal(inheritedMode(bypass, a.dir), "default");
  assert.equal(inheritedMode(null, path.join(a.dir, "missing")), "default");
});

test("lastPermissionMode reads only the end of a long transcript", () => {
  const a = account();
  const filler = { type: "assistant", text: "x".repeat(2000) };
  const t = a.transcript([{ type: "user", permissionMode: "plan" }, ...Array.from({ length: 600 }, () => filler), { type: "user", permissionMode: "acceptEdits" }]);
  assert.ok(fs.statSync(t).size > 1024 * 1024);
  assert.equal(lastPermissionMode(t), "acceptEdits");
  assert.equal(lastPermissionMode(path.join(a.dir, "gone.jsonl")), null);
  assert.equal(lastPermissionMode(null), null);
});
