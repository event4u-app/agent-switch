import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-follow-"));
process.env.AGENT_SWITCH_HOME = HOME;
const F = await import("../src/follow.js");
type RunState = "running" | "closed" | "unknown";

const write = (file: string, body: string | object) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
};
const read = (file: string) => fs.readFileSync(file, "utf8");
const json = (file: string) => JSON.parse(read(file));

function installed(dir: string, plugins: Record<string, { version: string; sha?: string; scope?: string }>) {
  write(path.join(dir, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: Object.fromEntries(Object.entries(plugins).map(([id, p]) => [id, [{ scope: p.scope ?? "user", version: p.version, gitCommitSha: p.sha ?? `sha-${p.version}` }]])),
  });
}
function markets(dir: string, names: Record<string, string>) {
  write(path.join(dir, "plugins", "known_marketplaces.json"), Object.fromEntries(Object.entries(names).map(([n, repo]) => [n, { source: { source: "github", repo } }])));
}

/** A machine in a temp dir: a default ~/.claude, profiles, a Desktop default,
 *  and a fake `claude plugin` that installs from `catalog` (id → version). */
function makeEnv(profiles: string[], catalog: Record<string, string> = {}, fail: (args: string[]) => boolean = () => false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-follow-world-"));
  const calls: string[][] = [];
  const running = new Map<string, RunState>();
  const claudeDir = (p: string) => path.join(root, "claude", p, "config");
  for (const p of profiles) fs.mkdirSync(claudeDir(p), { recursive: true });
  const env = {
    root,
    claudeHome: path.join(root, "home", ".claude"),
    desktopDefault: path.join(root, "home", "Desktop"),
    profiles,
    claudeDir,
    desktopDir: (p: string) => path.join(root, "claude", p, "gui", "claude-desktop"),
    runState: (d: string) => running.get(d) ?? "closed",
    now: () => new Date("2026-11-11T12:00:00Z"),
    claude: (dir: string, args: string[]) => {
      calls.push([path.basename(path.dirname(dir)), ...args]);
      if (fail(args)) return { ok: false, out: "network down" };
      const file = path.join(dir, "plugins", "installed_plugins.json");
      const cur = fs.existsSync(file) ? json(file) : { version: 2, plugins: {} };
      const [verb, id] = args;
      if (verb === "marketplace" && args[1] === "add") {
        const mf = path.join(dir, "plugins", "known_marketplaces.json");
        const m = fs.existsSync(mf) ? json(mf) : {};
        const name = Object.keys(catalog).map((x) => x.slice(x.lastIndexOf("@") + 1)).find((n) => args[2].endsWith(n)) ?? args[2];
        m[name] = { source: { source: "github", repo: args[2] } };
        write(mf, m);
      }
      if (verb === "install" || verb === "update") cur.plugins[id] = [{ scope: "user", version: catalog[id], gitCommitSha: `sha-${catalog[id]}` }];
      if (verb === "uninstall") delete cur.plugins[id];
      if (verb !== "marketplace") write(file, cur);
      return { ok: true, out: "" };
    },
  };
  return { env, calls, running };
}

test("rules follow the source file by file: new ones arrive, removed ones go, a target's own stay", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tree-src-"));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tree-dst-"));
  write(path.join(src, "a.md"), "a1");
  write(path.join(src, "sub", "b.md"), "b1");
  write(path.join(dst, "own.md"), "mine");
  write(path.join(dst, "sub", "b.md"), "b-target");

  const first = F.syncTree(src, dst, {});
  assert.equal(read(path.join(dst, "a.md")), "a1");
  assert.equal(read(path.join(dst, "sub", "b.md")), "b-target", "a same-named file the target had on its own stays");
  assert.deepEqual(first.kept, [path.join("sub", "b.md")]);
  assert.deepEqual(Object.keys(first.owned), ["a.md"]);

  write(path.join(src, "a.md"), "a2");
  write(path.join(src, "c.md"), "c1");
  const second = F.syncTree(src, dst, first.owned);
  assert.equal(read(path.join(dst, "a.md")), "a2");
  assert.equal(read(path.join(dst, "c.md")), "c1");

  // An editor that saves by rename replaces the link with a file of the target's own.
  fs.rmSync(path.join(dst, "c.md"));
  write(path.join(dst, "c.md"), "edited in target");
  write(path.join(src, "c.md"), "c2");
  const third = F.syncTree(src, dst, second.owned);
  assert.equal(read(path.join(dst, "c.md")), "c2", "a followed file follows the source");
  assert.equal(read(path.join(dst, "c.md.pre-follow")), "edited in target", "the target's edit is kept once");

  fs.rmSync(path.join(src, "a.md"));
  const fourth = F.syncTree(src, dst, third.owned);
  assert.deepEqual(fourth.changed, ["-a.md"]);
  assert.equal(fs.existsSync(path.join(dst, "a.md")), false, "a file the source removed goes");
  assert.throws(() => fs.lstatSync(path.join(dst, "a.md")), "no dangling link is left behind");
  assert.equal(read(path.join(dst, "own.md")), "mine");
});

