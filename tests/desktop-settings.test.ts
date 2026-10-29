import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-desktop-settings-"));
process.env.AGENT_SWITCH_HOME = HOME;
const D = await import("../src/desktop-settings.js");

test("merging takes MCP servers and preferences, but never account-bound keys or the target's own file path", () => {
  const src = {
    mcpServers: { a: { command: "x" } },
    coworkUserFilesPath: "/src/files",
    preferences: { sidebarMode: "chat", coworkModelAutoFallbackByAccount: { u1: true }, bypassPermissionsGateByAccount: { u1: 1 } },
  };
  const dst = { coworkUserFilesPath: "/dst/files", preferences: { sidebarMode: "code", keptOnlyHere: 1, bypassPermissionsGateByAccount: { u2: 2 } } };
  assert.deepEqual(D.mergeDesktopConfig(src, dst), {
    coworkUserFilesPath: "/dst/files",
    mcpServers: { a: { command: "x" } },
    preferences: { sidebarMode: "chat", keptOnlyHere: 1, bypassPermissionsGateByAccount: { u2: 2 } },
  });
});

test("copying writes the settings files and extensions, backs up what it replaces, and never touches logins", () => {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), "asw-ds-from-"));
  const to = fs.mkdtempSync(path.join(os.tmpdir(), "asw-ds-to-"));
  fs.writeFileSync(path.join(from, "claude_desktop_config.json"), JSON.stringify({ mcpServers: { a: {} }, preferences: { sidebarMode: "chat" } }));
  fs.writeFileSync(path.join(from, "claude_desktop_config.mcp.json"), JSON.stringify({ mcpServers: { b: {} } }));
  fs.mkdirSync(path.join(from, "Claude Extensions", "ext1"), { recursive: true });
  fs.writeFileSync(path.join(from, "Claude Extensions", "ext1", "manifest.json"), "{}");
  fs.writeFileSync(path.join(from, "config.json"), JSON.stringify({ "oauth:tokenCache": "secret" }));
  fs.writeFileSync(path.join(from, "Cookies"), "cookie");
  fs.writeFileSync(path.join(to, "claude_desktop_config.json"), JSON.stringify({ preferences: { sidebarMode: "code" } }));

  const r = D.copyDesktopSettings("claude-desktop", from, to);

  assert.deepEqual(r.copied.sort(), ["Claude Extensions", "claude_desktop_config.json", "claude_desktop_config.mcp.json"]);
  const cfg = JSON.parse(fs.readFileSync(path.join(to, "claude_desktop_config.json"), "utf8"));
  assert.deepEqual(cfg, { mcpServers: { a: {} }, preferences: { sidebarMode: "chat" } });
  assert.ok(fs.existsSync(path.join(to, "Claude Extensions", "ext1", "manifest.json")));
  assert.deepEqual(r.backups.map((b) => path.basename(b)), ["claude_desktop_config.json.pre-copy"]);
  assert.ok(!fs.existsSync(path.join(to, "config.json")));
  assert.ok(!fs.existsSync(path.join(to, "Cookies")));
});

test("only apps with a known settings layout can be copied", () => {
  assert.throws(() => D.copyDesktopSettings("codex-desktop", "/a", "/b"), /no settings layout/);
});
