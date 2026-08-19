import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import {
  parseVersion,
  compareVersions,
  isNewer,
  parseRelease,
  parseReleases,
  releasesNewerThan,
  npmSearchPath,
} from "../src/updates.js";

test("parseVersion strips v-prefix and pre-release/build, pads missing with 0", () => {
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("1.2"), [1, 2]);
  assert.deepEqual(parseVersion("2.0.0-beta.1"), [2, 0, 0]);
  assert.deepEqual(parseVersion("garbage"), [0]);
});

test("compareVersions orders left-to-right, treats missing components as 0", () => {
  assert.equal(compareVersions("1.2.0", "1.2"), 0);
  assert.equal(compareVersions("1.2.1", "1.2.0"), 1);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
});

test("isNewer is strict-greater", () => {
  assert.equal(isNewer("1.0.1", "1.0.0"), true);
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", "1.0.1"), false);
  assert.equal(isNewer("v1.1.0", "1.0.9"), true);
});

test("parseRelease keeps a real release, rejects draft/prerelease/tagless", () => {
  const ok = parseRelease({ tag_name: "1.2.0", name: "1.2.0", html_url: "u", body: "notes", published_at: "t" });
  assert.equal(ok?.tag, "1.2.0");
  assert.equal(parseRelease({ tag_name: "1.2.0", draft: true }), null);
  assert.equal(parseRelease({ tag_name: "1.2.0", prerelease: true }), null);
  assert.equal(parseRelease({ name: "no tag" }), null);
  assert.equal(parseRelease(null), null);
});

test("parseRelease falls back name→tag and url→releases page", () => {
  const r = parseRelease({ tag_name: "1.2.0" });
  assert.equal(r?.name, "1.2.0");
  assert.match(r?.url ?? "", /\/releases$/);
});

test("npmSearchPath puts node's own bin dir first so a stripped GUI PATH still finds npm", () => {
  const home = path.join("/Users", "x");
  const inherited = ["/usr/bin", "/bin"].join(path.delimiter); // delimiter is ; on Windows, : on POSIX
  const parts = npmSearchPath("/opt/homebrew/bin", inherited, home).split(path.delimiter);
  assert.equal(parts[0], "/opt/homebrew/bin"); // node/npm co-located dir wins
  assert.ok(parts.includes("/usr/bin")); // inherited PATH preserved as fallback
  assert.ok(parts.includes(path.join(home, ".npm-global", "bin"))); // common global-install fallback
  assert.ok(parts.includes("/usr/local/bin"));
});

test("npmSearchPath drops empty segments (e.g. an unset inherited PATH)", () => {
  const parts = npmSearchPath("/node/bin", "", "/home/y").split(path.delimiter);
  assert.ok(!parts.includes("")); // no empty segment → no accidental CWD-in-PATH
  assert.equal(parts[0], "/node/bin");
});

test("parseRelease uses the given repo for the url fallback, not the app's own", () => {
  const r = parseRelease({ tag_name: "1.2.0" }, "owner/other-repo");
  assert.equal(r?.url, "https://github.com/owner/other-repo/releases");
});

test("parseReleases drops drafts/prereleases/tagless and orders newest version first", () => {
  const list = parseReleases([
    { tag_name: "1.0.0", html_url: "a" },
    { tag_name: "1.2.0", html_url: "c" },
    { tag_name: "1.3.0", html_url: "d", draft: true },
    { tag_name: "1.4.0", html_url: "e", prerelease: true },
    { name: "no tag" },
    { tag_name: "1.1.0", html_url: "b" },
  ]);
  assert.deepEqual(
    list.map((r) => r.tag),
    ["1.2.0", "1.1.0", "1.0.0"],
  );
});

test("parseReleases sorts by version math, not by the order GitHub returned", () => {
  // GitHub orders by creation date; a back-ported patch released later must not
  // outrank a higher version.
  const list = parseReleases([
    { tag_name: "1.9.1", html_url: "late-backport" },
    { tag_name: "1.10.0", html_url: "newer" },
  ]);
  assert.deepEqual(
    list.map((r) => r.tag),
    ["1.10.0", "1.9.1"],
  );
});

test("parseReleases tolerates a non-array payload (404 body, error object)", () => {
  assert.deepEqual(parseReleases(null), []);
  assert.deepEqual(parseReleases({ message: "Not Found" }), []);
});

test("releasesNewerThan keeps only strictly newer releases, newest first", () => {
  const list = parseReleases([
    { tag_name: "14.0.0", html_url: "a" },
    { tag_name: "14.1.0", html_url: "b" },
    { tag_name: "14.2.0", html_url: "c" },
  ]);
  assert.deepEqual(
    releasesNewerThan(list, "14.0.0").map((r) => r.tag),
    ["14.2.0", "14.1.0"],
  );
  assert.deepEqual(releasesNewerThan(list, "14.2.0"), []); // up to date → nothing to read
  assert.deepEqual(releasesNewerThan(list, "99.0.0"), []); // ahead of the registry → still nothing
});