test("a followed rule is one file on disk: the target holds a link, so the host never loads it twice", { skip: process.platform === "win32" }, () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "asw-link-src-"));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "asw-link-dst-"));
  write(path.join(src, "a.md"), "a1");
  write(path.join(src, "sub", "b.md"), "b1");

  const first = F.syncTree(src, dst, {});
  for (const rel of ["a.md", path.join("sub", "b.md")]) {
    assert.equal(fs.lstatSync(path.join(dst, rel)).isSymbolicLink(), true, `${rel} is a link`);
    assert.equal(fs.realpathSync(path.join(dst, rel)), fs.realpathSync(path.join(src, rel)));
  }
  assert.deepEqual(F.syncTree(src, dst, first.owned).changed, [], "a tree in step is left alone");

  write(path.join(src, "a.md"), "a2");
  const afterEdit = F.syncTree(src, dst, first.owned);
  assert.equal(read(path.join(dst, "a.md")), "a2", "the link shows the source's new content at once");
  assert.deepEqual(afterEdit.changed, []);
});

test("copies an earlier version left behind become links, an edited one is kept once", { skip: process.platform === "win32" }, () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "asw-mig-src-"));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "asw-mig-dst-"));
  const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
  write(path.join(src, "same.md"), "s1");
  write(path.join(src, "stale.md"), "new");
  write(path.join(src, "edited.md"), "e1");
  write(path.join(dst, "same.md"), "s1");
  write(path.join(dst, "stale.md"), "old");
  write(path.join(dst, "edited.md"), "by hand");
  write(path.join(dst, "own.md"), "mine");

  const r = F.syncTree(src, dst, { "same.md": sha("s1"), "stale.md": sha("old"), "edited.md": sha("e0") });

  for (const rel of ["same.md", "stale.md", "edited.md"]) assert.equal(fs.lstatSync(path.join(dst, rel)).isSymbolicLink(), true, `${rel} is a link`);
  assert.equal(read(path.join(dst, "stale.md")), "new");
  assert.equal(read(path.join(dst, "edited.md.pre-follow")), "by hand");
  assert.equal(fs.existsSync(path.join(dst, "stale.md.pre-follow")), false, "an untouched copy needs no backup");
  assert.equal(fs.lstatSync(path.join(dst, "own.md")).isSymbolicLink(), false);
  assert.deepEqual(r.changed.sort(), ["edited.md", "same.md", "stale.md"]);
  assert.equal(read(path.join(src, "edited.md")), "e1", "the source is never written through a link");
});

test("a Claude profile gets the source's settings, rules, links and plugins; its own plugin stays", () => {
  const { env, calls } = makeEnv(["A"], { "agent-config@event4u": "2.0.0", "lsp@official": "1.0.0" });
  write(path.join(env.claudeHome, "settings.json"), { model: "opus", hooks: { Stop: [] } });
  write(path.join(env.claudeHome, "rules", "r.md"), "rule");
  fs.mkdirSync(path.join(env.claudeHome, "skills", "s"), { recursive: true });
  installed(env.claudeHome, { "agent-config@event4u": { version: "2.0.0" } });
  markets(env.claudeHome, { event4u: "event4u-app/agent-config" });
  const A = env.claudeDir("A");
  write(path.join(A, "settings.json"), { theme: "dark" });
  installed(A, { "lsp@official": { version: "1.0.0" } });
  markets(A, { official: "anthropics/official" });

  const r = F.syncAll(env);

  const t = r.targets.find((x) => x.key === "claude/A")!;
  assert.equal(t.state, "applied", t.detail);
  assert.deepEqual(json(path.join(A, "settings.json")).model, "opus");
  assert.equal(json(path.join(A, "settings.json")).theme, "dark");
  assert.equal(read(path.join(A, "rules", "r.md")), "rule");
  assert.equal(fs.lstatSync(path.join(A, "skills")).isSymbolicLink(), true);
  const plugins = json(path.join(A, "plugins", "installed_plugins.json")).plugins;
  assert.deepEqual(Object.keys(plugins).sort(), ["agent-config@event4u", "lsp@official"]);
  assert.deepEqual(calls, [["A", "marketplace", "add", "event4u-app/agent-config"], ["A", "install", "agent-config@event4u"]]);
});

