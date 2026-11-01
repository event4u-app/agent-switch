import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) && process.platform !== "win32" ? false : "needs dist/index.js and a POSIX rc file" };

function install(home: string, args: string[]): string {
  const r = spawnSync("node", [CLI, "shellenv", "install", ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: home, AGENT_SWITCH_HOME: path.join(home, ".agent-switch"), SHELL: "/bin/zsh" },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("shellenv install --shell bash sets up bash even when zsh already has the line", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "as-shellenv-"));
  try {
    install(home, ["--shell", "zsh"]);
    assert.match(fs.readFileSync(path.join(home, ".zshrc"), "utf8"), /agent-switch shellenv/);

    install(home, ["--shell", "bash"]);
    const bashrc = path.join(home, process.platform === "darwin" ? ".bash_profile" : ".bashrc");
    assert.match(fs.readFileSync(bashrc, "utf8"), /agent-switch shellenv/, "bash rc file was not written");

    // A second run for the same shell changes nothing.
    const before = fs.readFileSync(bashrc, "utf8");
    assert.match(install(home, ["--shell", "bash"]), /already installed/);
    assert.equal(fs.readFileSync(bashrc, "utf8"), before);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("shellenv install without --shell still treats any installed shell as done", gate, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "as-shellenv-"));
  try {
    fs.mkdirSync(path.join(home, ".config", "fish"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "fish", "config.fish"), "agent-switch shellenv --shell fish | source\n");
    assert.match(install(home, []), /already installed/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
