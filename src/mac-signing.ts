/**
 * Stable local code signature for the downloaded macOS GUI.
 *
 * Release bundles are only ad-hoc signed, so TCC binds a folder grant to the cdhash and asks again
 * after every update. Re-signing each downloaded bundle with one self-signed identity created on
 * this Mac gives every version the same designated requirement (`certificate leaf = H"<sha1>"`),
 * so the grant survives updates. Only macOS built-ins: openssl (LibreSSL), security, codesign.
 *
 * The identity is durable user data: its leaf SHA-1 is recorded and reused. A new leaf is made only
 * when none exists, or when the recorded one is really gone — then loudly, since it costs the user
 * one more prompt. Every partial state an interrupted run can leave is detected and repaired.
 * Signing never blocks a launch: a failure is one stderr line plus a debug-log record.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { clean, logDebug, type DebugEntry } from "./debug-log.js";
import { withFileLockSync } from "./locks.js";

export const SIGNING_ROOT = path.join(os.homedir(), ".agent-switch", "signing");
export const IDENTITY_CN = "Agent Switch Local Signing";
const SECURITY = "/usr/bin/security";
const OPENSSL = "/usr/bin/openssl";
const CODESIGN = "/usr/bin/codesign";
/** Creating a leaf takes a few seconds; a second CLI waits for it instead of making its own. */
const LOCK_WAIT_MS = 30_000;

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type Runner = (cmd: string, args: readonly string[], env?: Record<string, string>) => RunResult;

export interface SignEnv {
  platform: string;
  /** Holds the keychain, its password file and identity.json. */
  root: string;
  run: Runner;
  processList: () => string;
  warn: (line: string) => void;
  log: (e: Omit<DebugEntry, "at" | "src">) => void;
  newPassword: () => string;
}

export function defaultSignEnv(processList: () => string): SignEnv {
  return {
    platform: process.platform,
    root: SIGNING_ROOT,
    run: (cmd, args, extra) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", env: extra ? { ...process.env, ...extra } : process.env });
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
    },
    processList,
    warn: (line) => console.error(line),
    log: logDebug,
    newPassword: () => randomBytes(24).toString("base64url"),
  };
}

export function signingPaths(root: string) {
  return {
    keychain: path.join(root, "agent-switch-signing.keychain-db"),
    password: path.join(root, "keychain-password"),
    identity: path.join(root, "identity.json"),
  };
}

/** Entries of `security list-keychains -d user`, unquoted, in order. Pure. */
export function parseKeychainList(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('"') && l.endsWith('"') && l.length >= 2 ? l.slice(1, -1) : l));
}

/** The search list with `ours` appended, every existing entry kept exactly; null when it is
 *  already there (nothing to write). Pure. */
export function mergeSearchList(existing: readonly string[], ours: string): string[] | null {
  if (existing.some((e) => path.resolve(e) === path.resolve(ours))) return null;
  return [...existing, ours];
}

/** Identities from `security find-identity` (with or without `-v`), deduplicated. Pure. */
export function parseIdentities(out: string): { sha1: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const m of out.matchAll(/^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]*)"/gm)) seen.set(m[1].toUpperCase(), m[2]);
  return [...seen].map(([sha1, name]) => ({ sha1, name }));
}

/** SHA-1 from `openssl x509 -fingerprint -sha1` output, as 40 upper-case hex digits. Pure. */
export function sha1FromFingerprint(out: string): string | null {
  const m = /Fingerprint=([0-9A-Fa-f:]+)/.exec(out);
  const hex = m ? m[1].replace(/:/g, "").toUpperCase() : "";
  return /^[0-9A-F]{40}$/.test(hex) ? hex : null;
}

/** How a bundle is signed now, from `codesign -dv` output. Pure. */
export function signatureState(out: string): { kind: "unsigned" | "adhoc" } | { kind: "identity"; authority: string } {
  if (/not signed at all/i.test(out)) return { kind: "unsigned" };
  if (/Signature=adhoc/.test(out)) return { kind: "adhoc" };
  const a = /^Authority=(.+)$/m.exec(out);
  return a ? { kind: "identity", authority: a[1].trim() } : { kind: "adhoc" };
}

