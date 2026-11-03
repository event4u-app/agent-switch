import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { AttachmentRefused, MAX_ATTACHMENT_BYTES, STAGING_TTL_MS, cleanStaging, resolveAttachment, sniffImage, stagingDir } from "../src/bridge/attachments.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-att-")));

function setup() {
  const root = tmp();
  const cwd = path.join(root, "repo");
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "a.ts"), "x");
  return { root, cwd, staging: stagingDir(root, "claude/work/s1") };
}

test("sniffImage reads the bytes, not the name", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("GIF89a")), "image/gif");
  assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(Buffer.from("%PDF-1.7")), null);
});

test("a pasted image becomes an image block; a fake one is refused", () => {
  const o = setup();
  assert.deepEqual(resolveAttachment({ image: { mediaType: "image/jpeg", data: PNG.toString("base64") } }, o), { kind: "image", mediaType: "image/png", data: PNG.toString("base64") }, "the sniffed type wins");
  assert.throws(() => resolveAttachment({ image: { mediaType: "image/png", data: Buffer.from("not an image").toString("base64") } }, o), AttachmentRefused);
});

test("a file in the session's folder is named by its path; one outside is staged, by hash, owner-only", () => {
  const o = setup();
  assert.deepEqual(resolveAttachment({ path: path.join(o.cwd, "src", "a.ts") }, o), { kind: "ref", ref: "@src/a.ts" });
  const outside = path.join(o.root, "notes.txt");
  fs.writeFileSync(outside, "hello");
  const r = resolveAttachment({ path: outside }, o) as { ref: string };
  assert.match(r.ref, /^@.+[\\/][0-9a-f]{16}-notes\.txt$/);
  const staged = r.ref.slice(1);
  assert.equal(fs.readFileSync(staged, "utf8"), "hello");
  // Windows has no POSIX modes; the staging folder under the user's profile is what keeps it private there.
  if (process.platform !== "win32") assert.equal(fs.statSync(staged).mode & 0o777, 0o600);
  assert.deepEqual(resolveAttachment({ path: outside }, o), r, "the same file stages to the same name");
  const pic = path.join(o.root, "shot.dat");
  fs.writeFileSync(pic, PNG);
  assert.equal(resolveAttachment({ path: pic }, o).kind, "image", "an image is sent as an image, whatever its name");
  const dropped = resolveAttachment({ file: { name: "../../evil name.txt", data: Buffer.from("x").toString("base64") } }, o) as { ref: string };
  assert.match(dropped.ref, /-evil_name\.txt$/, "a dropped name cannot leave the staging folder");
  assert.ok(dropped.ref.slice(1).startsWith(o.staging));
});

test("links, folders, oversize files and a planted name are refused", () => {
  const o = setup();
  const real = path.join(o.root, "secret.txt");
  fs.writeFileSync(real, "s");
  const link = path.join(o.root, "link.txt");
  fs.symlinkSync(real, link);
  assert.throws(() => resolveAttachment({ path: link }, o), /is a link/);
  assert.throws(() => resolveAttachment({ path: o.root }, o), /not a file/);
  const big = path.join(o.root, "big.bin");
  fs.writeFileSync(big, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
  assert.throws(() => resolveAttachment({ path: big }, o), /larger than/);
  // Someone plants a link where the staged copy will go.
  const bytes = Buffer.from("payload");
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  fs.mkdirSync(o.staging, { recursive: true });
  fs.symlinkSync(real, path.join(o.staging, `${sha.slice(0, 16)}-p.txt`));
  assert.throws(() => resolveAttachment({ file: { name: "p.txt", data: bytes.toString("base64") } }, o), /taken by something else/);
  assert.equal(fs.readFileSync(real, "utf8"), "s", "the link target was not written");
});

test("cleanStaging removes copies past the TTL and keeps fresh ones", () => {
  const o = setup();
  const f = path.join(o.root, "n.txt");
  fs.writeFileSync(f, "n");
  const old = (resolveAttachment({ path: f }, o) as { ref: string }).ref.slice(1);
  fs.writeFileSync(path.join(o.root, "m.txt"), "m");
  const fresh = (resolveAttachment({ path: path.join(o.root, "m.txt") }, o) as { ref: string }).ref.slice(1);
  const past = new Date(Date.now() - STAGING_TTL_MS - 1000);
  fs.utimesSync(old, past, past);
  assert.equal(cleanStaging(o.root), 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(cleanStaging(path.join(o.root, "none")), 0);
});
