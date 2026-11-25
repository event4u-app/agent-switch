import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildFreshness, buildFreshnessCheck, checkoutOf } from "../src/build-freshness.js";

/** A checkout: package.json, src/a.ts, src/sub/b.ts and dist/index.js, with chosen mtimes (seconds). */
function checkout(times: { src: number; sub: number; dist: number }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-build-"));
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  fs.mkdirSync(path.join(root, "src", "sub"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist"));
  const put = (rel: string, at: number) => {
    const f = path.join(root, rel);
    fs.writeFileSync(f, "x");
    fs.utimesSync(f, at, at);
  };
  put("src/a.ts", times.src);
  put("src/sub/b.ts", times.sub);
  put("dist/index.js", times.dist);
  return root;
}

test("checkoutOf: a dist inside a checkout names its root; an installed package (no src/) names none", () => {
  const root = checkout({ src: 1000, sub: 1000, dist: 2000 });
  assert.equal(checkoutOf(path.join(root, "dist", "index.js")), root);
  fs.rmSync(path.join(root, "src"), { recursive: true });
  assert.equal(checkoutOf(path.join(root, "dist", "index.js")), null);
});

test("buildFreshness: a source file newer than the build makes dist stale, nested ones included", () => {
  assert.equal(buildFreshness(checkout({ src: 1000, sub: 1000, dist: 2000 }), null).distStale, false);
  assert.equal(buildFreshness(checkout({ src: 3000, sub: 1000, dist: 2000 }), null).distStale, true);
  assert.equal(buildFreshness(checkout({ src: 1000, sub: 3000, dist: 2000 }), null).distStale, true);
});

test("buildFreshness: an engine started on an older build than dist is stale; one on this build, or unknown, is not", () => {
  const root = checkout({ src: 1000, sub: 1000, dist: 2000 });
  assert.equal(buildFreshness(root, 1500 * 1000).engineStale, true);
  assert.equal(buildFreshness(root, 2000 * 1000).engineStale, false);
  assert.equal(buildFreshness(root, null).engineStale, false);
});

test("buildFreshnessCheck: warns with the fix for each stale part; ok when both are current", () => {
  assert.equal(buildFreshnessCheck({ distStale: false, engineStale: false }).status, "ok");
  const dist = buildFreshnessCheck({ distStale: true, engineStale: false });
  assert.equal(dist.status, "warn");
  assert.match(dist.fix ?? "", /npm run build/);
  const engine = buildFreshnessCheck({ distStale: false, engineStale: true });
  assert.equal(engine.status, "warn");
  assert.match(engine.fix ?? "", /service restart/);
  assert.match(buildFreshnessCheck({ distStale: true, engineStale: true }).fix ?? "", /npm run build.*service restart/);
});