test("plugins are replayed only when the source's change: an AC update reaches every profile once", () => {
  const catalog = { "agent-config@event4u": "2.0.0" };
  const { env, calls } = makeEnv(["A", "B"], catalog);
  installed(env.claudeHome, { "agent-config@event4u": { version: "2.0.0" } });
  markets(env.claudeHome, { event4u: "event4u-app/agent-config" });
  F.syncAll(env);
  const before = calls.length;

  F.syncAll(env);
  assert.equal(calls.length, before, "nothing changed in the source: no `claude plugin` call");

  catalog["agent-config@event4u"] = "2.1.0";
  installed(env.claudeHome, { "agent-config@event4u": { version: "2.1.0" } });
  const r = F.syncAll(env);
  for (const p of ["A", "B"]) {
    assert.equal(json(path.join(env.claudeDir(p), "plugins", "installed_plugins.json")).plugins["agent-config@event4u"][0].version, "2.1.0");
    assert.equal(r.targets.find((x) => x.key === `claude/${p}`)!.state, "applied");
  }
  assert.deepEqual(calls.slice(before).filter((c) => c[1] === "update").map((c) => c[0]), ["A", "B"]);
});

test("a plugin the source drops is uninstalled only where agent-switch installed it", () => {
  const { env, calls } = makeEnv(["A", "B"], { "x@m": "1.0.0" });
  installed(env.claudeHome, { "x@m": { version: "1.0.0" } });
  markets(env.claudeHome, { m: "org/m" });
  installed(env.claudeDir("B"), { "x@m": { version: "1.0.0" } }); // B had it before following
  markets(env.claudeDir("B"), { m: "org/m" });
  F.syncAll(env);

  installed(env.claudeHome, {});
  F.syncAll(env);
  assert.deepEqual(Object.keys(json(path.join(env.claudeDir("A"), "plugins", "installed_plugins.json")).plugins), []);
  assert.deepEqual(Object.keys(json(path.join(env.claudeDir("B"), "plugins", "installed_plugins.json")).plugins), ["x@m"]);
  assert.deepEqual(calls.filter((c) => c[1] === "uninstall"), [["A", "uninstall", "x@m"]]);
});

test("with confirmation on, a new plugin waits for approval while updates still go through", () => {
  const catalog = { "old@m": "1.1.0", "new@m": "1.0.0" };
  const { env } = makeEnv(["A"], catalog);
  markets(env.claudeHome, { m: "org/m" });
  markets(env.claudeDir("A"), { m: "org/m" });
  installed(env.claudeDir("A"), { "old@m": { version: "1.0.0" } });
  installed(env.claudeHome, { "old@m": { version: "1.1.0" }, "new@m": { version: "1.0.0" } });
  F.setConfirmNew(true, env.root);

  let t = F.syncAll(env).targets.find((x) => x.key === "claude/A")!;
  assert.equal(t.state, "pending-approval");
  let plugins = json(path.join(env.claudeDir("A"), "plugins", "installed_plugins.json")).plugins;
  assert.equal(plugins["old@m"][0].version, "1.1.0");
  assert.equal(plugins["new@m"], undefined);

  assert.deepEqual(F.approve("claude/A", env.root), ["claude/A plugin:new@m"]);
  t = F.syncAll(env).targets.find((x) => x.key === "claude/A")!;
  assert.equal(t.state, "applied", t.detail);
  plugins = json(path.join(env.claudeDir("A"), "plugins", "installed_plugins.json")).plugins;
  assert.equal(plugins["new@m"][0].version, "1.0.0");
});