/** The leaf SHA-1 a designated requirement pins, or null. Pure. */
export function designatedLeaf(out: string): string | null {
  const m = /certificate leaf = H"([0-9A-Fa-f]{40})"/.exec(out);
  return m ? m[1].toUpperCase() : null;
}

/** Whether the bundle at `app` (or the bare binary at `app`) is running, in a process-list snapshot. Pure. */
export function bundleRunningIn(app: string, processList: string): boolean {
  if (app.endsWith(".app")) return processList.includes(path.join(app, "Contents", "MacOS") + path.sep);
  // A bare binary shows as its command, absolute or relative to where it was started (cargo: `target/debug/…`).
  return processList.split("\n").some((l) => {
    const cmd = l.trim().split(/\s+/)[0];
    return !!cmd && (cmd === app || (!cmd.startsWith("/") && app.endsWith(path.sep + cmd)));
  });
}

class StepError extends Error {}

/** Runs one command; a non-zero exit becomes an error naming the step (stderr cleaned). */
function must(env: SignEnv, step: string, cmd: string, args: readonly string[], extra?: Record<string, string>): RunResult {
  // The lock counts as stale after 10 s without a touch; creating a leaf and signing take several steps.
  touchLock(env.root);
  const r = env.run(cmd, args, extra);
  if (r.status !== 0) throw new StepError(`${step} failed (exit ${r.status ?? "none"}${r.stderr.trim() ? `: ${clean(r.stderr, 120)}` : ""})`);
  return r;
}

function touchLock(root: string): void {
  const now = new Date();
  try {
    fs.utimesSync(signingPaths(root).identity + ".lock", now, now);
  } catch {
    // not held (outside the lock) or already gone
  }
}

function readRecorded(file: string): string | null {
  try {
    const sha1 = JSON.parse(fs.readFileSync(file, "utf8"))?.sha1;
    return typeof sha1 === "string" && /^[0-9A-F]{40}$/.test(sha1) ? sha1 : null;
  } catch {
    return null; // missing or torn: whatever the keychain holds decides
  }
}

function readPassword(file: string): string | null {
  try {
    const pw = fs.readFileSync(file, "utf8").trim();
    return pw || null;
  } catch {
    return null;
  }
}

