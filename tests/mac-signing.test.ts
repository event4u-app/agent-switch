import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  IDENTITY_CN,
  bundleRunningIn,
  designatedLeaf,
  ensureIdentity,
  mergeSearchList,
  parseIdentities,
  parseKeychainList,
  sha1FromFingerprint,
  signatureState,
  signingPaths,
  stabilizeSignature,
  type RunResult,
  type SignEnv,
} from "../src/mac-signing.js";

/** A simulated Mac: keychains, the user search list and bundle signatures, driven through the
 *  same commands the module runs. No real keychain, openssl or codesign is touched. */
function fakeMac(opts: { list?: string[] } = {}) {
  const keychains = new Map<string, { pw: string; ids: Set<string> }>();
  const sigs = new Map<string, string>(); // app → "adhoc" | leaf sha1
  const st = {
    keychains,
    sigs,
    list: [...(opts.list ?? ['/Users/x/Library/Keychains/login.keychain-db', "/odd path/with space.keychain"])],
    calls: [] as string[][],
    leaves: 0,
    failSign: false,
    throwOnSign: false,
    running: "",
    partitionSet: new Set<string>(),
  };
  const ok = (stdout = "", stderr = ""): RunResult => ({ status: 0, stdout, stderr });
  const fail = (stderr: string, status = 1): RunResult => ({ status, stdout: "", stderr });
  const arg = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];
  const leafSha = (n: number) => `AB${String(n).padStart(38, "0")}`;
  const run = (cmd: string, args: readonly string[], extra?: Record<string, string>): RunResult => {
    st.calls.push([path.basename(cmd), ...args]);
    const tool = path.basename(cmd);
    if (tool === "openssl") {
      if (args[0] === "req") {
        assert.ok(fs.existsSync(arg(args, "-config")));
        st.leaves++;
        fs.writeFileSync(arg(args, "-keyout"), "PRIVATE");
        fs.writeFileSync(arg(args, "-out"), `CERT${st.leaves}`);
        return ok();
      }
      if (args[0] === "x509") {
        const n = Number(fs.readFileSync(arg(args, "-in"), "utf8").slice(4));
        return ok(`SHA1 Fingerprint=${leafSha(n).match(/../g)!.join(":")}\n`);
      }
      if (args[0] === "pkcs12") {
        assert.ok(extra?.AS_SIGN_PASS, "the transfer password comes through the environment");
        assert.ok(!args.some((a) => a.includes(extra!.AS_SIGN_PASS)), "never on the command line");
        fs.writeFileSync(arg(args, "-out"), fs.readFileSync(arg(args, "-in"), "utf8"));
        return ok();
      }
    }
    if (tool === "security") {
      const kcArg = args.at(-1)!;
      switch (args[0]) {
        case "create-keychain":
          if (fs.existsSync(kcArg)) return fail("A keychain with the same name already exists.", 48);
          fs.writeFileSync(kcArg, "KC");
          keychains.set(kcArg, { pw: arg(args, "-p"), ids: new Set() });
          return ok();
        case "unlock-keychain": {
          const kc = keychains.get(kcArg);
          if (!kc || !fs.existsSync(kcArg)) return fail("The specified keychain could not be found.", 50);
          return kc.pw === arg(args, "-p") ? ok() : fail("The user name or passphrase you entered is not correct.", 51);
        }
        case "set-keychain-settings":
          return ok();
        case "list-keychains":
          if (args.includes("-s")) {
            st.list = args.slice(args.indexOf("-s") + 1);
            return ok();
          }
          return ok(st.list.map((p) => `    "${p}"\n`).join(""));
        case "import": {
          const n = Number(fs.readFileSync(args[1], "utf8").slice(4));
          keychains.get(arg(args, "-k"))!.ids.add(leafSha(n));
          return ok("1 identity imported.\n");
        }
        case "set-key-partition-list":
          st.partitionSet.add(kcArg);
          return ok();
        case "find-identity": {
          const ids = [...(keychains.get(kcArg)?.ids ?? [])];
          const rows = ids.map((s, i) => `  ${i + 1}) ${s} "${IDENTITY_CN}" (CSSMERR_TP_NOT_TRUSTED)`).join("\n");
          return ok(`\nPolicy: Code Signing\n  Matching identities\n${rows}\n     ${ids.length} identities found\n`);
        }
      }
    }
    if (tool === "codesign") {
      const app = args.at(-1)!;
      if (args[0] === "--force") {
        if (st.throwOnSign) throw new Error("spawn exploded");
        if (st.failSign) return fail("errSecInternalComponent");
        const sha = arg(args, "--sign");
        const found = st.list.some((p) => keychains.get(p)?.ids.has(sha));
        if (!found) return fail(`${sha}: no identity found`);
        sigs.set(app, sha);
        return ok();
      }
      if (args[0] === "--verify") return ok();
      const sig = sigs.get(app) ?? "adhoc";
      if (args[0] === "-d") return ok(sig === "adhoc" ? "" : `designated => identifier "com.event4u.agent-switch" and certificate leaf = H"${sig}"\n`);
      // As the real codesign: Authority lines only from -dvv on, never from a bare -dv.
      if (args[0] === "-dv" || args[0] === "-dvv") {
        const who = sig !== "adhoc" && args[0] === "-dvv" ? `Authority=${IDENTITY_CN}\n` : "";
        return ok("", sig === "adhoc" ? `Executable=${app}/Contents/MacOS/agent-switch\nSignature=adhoc\n` : `${who}Signature size=1234\n`);
      }
    }
    throw new Error(`unexpected command: ${tool} ${args.join(" ")}`);
  };
  return { st, run, leafSha };
}