test("a failed install is reported and tried again on the next sync", () => {
  let down = true;
  const { env, calls } = makeEnv(["A"], { "x@m": "1.0.0" }, (args) => down && args[0] === "install");
  installed(env.claudeHome, { "x@m": { version: "1.0.0" } });
  markets(env.claudeHome, { m: "org/m" });
  const t = F.syncAll(env).targets.find((x) => x.key === "claude/A")!;
  assert.equal(t.state, "failed");
  assert.match(t.detail, /network down/);

  down = false;
  assert.equal(F.syncAll(env).targets.find((x) => x.key === "claude/A")!.state, "applied");
  assert.equal(calls.filter((c) => c[1] === "install").length, 2);
});

test("a version the marketplace cannot match is reported as differs, not as in step", () => {
  const { env } = makeEnv(["A"], { "x@m": "1.2.0" }); // the marketplace only serves 1.2.0
  installed(env.claudeHome, { "x@m": { version: "1.0.0" } });
  markets(env.claudeHome, { m: "org/m" });
  const t = F.syncAll(env).targets.find((x) => x.key === "claude/A")!;
  assert.equal(t.state, "differs");
  assert.match(t.detail, /x@m 1\.2\.0 \(source 1\.0\.0\)/);
});

test("a profile shared from another follows that profile, which is brought up to date first", () => {
  const { env } = makeEnv(["A", "B"]);
  write(path.join(env.claudeHome, "rules", "r.md"), "from default");
  write(path.join(env.claudeDir("A"), "rules", "own.md"), "A only");
  F.setRelation("claude", "B", { source: "A" }, env.root);

  F.syncAll(env);
  assert.equal(read(path.join(env.claudeDir("B"), "rules", "r.md")), "from default", "B sees what A got from the default in the same run");
  assert.equal(read(path.join(env.claudeDir("B"), "rules", "own.md")), "A only");
});

test("a cycle is refused instead of looping", () => {
  const { env } = makeEnv(["A", "B"]);
  fs.mkdirSync(env.claudeHome, { recursive: true });
  F.setRelation("claude", "A", { source: "B" }, env.root);
  F.setRelation("claude", "B", { source: "A" }, env.root);
  const r = F.syncAll(env);
  for (const k of ["claude/A", "claude/B"]) assert.equal(r.targets.find((x) => x.key === k)!.state, "failed");
  assert.throws(() => F.setRelation("claude", "A", { source: "A" }, env.root), /cannot follow itself/);
});

test("no ~/.claude and no regular Desktop yet: nothing to pass on, and nothing reported as failed", () => {
  const { env, calls } = makeEnv(["A"]);
  fs.mkdirSync(env.desktopDir("A"), { recursive: true });
  const r = F.syncAll(env);
  assert.deepEqual(r.targets.map((x) => [x.key, x.state]), [["claude/A", "applied"], ["claude-desktop/A", "applied"]]);
  assert.deepEqual(calls, []);
  F.setRelation("claude", "A", { source: "gone" }, env.root);
  assert.equal(F.syncAll(env).targets.find((x) => x.key === "claude/A")!.state, "failed", "a source profile that is gone is a fault");
});

test("an unfollowed profile is left alone", () => {
  const { env } = makeEnv(["A"]);
  write(path.join(env.claudeHome, "rules", "r.md"), "x");
  F.setRelation("claude", "A", { enabled: false }, env.root);
  assert.equal(F.syncAll(env).targets.find((x) => x.key === "claude/A")!.state, "off");
  assert.equal(fs.existsSync(path.join(env.claudeDir("A"), "rules")), false);
});

test("a share link's source is the inferred source of a profile with no recorded relation", () => {
  const { env } = makeEnv(["A", "B"]);
  fs.mkdirSync(path.join(env.claudeDir("A"), "skills"), { recursive: true });
  fs.symlinkSync(path.join(env.claudeDir("A"), "skills"), path.join(env.claudeDir("B"), "skills"));
  write(path.join(env.claudeDir("B"), ".agent-switch-shared.json"), { links: ["skills"], tool: "agent-switch" });
  assert.equal(F.relationOf(F.readFollow(env.root), env, "claude", "B").source, "A");
  assert.equal(F.relationOf(F.readFollow(env.root), env, "claude", "A").source, "default");
});

function desktopSource(dir: string) {
  write(path.join(dir, "claude_desktop_config.json"), { mcpServers: { a: { command: "x" } }, preferences: { sidebarMode: "chat" } });
  write(path.join(dir, "Claude Extensions", "ext1", "manifest.json"), '{"v":1}');
}

