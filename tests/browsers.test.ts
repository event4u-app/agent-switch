import { test } from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { browserWrapperScript, firstIsolatable, isolatedWrapperScript, listBrowsers, locateBrowser, playwrightWrapperScript, type BrowserDeps } from "../src/browsers.js";
import { portInUse } from "../src/commands/profiles.js";

function deps(over: Partial<BrowserDeps> & { present?: string[]; bins?: Record<string, string> }): BrowserDeps {
  const present = new Set(over.present ?? []);
  const bins = over.bins ?? {};
  return {
    platform: over.platform ?? "darwin",
    home: "/Users/u",
    exists: (p) => present.has(p),
    which: (b) => bins[b] ?? null,
  };
}

test("browsers: macOS lists the installed apps from /Applications and ~/Applications, in a stable order", () => {
  const d = deps({ present: ["/Applications/Safari.app", "/Users/u/Applications/Arc.app", "/Applications/Google Chrome.app"] });
  assert.deepEqual(
    listBrowsers(d).map((b) => b.id),
    ["safari", "chrome", "arc"],
  );
  assert.equal(listBrowsers(d).find((b) => b.id === "arc")?.name, "Arc");
  assert.equal(locateBrowser("arc", d), "/Users/u/Applications/Arc.app");
  assert.equal(locateBrowser("firefox", d), null, "not installed");
  assert.equal(locateBrowser("nope", d), null, "unknown id");
});

test("browsers: Linux resolves binaries on PATH", () => {
  const d = deps({ platform: "linux", bins: { firefox: "/usr/bin/firefox", chromium: "/snap/bin/chromium" } });
  assert.deepEqual(
    listBrowsers(d).map((b) => b.id),
    ["chromium", "firefox"],
  );
  assert.equal(locateBrowser("firefox", d), "/usr/bin/firefox");
});

test("browsers: Windows lists none (the provider CLIs there take no browser override)", () => {
  assert.deepEqual(listBrowsers(deps({ platform: "win32", present: ["/Applications/Safari.app"] })), []);
});

test("browsers: the macOS wrapper opens the URL in that app, quoting the path safely", () => {
  const s = browserWrapperScript("/Applications/Bob's Browser.app");
  assert.match(s, /^#!\/bin\/sh\n/);
  assert.match(s, /exec \/usr\/bin\/open -a '\/Applications\/Bob'\\''s Browser\.app' "\$@"/);
});

test("isolation: only documented Chromium-family browsers can keep one profile per account", () => {
  const d = deps({ present: ["/Applications/Safari.app", "/Applications/Arc.app", "/Applications/Google Chrome.app", "/Applications/Brave Browser.app"] });
  assert.deepEqual(listBrowsers(d).map((b) => [b.id, b.isolatable]), [["safari", false], ["chrome", true], ["arc", false], ["brave", true]]);
  assert.equal(firstIsolatable(d), "chrome");
  assert.equal(firstIsolatable(deps({ present: ["/Applications/Safari.app"] })), null);
});

test("isolated wrapper: the account's own profile folder, no automation flag, quoted against spaces and quotes", () => {
  const mac = isolatedWrapperScript("darwin", "/Applications/Google Chrome.app", "/Users/u/.agent-switch/claude/it's/browser");
  assert.equal(mac, "#!/bin/sh\nexec /usr/bin/open -na '/Applications/Google Chrome.app' --args --user-data-dir='/Users/u/.agent-switch/claude/it'\\''s/browser' --no-first-run --no-default-browser-check \"$@\"\n");
  assert.ok(!/enable-automation|remote-debugging/.test(mac));
  const linux = isolatedWrapperScript("linux", "/usr/bin/google-chrome", "/h/b");
  assert.equal(linux, "#!/bin/sh\nexec '/usr/bin/google-chrome' --user-data-dir='/h/b' --no-first-run --no-default-browser-check \"$@\"\n");
});

test("isolated wrapper: the shell hands the URL over as one argument after the profile flags", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-iso-"));
  const fake = path.join(dir, "fake browser");
  fs.writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do echo "[$a]"; done\n', { mode: 0o700 });
  const wrapper = path.join(dir, "wrapper");
  fs.writeFileSync(wrapper, isolatedWrapperScript("linux", fake, path.join(dir, "it's profile")), { mode: 0o700 });
  const out = spawnSync(wrapper, ["https://claude.com/cai/oauth/authorize?code=true&state=x y"], { encoding: "utf8" }).stdout;
  assert.equal(out, `[--user-data-dir=${path.join(dir, "it's profile")}]\n[--no-first-run]\n[--no-default-browser-check]\n[https://claude.com/cai/oauth/authorize?code=true&state=x y]\n`);
});

test("playwright wrapper: runs the sign-in browser in the background and returns at once", { skip: process.platform === "win32" }, () => {
  const s = playwrightWrapperScript("/usr/local/bin/node", "/opt/as/dist/index.js", "/h/it's");
  assert.equal(s, "#!/bin/sh\n'/usr/local/bin/node' '/opt/as/dist/index.js' sign-in-browser --dir '/h/it'\\''s' \"$@\" >/dev/null 2>&1 &\nexit 0\n");
});

test("portInUse: sees a listener and its absence", async () => {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  assert.equal(portInUse(port), true);
  await new Promise<void>((r) => srv.close(() => r()));
  assert.equal(portInUse(port), false);
});