function setup(opts: { platform?: string; list?: string[] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "as-sign-"));
  const mac = fakeMac(opts);
  const warns: string[] = [];
  const logs: Record<string, unknown>[] = [];
  let pwN = 0;
  const env: SignEnv = {
    platform: opts.platform ?? "darwin",
    root,
    run: mac.run,
    processList: () => mac.st.running,
    warn: (l) => warns.push(l),
    log: (e) => logs.push(e as Record<string, unknown>),
    newPassword: () => `secret-pw-${++pwN}`,
  };
  const app = path.join(root, "gui", "2.12.0", "agent-switch.app");
  const p = signingPaths(root);
  const recorded = () => JSON.parse(fs.readFileSync(p.identity, "utf8")).sha1 as string;
  return { root, mac, env, warns, logs, app, p, recorded };
}

// The module only runs on darwin; these assert POSIX paths and file modes a Windows runner cannot have.
const posixOnly = { skip: process.platform === "win32" ? "macOS-only paths and file modes" : false };

const leakFree = (s: { warns: string[]; logs: unknown[] }) => {
  const text = JSON.stringify(s.warns) + JSON.stringify(s.logs);
  assert.ok(!/secret-pw-/.test(text), "the keychain password never reaches stderr or the log");
};

test("first run: creates keychain, 0600 password, records the leaf and signs the bundle", posixOnly, () => {
  const s = setup();
  assert.equal(stabilizeSignature(s.app, s.env), "signed");
  assert.ok(fs.existsSync(s.p.keychain));
  assert.equal(fs.statSync(s.p.password).mode & 0o777, 0o600);
  assert.equal(fs.statSync(s.root).mode & 0o777, 0o700);
  assert.equal(s.recorded(), s.mac.leafSha(1));
  assert.equal(s.mac.st.sigs.get(s.app), s.mac.leafSha(1));
  assert.ok(s.mac.st.partitionSet.has(s.p.keychain));
  assert.deepEqual(
    fs.readdirSync(s.root).filter((n) => n.startsWith("tmp-")),
    [],
    "temporary key material is deleted",
  );
  assert.deepEqual(s.warns, []);
  assert.ok(s.logs.some((l) => l.what === "gui-sign-identity-created"));
  leakFree(s);
});

