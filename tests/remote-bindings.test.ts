import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-remote-"));
process.env.AGENT_SWITCH_HOME = HOME;
const M = await import("../src/mappings.js");

const hasGit = spawnSync("git", ["--version"]).status === 0;
const gitGate = { skip: hasGit ? false : "git not installed" };

/** A fresh tree: root/projects/<repo>/pkg/app, the repo with `origin` at `url`. */
function tree(url: string | null): { root: string; projects: string; repo: string; deep: string } {
  for (const r of M.mappingRows()) M.removeMapping(r.path);
  for (const r of M.remoteRows()) M.removeRemoteMapping(r.remote);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-rtree-"));
  const projects = path.join(root, "projects");
  const repo = path.join(projects, "widgets");
  const deep = path.join(repo, "pkg", "app");
  fs.mkdirSync(deep, { recursive: true });
  spawnSync("git", ["init", "-q", repo]);
  if (url) spawnSync("git", ["-C", repo, "remote", "add", "origin", url]);
  return { root, projects, repo, deep };
}

test("parseRemote reads scp, https and ssh URLs, with nested groups", () => {
  assert.deepEqual(M.parseRemote("git@github.com:Acme/Widgets.git"), ["github.com", "acme", "widgets"]);
  assert.deepEqual(M.parseRemote("https://user:secret@GitHub.com/acme/widgets"), ["github.com", "acme", "widgets"]);
  assert.deepEqual(M.parseRemote("ssh://git@gitlab.example.com:2222/group/sub/repo.git"), ["gitlab.example.com", "group", "sub", "repo"]);
  assert.equal(M.parseRemote("/srv/git/widgets.git"), null);
  assert.equal(M.parseRemote("https://github.com/"), null);
});

test("normalizeRemoteKey takes host/owner[/repo] or a remote URL, and rejects a bare host", () => {
  assert.equal(M.normalizeRemoteKey("GitHub.com/Acme/"), "github.com/acme");
  assert.equal(M.normalizeRemoteKey("github.com/acme/widgets.git"), "github.com/acme/widgets");
  assert.equal(M.normalizeRemoteKey("git@github.com:acme/widgets.git"), "github.com/acme/widgets");
  assert.equal(M.normalizeRemoteKey("github.com"), null);
  assert.equal(M.normalizeRemoteKey(""), null);
});

test("a remote binding on the owner picks the account anywhere in a matching repo", gitGate, () => {
  const t = tree("git@github.com:acme/widgets.git");
  try {
    M.setRemoteMapping("github.com/acme", "claude", "work");
    const hit = M.resolveMapping(t.deep, "claude");
    assert.equal(hit?.name, "work");
    assert.equal(hit?.remote, "github.com/acme");
    assert.equal(hit?.path, M.normalizePath(t.repo));
    assert.equal(M.resolveMapping(t.deep, "codex"), null, "per provider");
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("the repo binding is the first match over the owner binding", gitGate, () => {
  const t = tree("https://github.com/acme/widgets.git");
  try {
    M.setRemoteMapping("github.com/acme", "claude", "work");
    M.setRemoteMapping("github.com/acme/widgets", "claude", "client");
    assert.equal(M.resolveMapping(t.deep, "claude")?.name, "client");
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("folder before remote at equal depth: a folder rule on the repo root wins", gitGate, () => {
  const t = tree("git@github.com:acme/widgets.git");
  try {
    M.setRemoteMapping("github.com/acme", "claude", "work");
    M.setMapping(t.repo, "claude", "folder");
    const hit = M.resolveMapping(t.deep, "claude");
    assert.equal(hit?.name, "folder");
    assert.equal(hit?.remote, undefined);
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("a folder rule inside the repo wins; a folder rule above the repo loses to the remote", gitGate, () => {
  const t = tree("git@github.com:acme/widgets.git");
  try {
    M.setRemoteMapping("github.com/acme", "claude", "work");
    M.setMapping(t.projects, "claude", "outer");
    assert.equal(M.resolveMapping(t.deep, "claude")?.name, "work", "the remote sits deeper than ~/projects");
    M.setMapping(path.join(t.repo, "pkg"), "claude", "inner");
    assert.equal(M.resolveMapping(t.deep, "claude")?.name, "inner");
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("another owner, no remote, or no repo falls through to the folder rules", gitGate, () => {
  const other = tree("git@github.com:someone-else/widgets.git");
  try {
    M.setRemoteMapping("github.com/acme", "claude", "work");
    M.setMapping(other.projects, "claude", "outer");
    assert.equal(M.resolveMapping(other.deep, "claude")?.name, "outer");
  } finally {
    fs.rmSync(other.root, { recursive: true, force: true });
  }
  const bare = tree(null);
  try {
    M.setRemoteMapping("github.com/acme", "claude", "work");
    assert.equal(M.resolveMapping(bare.deep, "claude"), null);
  } finally {
    fs.rmSync(bare.root, { recursive: true, force: true });
  }
});

// git prints the repo root in its own spelling (on Windows the long form of an
// 8.3 temp dir). A case-insensitive file system shows the same mismatch here.
const caseInsensitive = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "asw-case-"));
  try {
    return fs.existsSync(d.toUpperCase());
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
})();

test("a folder asked for in another spelling of its path still finds its repo's binding", { skip: !hasGit ? "git not installed" : !caseInsensitive ? "needs a case-insensitive file system" : false }, () => {
  const t = tree("git@github.com:acme/widgets.git");
  try {
    M.setRemoteMapping("github.com/acme", "claude", "work");
    const otherSpelling = t.deep.replace(`${path.sep}widgets${path.sep}`, `${path.sep}WIDGETS${path.sep}`);
    assert.notEqual(otherSpelling, t.deep);
    assert.equal(M.resolveMapping(otherSpelling, "claude")?.name, "work");
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("remote bindings are listed, pruned with their profile, and removable", () => {
  M.setRemoteMapping("github.com/acme", "claude", "gone");
  M.setRemoteMapping("github.com/acme", "codex", "stays");
  assert.deepEqual(
    M.remoteRows().map((r) => `${r.remote} ${r.provider}/${r.name}`),
    ["github.com/acme claude/gone", "github.com/acme codex/stays"],
  );
  assert.deepEqual(M.pruneMappings("claude", "gone"), ["github.com/acme"]);
  assert.deepEqual(M.remoteRows().map((r) => r.name), ["stays"]);
  assert.equal(M.removeRemoteMapping("github.com/acme", "codex"), true);
  assert.equal(M.removeRemoteMapping("github.com/acme", "codex"), false);
  assert.deepEqual(M.remoteRows(), []);
  fs.rmSync(HOME, { recursive: true, force: true });
});
