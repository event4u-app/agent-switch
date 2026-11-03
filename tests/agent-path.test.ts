import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { cutMarkedPath, loginShellPath, mergePaths, nvmDefaultVersion, probeVersion, versionManagerDirs } from "../src/agent-path.js";

test("cutMarkedPath takes only what sits between the markers", () => {
  assert.equal(cutMarkedPath("[ERROR] gitstatus failed\n__ASPATH__/a:/b__END__\nbye"), "/a:/b");
  assert.equal(cutMarkedPath("no markers at all"), null);
  assert.equal(cutMarkedPath("__ASPATH__/a without end"), null);
  assert.equal(cutMarkedPath("__ASPATH____END__"), null);
});

test("loginShellPath ignores a failing exit status but needs the markers", () => {
  const run = (() => ({ status: 1, stdout: "noise __ASPATH__/x:/y__END__" })) as never;
  if (process.platform === "win32") return void assert.equal(loginShellPath("/bin/zsh", "/h", run), null, "no login shell on Windows");
  assert.equal(loginShellPath("/bin/zsh", "/h", run), "/x:/y");
  const silent = (() => ({ status: 0, stdout: "" })) as never;
  assert.equal(loginShellPath("/bin/zsh", "/h", silent), null);
  assert.equal(loginShellPath("zsh", "/h", run), null, "a relative shell is not run");
});

test("mergePaths keeps the first occurrence and drops empties", () => {
  const d = path.delimiter;
  assert.equal(mergePaths(`/a${d}/b`, null, `${d}/b${d}/c`, undefined), `/a${d}/b${d}/c`);
});

test("versionManagerDirs names every manager and nvm only with a version", () => {
  const without = versionManagerDirs("/h", null);
  assert.ok(without.includes(path.join("/h", ".local", "share", "mise", "shims")));
  assert.ok(without.includes(path.join("/h", ".volta", "bin")));
  assert.ok(!without.some((d) => d.includes(".nvm")));
  assert.ok(versionManagerDirs("/h", "v22.3.0").includes(path.join("/h", ".nvm", "versions", "node", "v22.3.0", "bin")));
});

test("nvmDefaultVersion follows the default alias, else the newest", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "as-nvm-"));
  assert.equal(nvmDefaultVersion(home), null);
  for (const v of ["v20.1.0", "v22.3.0", "v18.0.0"]) fs.mkdirSync(path.join(home, ".nvm", "versions", "node", v), { recursive: true });
  assert.equal(nvmDefaultVersion(home), "v22.3.0");
  fs.mkdirSync(path.join(home, ".nvm", "alias"), { recursive: true });
  fs.writeFileSync(path.join(home, ".nvm", "alias", "default"), "20\n");
  assert.equal(nvmDefaultVersion(home), "v20.1.0");
});

test("probeVersion reads the version token and maps a missing binary to null", () => {
  const ok = (() => ({ stdout: "codex-cli 0.166.0\n", stderr: "" })) as never;
  assert.equal(probeVersion("codex", "/x", ok), "0.166.0");
  const missing = (() => ({ error: Object.assign(new Error("x"), { code: "ENOENT" }) })) as never;
  assert.equal(probeVersion("nope", "/x", missing), null);
});
