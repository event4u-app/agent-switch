import { test } from "node:test";
import assert from "node:assert/strict";

import { browserWrapperScript, listBrowsers, locateBrowser, type BrowserDeps } from "../src/browsers.js";

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
