import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { analyzeCCContract, verifyCCBinary, type ContractVerdict } from "../src/cc-contract.js";

/**
 * A reduced, synthetic stand-in for the minified Claude Code bundle: only the
 * shapes the analyzer anchors on, with arbitrary minifier identifiers so the
 * tests prove the patterns do not depend on specific names.
 */
function bundle(over: Partial<Record<"version" | "naming" | "legacy" | "timing" | "cache", string>> = {}): string {
  const parts = {
    version: "// Version: 9.9.9\n",
    naming:
      `var Qx="-credentials";function Kk(e=""){let n=process.env.CLAUDE_CONFIG_DIR,r=(n??"").normalize("NFC"),` +
      `a=n?"-"+h("sha256").update(r).digest("hex").substring(0,8):"";return\`Claude Code\${Z().S}\${e}\${a}\`}\n`,
    legacy:
      `async function Ll(e){return\`\${await Rp(e).catch(()=>e)}.lock\`}` +
      `if(P.code==="ELOCKED")throw q("tengu_oauth_refresh_legacy_lock_contended",{}),P;\n`,
    timing: `function Op(e,n){return{lockfilePath:J(e,".oauth_refresh.lock"),realpath:!1,stale:60000,update:5000}}\n`,
    cache:
      `var w9=30000;class C{cache={data:null,cachedAt:0}}` +
      `read(){let r=g().cache;if(Date.now()-r.cachedAt<w9)return r.data;` +
      `let s=x(\`security find-generic-password -a "\${n}" -w -s "\${o}"\`)}\n`,
  };
  return Object.values({ ...parts, ...over }).join("");
}

function failed(v: ContractVerdict): string[] {
  return v.findings.filter((f) => !f.ok).map((f) => f.fact);
}

test("a bundle carrying every pinned contract fact passes", () => {
  const v = analyzeCCContract(bundle(), "9.9.9");
  assert.equal(v.ok, true, JSON.stringify(v.findings));
  assert.deepEqual(failed(v), []);
});

test("the bundle must be the running version — a stale binary on PATH is not evidence", () => {
  assert.deepEqual(failed(analyzeCCContract(bundle(), "9.9.10")), ["version"]);
});

test("keychain naming drift fails closed (hash length, hash input, missing NFC)", () => {
  const drifts = [
    bundle({ naming: bundle().split("\n")[1].replace("substring(0,8)", "substring(0,12)") + "\n" }),
    bundle({ naming: bundle().split("\n")[1].replace('"sha256"', '"sha1"') + "\n" }),
    bundle({ naming: bundle().split("\n")[1].replace('.normalize("NFC")', "") + "\n" }),
    bundle({ naming: bundle().split("\n")[1].replace('"-credentials"', '"-tokens"') + "\n" }),
  ];
  for (const b of drifts) assert.deepEqual(failed(analyzeCCContract(b, "9.9.9")), ["keychain-naming"]);
});

test("dropping the legacy <config_dir>.lock fails — our lock would no longer exclude CC's refresh", () => {
  assert.deepEqual(failed(analyzeCCContract(bundle({ legacy: "" }), "9.9.9")), ["legacy-lock"]);
});

test("lock timing: a holder touch slower than our 10 s staleness, or a stale window below our 3 s touch, fails", () => {
  const slowTouch = bundle({ timing: bundle().split("\n")[3].replace("update:5000", "update:12000") + "\n" });
  assert.deepEqual(failed(analyzeCCContract(slowTouch, "9.9.9")), ["lock-timing"]);
  const tinyStale = bundle({ timing: bundle().split("\n")[3].replace("stale:60000", "stale:2000") + "\n" });
  assert.deepEqual(failed(analyzeCCContract(tinyStale, "9.9.9")), ["lock-timing"]);
  // Minified exponent literals are parsed, not rejected.
  const expo = bundle({ timing: bundle().split("\n")[3].replace("stale:60000", "stale:6e4") + "\n" });
  assert.deepEqual(failed(analyzeCCContract(expo, "9.9.9")), []);
});

test("a keychain read cache longer than 30 s fails; an unresolvable TTL fails closed", () => {
  const longer = bundle({ cache: bundle().split("\n")[4].replace("w9=30000", "w9=60000") + "\n" });
  assert.deepEqual(failed(analyzeCCContract(longer, "9.9.9")), ["cache-ttl"]);
  const unresolved = bundle({ cache: bundle().split("\n")[4].replace("var w9=30000;", "") + "\n" });
  assert.deepEqual(failed(analyzeCCContract(unresolved, "9.9.9")), ["cache-ttl"]);
});

test("verifyCCBinary scans a binary once per version and serves the cached verdict while it is unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-contract-"));
  const bin = path.join(dir, "claude");
  const cache = path.join(dir, "cache.json");
  fs.writeFileSync(bin, bundle());

  let reads = 0;
  const readBinary = (p: string) => {
    reads++;
    return fs.readFileSync(p);
  };
  assert.equal(verifyCCBinary("9.9.9", { binaryPath: bin, cacheFile: cache, readBinary }).ok, true);
  assert.equal(verifyCCBinary("9.9.9", { binaryPath: bin, cacheFile: cache, readBinary }).ok, true);
  assert.equal(reads, 1, "second call is served from the cache");

  // A replaced binary (different size) invalidates the cached verdict.
  fs.writeFileSync(bin, bundle({ legacy: "" }));
  assert.equal(verifyCCBinary("9.9.9", { binaryPath: bin, cacheFile: cache, readBinary }).ok, false);
  assert.equal(reads, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verifyCCBinary fails closed when the binary cannot be located or read", () => {
  const v = verifyCCBinary("9.9.9", { binaryPath: null, cacheFile: path.join(os.tmpdir(), "nope.json") });
  assert.equal(v.ok, false);
  assert.deepEqual(failed(v), ["binary"]);
  const r = verifyCCBinary("9.9.9", {
    binaryPath: "/definitely/not/here/claude",
    cacheFile: path.join(os.tmpdir(), "nope.json"),
  });
  assert.equal(r.ok, false);
});