test("Claude Desktop waits while its app is open, or might be, and applies once it is closed", () => {
  const { env, running } = makeEnv(["A"]);
  desktopSource(env.desktopDefault);
  const dst = env.desktopDir("A");
  write(path.join(dst, "claude_desktop_config.json"), { preferences: { sidebarMode: "code" } });

  running.set(dst, "running");
  let t = F.syncAll(env).targets.find((x) => x.key === "claude-desktop/A")!;
  assert.equal(t.state, "pending-app-running");
  assert.equal(json(path.join(dst, "claude_desktop_config.json")).preferences.sidebarMode, "code", "nothing written under a running app");

  running.set(dst, "unknown");
  assert.equal(F.syncAll(env).targets.find((x) => x.key === "claude-desktop/A")!.state, "pending-app-running");

  running.set(dst, "closed");
  t = F.syncAll(env).targets.find((x) => x.key === "claude-desktop/A")!;
  assert.equal(t.state, "applied", t.detail);
  assert.deepEqual(json(path.join(dst, "claude_desktop_config.json")).mcpServers, { a: { command: "x" } });
  assert.equal(read(path.join(dst, "Claude Extensions", "ext1", "manifest.json")), '{"v":1}');
  assert.equal(fs.existsSync(path.join(dst, "claude_desktop_config.json.pre-follow")), true);
});

test("Desktop extensions follow entry by entry: updates arrive, a target's own extension stays, dropped ones go", () => {
  const { env } = makeEnv(["A"]);
  desktopSource(env.desktopDefault);
  const dst = env.desktopDir("A");
  write(path.join(dst, "Claude Extensions", "mine", "manifest.json"), "{}");
  F.syncAll(env);

  write(path.join(env.desktopDefault, "Claude Extensions", "ext1", "manifest.json"), '{"v":2}');
  F.syncAll(env);
  assert.equal(read(path.join(dst, "Claude Extensions", "ext1", "manifest.json")), '{"v":2}');

  fs.rmSync(path.join(env.desktopDefault, "Claude Extensions", "ext1"), { recursive: true });
  F.syncAll(env);
  assert.equal(fs.existsSync(path.join(dst, "Claude Extensions", "ext1")), false);
  assert.equal(fs.existsSync(path.join(dst, "Claude Extensions", "mine", "manifest.json")), true);
});

test("a Desktop profile that was never opened gets its settings before its first start", () => {
  const { env } = makeEnv(["A"]);
  desktopSource(env.desktopDefault);
  assert.equal(F.syncAll(env).targets.some((x) => x.key === "claude-desktop/A"), false, "a periodic sync does not create the data dir");
  const r = F.syncDesktopBeforeLaunch("A", env)!;
  assert.equal(r.state, "applied");
  assert.equal(fs.existsSync(path.join(env.desktopDir("A"), "Claude Extensions", "ext1")), true);
});

test("with confirmation on, a new Desktop extension waits for approval", () => {
  const { env } = makeEnv(["A"]);
  desktopSource(env.desktopDefault);
  fs.mkdirSync(env.desktopDir("A"), { recursive: true });
  F.setConfirmNew(true, env.root);
  assert.equal(F.syncAll(env).targets.find((x) => x.key === "claude-desktop/A")!.state, "pending-approval");
  assert.equal(fs.existsSync(path.join(env.desktopDir("A"), "Claude Extensions", "ext1")), false);
  F.approve(null, env.root);
  assert.equal(F.syncAll(env).targets.find((x) => x.key === "claude-desktop/A")!.state, "applied");
  assert.equal(fs.existsSync(path.join(env.desktopDir("A"), "Claude Extensions", "ext1")), true);
});

test("a second sync while one runs does not run, and a registry from a newer agent-switch is never overwritten", () => {
  const { env } = makeEnv(["A"]);
  fs.mkdirSync(path.join(env.root, "follow.json.lock"), { recursive: true });
  assert.equal(F.syncAll(env).ran, false);
  fs.rmSync(path.join(env.root, "follow.json.lock"), { recursive: true });

  write(path.join(env.root, "follow.json"), { schema: 2 });
  assert.throws(() => F.syncAll(env), /newer agent-switch/);
  assert.deepEqual(json(path.join(env.root, "follow.json")), { schema: 2 });
});