test("reuse: a recorded identity signs the next version without creating a leaf", () => {
  const s = setup();
  stabilizeSignature(s.app, s.env);
  const next = s.app.replace("2.12.0", "2.13.0");
  s.mac.st.calls.length = 0;
  assert.equal(stabilizeSignature(next, s.env), "signed");
  assert.equal(s.mac.st.sigs.get(next), s.mac.leafSha(1));
  assert.equal(s.mac.st.leaves, 1);
  assert.ok(!s.mac.st.calls.some((c) => c[0] === "security" && c[1] === "create-keychain"));
  assert.ok(!s.mac.st.calls.some((c) => c[0] === "security" && c[1] === "list-keychains" && c.includes("-s")), "search list not rewritten");
  assert.deepEqual(s.warns, []);
});

test("a bundle already pinned to the recorded leaf is kept, not re-signed", () => {
  const s = setup();
  stabilizeSignature(s.app, s.env);
  s.mac.st.calls.length = 0;
  assert.equal(stabilizeSignature(s.app, s.env), "kept");
  assert.ok(!s.mac.st.calls.some((c) => c[0] === "codesign" && c[1] === "--force"));
});

test("lost identity: keychain deleted → a new leaf, recorded and reported loudly", () => {
  const s = setup();
  stabilizeSignature(s.app, s.env);
  fs.rmSync(s.p.keychain);
  s.mac.st.keychains.delete(s.p.keychain);
  const next = s.app.replace("2.12.0", "2.13.0");
  assert.equal(stabilizeSignature(next, s.env), "signed");
  assert.equal(s.recorded(), s.mac.leafSha(2));
  assert.equal(s.warns.length, 1);
  assert.match(s.warns[0], /replaced/);
  assert.match(s.warns[0], /ask once more for folder access/);
  assert.ok(s.logs.some((l) => l.what === "gui-sign-identity-replaced"));
  leakFree(s);
});

test("partial state: identity.json lost but the keychain holds our leaf → adopted, no new leaf, no alarm", () => {
  const s = setup();
  stabilizeSignature(s.app, s.env);
  fs.writeFileSync(s.p.identity, "{torn");
  s.mac.st.partitionSet.clear();
  assert.equal(ensureIdentity(s.env), s.mac.leafSha(1));
  assert.equal(s.mac.st.leaves, 1);
  assert.equal(s.recorded(), s.mac.leafSha(1));
  assert.ok(s.mac.st.partitionSet.has(s.p.keychain), "partition list re-applied so codesign does not prompt");
  assert.deepEqual(s.warns, []);
});

test("partial state: keychain without password file → set aside, rebuilt (loud only if a leaf was recorded)", () => {
  const s = setup();
  // a run stopped after create-keychain left a keychain but the password file vanished
  fs.mkdirSync(s.root, { recursive: true });
  fs.writeFileSync(s.p.keychain, "KC");
  s.mac.st.keychains.set(s.p.keychain, { pw: "unknown", ids: new Set() });
  assert.equal(stabilizeSignature(s.app, s.env), "signed");
  assert.ok(fs.readdirSync(s.root).some((n) => n.includes(".unusable-")), "never deleted, moved aside");
  assert.equal(fs.readFileSync(s.p.password, "utf8"), "secret-pw-1");
  assert.deepEqual(s.warns, [], "no identity was recorded, so nothing was lost");
});

test("partial state: password rejected → set aside and rebuilt; other unlock errors keep the keychain", () => {
  const s = setup();
  stabilizeSignature(s.app, s.env);
  fs.writeFileSync(s.p.password, "wrong");
  assert.equal(stabilizeSignature(s.app.replace("2.12.0", "2.13.0"), s.env), "signed");
  assert.equal(s.mac.st.leaves, 2);
  assert.match(s.warns.join("\n"), /replaced/);

  const t = setup();
  stabilizeSignature(t.app, t.env);
  const real = t.env.run;
  t.env.run = (cmd, args, extra) =>
    args[0] === "unlock-keychain" ? { status: 36, stdout: "", stderr: "securityd unavailable" } : real(cmd, args, extra);
  assert.equal(stabilizeSignature(t.app.replace("2.12.0", "2.13.0"), t.env), "failed");
  assert.equal(t.mac.st.leaves, 1, "a transient failure never costs a new leaf");
  assert.ok(fs.existsSync(t.p.keychain));
});