function writePrivate(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

/** A keychain nobody can unlock is moved aside, never deleted: it may still be wanted by hand. */
function setAside(keychain: string): void {
  fs.renameSync(keychain, `${keychain}.unusable-${Date.now()}`);
}

function ensureSearchList(env: SignEnv, keychain: string): void {
  const now = parseKeychainList(must(env, "reading the keychain search list", SECURITY, ["list-keychains", "-d", "user"]).stdout);
  const next = mergeSearchList(now, keychain);
  if (next) must(env, "adding the signing keychain to the search list", SECURITY, ["list-keychains", "-d", "user", "-s", ...next]);
}

function ourIdentities(env: SignEnv, keychain: string): string[] {
  const out = must(env, "listing signing identities", SECURITY, ["find-identity", "-p", "codesigning", keychain]).stdout;
  return parseIdentities(out)
    .filter((i) => i.name === IDENTITY_CN)
    .map((i) => i.sha1);
}

function allowCodesign(env: SignEnv, keychain: string, pw: string): void {
  must(env, "allowing codesign to use the key", SECURITY, ["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", pw, keychain]);
}

function createLeaf(env: SignEnv, keychain: string, pw: string, secrets: string[]): string {
  const tmp = fs.mkdtempSync(path.join(env.root, "tmp-"));
  try {
    const cnf = path.join(tmp, "req.cnf");
    const keyFile = path.join(tmp, "leaf-k");
    const certFile = path.join(tmp, "leaf-c");
    const bundle = path.join(tmp, "leaf.bundle");
    fs.writeFileSync(
      cnf,
      [
        "[req]",
        "distinguished_name = dn",
        "prompt = no",
        "[dn]",
        `CN = ${IDENTITY_CN}`,
        "[ext]",
        "basicConstraints = critical,CA:false",
        "keyUsage = critical,digitalSignature",
        "extendedKeyUsage = critical,codeSigning",
        "subjectKeyIdentifier = hash",
        "",
      ].join("\n"),
    );
    must(env, "creating the signing certificate", OPENSSL, [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650",
      "-keyout", keyFile, "-out", certFile, "-config", cnf, "-extensions", "ext",
    ]);
    const sha1 = sha1FromFingerprint(must(env, "reading the certificate fingerprint", OPENSSL, ["x509", "-in", certFile, "-noout", "-fingerprint", "-sha1"]).stdout);
    if (!sha1) throw new StepError("reading the certificate fingerprint failed (no SHA-1)");
    const transferPw = randomBytes(18).toString("base64url");
    secrets.push(transferPw);
    // A one-off password for the temporary bundle: openssl takes it from the environment, but
    // `security import` only takes it as an argument. The bundle is deleted right after.
    must(env, "packing the identity", OPENSSL, ["pkcs12", "-export", "-inkey", keyFile, "-in", certFile, "-name", IDENTITY_CN, "-out", bundle, "-passout", "env:AS_SIGN_PASS"], { AS_SIGN_PASS: transferPw });
    must(env, "importing the identity", SECURITY, ["import", bundle, "-k", keychain, "-f", "pkcs12", "-P", transferPw, "-T", CODESIGN]);
    allowCodesign(env, keychain, pw);
    if (!ourIdentities(env, keychain).includes(sha1)) throw new StepError("importing the identity failed (not in the keychain afterwards)");
    return sha1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The leaf SHA-1 to sign with, creating or repairing whatever is missing. Call under the lock.
 * Partial states and their repair:
 *  - keychain without password file, or a password it rejects → moved aside, a new one is made;
 *  - password file without keychain → a new keychain (and password);
 *  - keychain holding our identity but no (readable) identity.json → that leaf is adopted;
 *  - identity.json whose leaf is gone from the keychain → a new leaf, reported loudly;
 *  - temp key material from an interrupted run → deleted.
 */
export function ensureIdentity(env: SignEnv, secrets: string[] = []): string {
  const p = signingPaths(env.root);
  fs.mkdirSync(env.root, { recursive: true, mode: 0o700 });
  fs.chmodSync(env.root, 0o700);
  for (const n of fs.readdirSync(env.root)) {
    if (n.startsWith("tmp-")) fs.rmSync(path.join(env.root, n), { recursive: true, force: true });
  }
  const recorded = readRecorded(p.identity);
  let pw = readPassword(p.password);
  if (pw) secrets.push(pw);

  if (fs.existsSync(p.keychain)) {
    if (!pw) setAside(p.keychain);
    else {
      const u = env.run(SECURITY, ["unlock-keychain", "-p", pw, p.keychain]);
      if (u.status !== 0) {
        // Only a rejected password makes it unusable; any other failure may pass, so keep it.
        if (!/passphrase|password/i.test(u.stderr)) throw new StepError(`unlocking the signing keychain failed (exit ${u.status ?? "none"})`);
        setAside(p.keychain);
      }
    }
  }
  if (!fs.existsSync(p.keychain)) {
    pw = env.newPassword();
    secrets.push(pw);
    // Password first: a run stopped after this leaves a keychain that can still be opened.
    writePrivate(p.password, pw);
    must(env, "creating the signing keychain", SECURITY, ["create-keychain", "-p", pw, p.keychain]);
    must(env, "unlocking the signing keychain", SECURITY, ["unlock-keychain", "-p", pw, p.keychain]);
  }
  // No -t/-l: never lock on timeout or sleep. Re-applied each time to repair a half-made keychain.
  must(env, "setting the keychain to stay unlocked", SECURITY, ["set-keychain-settings", p.keychain]);
  ensureSearchList(env, p.keychain);

  const present = ourIdentities(env, p.keychain);
  if (recorded && present.includes(recorded)) return recorded;

  const adopted = present[0] ?? null;
  // An adopted leaf may come from a run stopped before the partition list was set; codesign would prompt.
  if (adopted) allowCodesign(env, p.keychain, pw!);
  const sha1 = adopted ?? createLeaf(env, p.keychain, pw!, secrets);
  writePrivate(p.identity, JSON.stringify({ sha1, createdAt: new Date().toISOString() }) + "\n");
  if (recorded) {
    env.warn(
      "agent-switch: the local signing identity for the GUI was gone and has been replaced — " +
        "macOS will ask once more for folder access.",
    );
    env.log({ kind: "error", what: "gui-sign-identity-replaced", ok: true, detail: { adopted: !!adopted } });
  } else {
    env.log({ kind: "action", what: adopted ? "gui-sign-identity-adopted" : "gui-sign-identity-created", ok: true });
  }
  return sha1;
}

function signWith(env: SignEnv, app: string, sha1: string, identifier?: string): void {
  // By SHA-1, not name: codesign finds an untrusted identity only that way.
  const id = identifier ? ["--identifier", identifier] : [];
  must(env, "signing the GUI", CODESIGN, ["--force", "--deep", "--preserve-metadata=entitlements", ...id, "--sign", sha1, app]);
  must(env, "verifying the GUI signature", CODESIGN, ["--verify", "--deep", "--strict", app]);
  const dr = env.run(CODESIGN, ["-d", "-r-", app]);
  if (designatedLeaf(dr.stdout + dr.stderr) !== sha1) throw new StepError("verifying the GUI signature failed (designated requirement does not pin the leaf)");
}

export type SignOutcome = "signed" | "kept" | "running" | "skipped" | "failed";

/**
 * Give the bundle at `app` the stable local signature. A bundle that is running is never touched;
 * one already pinned to our recorded leaf, or signed by someone else, is kept. Never throws.
 * `identifier` names a bare binary (the dev build), which has no Info.plist to take it from:
 * without it codesign derives one from the linker's hashed name, which changes with every build.
 */
export function stabilizeSignature(app: string, env: SignEnv, identifier?: string): SignOutcome {
  if (env.platform !== "darwin") return "skipped";
  const secrets: string[] = [];
  try {
    if (bundleRunningIn(app, env.processList())) return "running";
    // -dvv, not -dv: only from the second v on does codesign print the Authority lines.
    const dv = env.run(CODESIGN, ["-dvv", app]);
    const state = signatureState(dv.stdout + dv.stderr);
    if (state.kind === "identity") {
      if (state.authority !== IDENTITY_CN) return "kept";
      const dr = env.run(CODESIGN, ["-d", "-r-", app]);
      if (designatedLeaf(dr.stdout + dr.stderr) === readRecorded(signingPaths(env.root).identity)) return "kept";
    }
    return withFileLockSync(
      signingPaths(env.root).identity,
      () => {
        const sha1 = ensureIdentity(env, secrets);
        if (bundleRunningIn(app, env.processList())) return "running"; // started while we waited
        signWith(env, app, sha1, identifier);
        env.log({ kind: "action", what: "gui-sign", ok: true });
        return "signed" as const;
      },
      LOCK_WAIT_MS,
    );
  } catch (e) {
    let cause = e instanceof Error ? e.message : String(e);
    for (const s of secrets) cause = cause.split(s).join("[redacted]");
    cause = clean(cause, 200);
    env.warn(`agent-switch: could not give the GUI its stable signature (${cause}) — it starts anyway, but macOS may ask again for folder access.`);
    env.log({ kind: "error", what: "gui-sign", ok: false, error: cause });
    return "failed";
  }
}
