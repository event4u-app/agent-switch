/**
 * Files the user drops or pastes into the chat (road-to-agent-switch-v3-client
 * Phase 2). Images become content blocks; a file inside the session's folder is
 * named as `@relative/path`; any other file is copied into a per-session
 * staging folder first and named by that copy.
 *
 * The staging folder belongs to Agent Switch: files are written exclusively
 * (never through an existing name or link), named by their SHA-256, size-capped
 * and removed after STAGING_TTL_MS.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const STAGING_TTL_MS = 7 * 24 * 3600 * 1000;

const IMAGE_MAGIC: [string, number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
];

/** The image type by its first bytes, never by its name. Pure. */
export function sniffImage(b: Uint8Array): string | null {
  for (const [type, magic] of IMAGE_MAGIC) if (magic.every((x, i) => b[i] === x)) return type;
  // WEBP: "RIFF" .... "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export class AttachmentRefused extends Error {}

export type Incoming = { image: { mediaType: string; data: string } } | { file: { name: string; data: string } } | { path: string };

export type Resolved = { kind: "image"; mediaType: string; data: string } | { kind: "ref"; ref: string };

/** The staging folder of one session. */
export function stagingDir(root: string, sessionKey: string): string {
  return path.join(root, "attachments", crypto.createHash("sha256").update(sessionKey).digest("hex").slice(0, 32));
}

const safeName = (n: string) => path.basename(n).replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";

function stage(dir: string, name: string, bytes: Buffer): string {
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentRefused(`${name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const file = path.join(dir, `${sha.slice(0, 16)}-${safeName(name)}`);
  try {
    // "wx": fails if anything — a file or a planted link — already has the name.
    fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const st = fs.lstatSync(file);
    if (!st.isFile() || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== sha)
      throw new AttachmentRefused(`${name}: the staging name is taken by something else`);
  }
  return file;
}

/** Read a path the user dropped: a regular file only, never through a link, size-capped. */
function readDropped(p: string): Buffer {
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) throw new AttachmentRefused(`${path.basename(p)} is a link; drop the file itself`);
  if (!st.isFile()) throw new AttachmentRefused(`${path.basename(p)} is not a file`);
  if (st.size > MAX_ATTACHMENT_BYTES) throw new AttachmentRefused(`${path.basename(p)} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** One attachment → an image block or an `@` reference. */
export function resolveAttachment(a: Incoming, opts: { cwd: string; staging: string }): Resolved {
  if ("image" in a) {
    const bytes = Buffer.from(a.image.data, "base64");
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentRefused(`the image is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
    const type = sniffImage(bytes);
    if (!type) throw new AttachmentRefused("that is not an image Claude can read (PNG, JPEG, GIF, WebP)");
    return { kind: "image", mediaType: type, data: a.image.data };
  }
  if ("file" in a) {
    const bytes = Buffer.from(a.file.data, "base64");
    const type = sniffImage(bytes);
    if (type && bytes.length <= MAX_ATTACHMENT_BYTES) return { kind: "image", mediaType: type, data: a.file.data };
    return { kind: "ref", ref: `@${stage(opts.staging, a.file.name, bytes)}` };
  }
  const abs = path.resolve(opts.cwd, a.path);
  const rel = path.relative(opts.cwd, abs);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.isSymbolicLink()) throw new AttachmentRefused(`${rel} is not a file`);
    return { kind: "ref", ref: `@${rel.split(path.sep).join("/")}` };
  }
  const bytes = readDropped(abs);
  const type = sniffImage(bytes);
  if (type) return { kind: "image", mediaType: type, data: bytes.toString("base64") };
  return { kind: "ref", ref: `@${stage(opts.staging, path.basename(abs), bytes)}` };
}

/** Remove staged files older than the TTL; returns how many went. */
export function cleanStaging(root: string, now = Date.now()): number {
  const base = path.join(root, "attachments");
  let removed = 0;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(base);
  } catch {
    return 0;
  }
  for (const d of dirs) {
    const dir = path.join(base, d);
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      const p = path.join(dir, f);
      try {
        const st = fs.lstatSync(p);
        if (now - st.mtimeMs > STAGING_TTL_MS) (fs.unlinkSync(p), removed++);
      } catch {
        // gone already
      }
    }
  }
  return removed;
}