test("partial state: half-made keychain (no identity yet) and stale temp dirs are repaired", () => {
  const s = setup();
  fs.mkdirSync(path.join(s.root, "tmp-stale"), { recursive: true });
  fs.writeFileSync(path.join(s.root, "tmp-stale", "leaf-k"), "PRIVATE");
  fs.writeFileSync(s.p.password, "half-pw");
  fs.writeFileSync(s.p.keychain, "KC");
  s.mac.st.keychains.set(s.p.keychain, { pw: "half-pw", ids: new Set() });
  assert.equal(ensureIdentity(s.env), s.mac.leafSha(1));
  assert.ok(!fs.existsSync(path.join(s.root, "tmp-stale")));
  assert.deepEqual(s.warns, []);
});

test("password file without keychain → a fresh keychain and password", () => {
  const s = setup();
  fs.mkdirSync(s.root, { recursive: true });
  fs.writeFileSync(s.p.password, "orphan");
  assert.equal(stabilizeSignature(s.app, s.env), "signed");
  assert.equal(fs.readFileSync(s.p.password, "utf8"), "secret-pw-1");
});

test("search list: existing entries kept exactly, ours appended once", () => {
  const out = '    "/Users/x/Library/Keychains/login.keychain-db"\n    "/odd path/with space.keychain"\n    "/Library/Keychains/System.keychain"\n';
  const existing = parseKeychainList(out);
  assert.deepEqual(existing, ["/Users/x/Library/Keychains/login.keychain-db", "/odd path/with space.keychain", "/Library/Keychains/System.keychain"]);
  assert.deepEqual(mergeSearchList(existing, "/r/ours.keychain-db"), [...existing, "/r/ours.keychain-db"]);
  assert.equal(mergeSearchList([...existing, "/r/ours.keychain-db"], "/r/ours.keychain-db"), null);
  assert.equal(mergeSearchList(["/r/./ours.keychain-db"], "/r/ours.keychain-db"), null);

  const s = setup();
  stabilizeSignature(s.app, s.env);
  assert.deepEqual(s.mac.st.list, ["/Users/x/Library/Keychains/login.keychain-db", "/odd path/with space.keychain", s.p.keychain]);
  s.mac.st.list = s.mac.st.list.slice(0, 1); // the user reset the list
  stabilizeSignature(s.app.replace("2.12.0", "2.13.0"), s.env);
  assert.deepEqual(s.mac.st.list, ["/Users/x/Library/Keychains/login.keychain-db", s.p.keychain]);
});

test("signing failure: the launch goes on, one warning naming cause and consequence, the leaf is kept", () => {
  const s = setup();
  stabilizeSignature(s.app, s.env);
  s.mac.st.failSign = true;
  const next = s.app.replace("2.12.0", "2.13.0");
  assert.equal(stabilizeSignature(next, s.env), "failed");
  assert.equal(s.warns.length, 1);
  assert.match(s.warns[0], /signing the GUI failed/);
  assert.match(s.warns[0], /macOS may ask again for folder access/);
  const err = s.logs.find((l) => l.what === "gui-sign" && l.ok === false);
  assert.ok(err);
  assert.equal(s.mac.st.leaves, 1, "never a new leaf because signing failed");
  assert.equal(s.recorded(), s.mac.leafSha(1));

  s.mac.st.failSign = false;
  s.mac.st.throwOnSign = true;
  assert.doesNotThrow(() => assert.equal(stabilizeSignature(next, s.env), "failed"));
  assert.ok(!fs.existsSync(s.p.identity + ".lock"), "the lock is released");
  leakFree(s);
});

test("non-darwin: nothing runs", () => {
  for (const platform of ["linux", "win32"]) {
    const s = setup({ platform });
    assert.equal(stabilizeSignature(s.app, s.env), "skipped");
    assert.deepEqual(s.mac.st.calls, []);
    assert.ok(!fs.existsSync(s.p.keychain));
  }
});

test("a running bundle is never re-signed", posixOnly, () => {
  const s = setup();
  s.mac.st.running = `/sbin/launchd\n${s.app}/Contents/MacOS/agent-switch\n`;
  assert.equal(stabilizeSignature(s.app, s.env), "running");
  assert.ok(!s.mac.st.calls.some((c) => c[0] === "codesign"));
  assert.ok(!fs.existsSync(s.p.keychain), "not even the identity is touched");
  // another version running does not block this one
  s.mac.st.running = `${s.app.replace("2.12.0", "2.11.0")}/Contents/MacOS/agent-switch\n`;
  assert.equal(stabilizeSignature(s.app, s.env), "signed");
});

test("dev build: a bare binary gets the fixed identifier, is kept when unchanged, and is left alone while it runs", posixOnly, () => {
  const s = setup();
  const bin = path.join(s.root, "gui", "src-tauri", "target", "debug", "agent-switch-gui");
  assert.equal(stabilizeSignature(bin, s.env, "com.event4u.agent-switch.dev"), "signed");
  const sign = s.mac.st.calls.find((c) => c[0] === "codesign" && c[1] === "--force")!;
  assert.equal(sign[sign.indexOf("--identifier") + 1], "com.event4u.agent-switch.dev");
  assert.equal(s.mac.st.sigs.get(bin), s.mac.leafSha(1));
  assert.equal(stabilizeSignature(bin, s.env, "com.event4u.agent-switch.dev"), "kept");
  s.mac.st.sigs.delete(bin); // a rebuild links a fresh ad-hoc binary
  s.mac.st.running = "/sbin/launchd\ntarget/debug/agent-switch-gui\n"; // as cargo starts it, relative
  assert.equal(stabilizeSignature(bin, s.env, "com.event4u.agent-switch.dev"), "running");
  assert.deepEqual(s.warns, []);
});

test("parsers", posixOnly, () => {
  assert.deepEqual(
    parseIdentities(`  1) ${"A".repeat(40)} "${IDENTITY_CN}" (CSSMERR_TP_NOT_TRUSTED)\n  1) ${"a".repeat(40)} "${IDENTITY_CN}"\n     2 identities found`),
    [{ sha1: "A".repeat(40), name: IDENTITY_CN }],
  );
  assert.equal(sha1FromFingerprint("SHA1 Fingerprint=FB:34:59:1B:37:56:F0:56:67:5B:70:AF:AF:76:45:F4:C4:67:0C:D3"), "FB34591B3756F056675B70AFAF7645F4C4670CD3");
  assert.equal(sha1FromFingerprint("garbage"), null);
  assert.deepEqual(signatureState("Signature=adhoc"), { kind: "adhoc" });
  assert.deepEqual(signatureState("code object is not signed at all"), { kind: "unsigned" });
  assert.deepEqual(signatureState("Authority=Developer ID Application: X\nAuthority=Apple Root CA"), { kind: "identity", authority: "Developer ID Application: X" });
  assert.equal(designatedLeaf(`designated => identifier "com.event4u.agent-switch" and certificate leaf = H"${"c".repeat(40)}"`), "C".repeat(40));
  assert.equal(bundleRunningIn("/a/agent-switch.app", "/a/agent-switch.app/Contents/MacOS/agent-switch"), true);
  assert.equal(bundleRunningIn("/a/agent-switch.app", "/a/agent-switch.app.old/Contents/MacOS/agent-switch"), false);
  assert.equal(bundleRunningIn("/r/target/debug/agent-switch-gui", "/r/target/debug/agent-switch-gui --flag"), true);
  assert.equal(bundleRunningIn("/r/target/debug/agent-switch-gui", "target/debug/agent-switch-gui"), true);
  assert.equal(bundleRunningIn("/r/target/debug/agent-switch-gui", "/other/target/debug/agent-switch-gui"), false);
  assert.equal(bundleRunningIn("/r/target/debug/agent-switch-gui", "node target/debug/agent-switch-gui-wrapper.js"), false);
});
