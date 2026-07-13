/**
 * Generate the source app icon (1024×1024 RGBA PNG) with zero dependencies.
 *
 * PLACEHOLDER brand mark: a dark rounded-square with a white "⇄" switch glyph
 * (two offset arrows — evokes account switching). Replace with real branding
 * anytime, then re-run `npm run tauri icon <this-output>` to regenerate the
 * platform set.
 *
 * Two modes:
 *   node scripts/gen-icon.mjs [outfile]              → colored app/bundle icon
 *   node scripts/gen-icon.mjs --template [outfile]   → macOS menu-bar template
 *
 * The `--template` icon is monochrome-by-alpha: the body is opaque (black),
 * the arrows are cut out to full transparency. macOS renders a template image
 * by its alpha channel alone — painting the opaque body black on a light menu
 * bar and white on a dark one, so it matches the other menu-bar icons, while
 * the transparent arrows show the bar through. Default outfile: tray.png.
 */
import * as zlib from "node:zlib";
import * as fs from "node:fs";

const args = process.argv.slice(2);
const template = args.includes("--template");
const out = args.find((a) => !a.startsWith("--")) ?? (template ? "tray.png" : "icon-source.png");

const S = 1024;

// --- palette ---
// Colored mode: indigo body + white glyph. Template mode: opaque body (color
// is ignored by macOS; black is the correct neutral for other platforms) and
// the glyph cut out to transparency.
const BG = template ? [0, 0, 0, 255] : [55, 48, 163, 255];
const FG = [255, 255, 255, 255]; // white glyph (colored mode only)
const CLEAR = [0, 0, 0, 0];

// --- geometry helpers ---
const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
};
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const sign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
const inTri = (px, py, ax, ay, bx, by, cx, cy) => {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

// Top arrow → right; bottom arrow → left (a "⇄" switch mark).
const glyph = (x, y) =>
  inRect(x, y, 312, 420, 652, 468) || inTri(x, y, 636, 392, 636, 496, 724, 444) || // top: shaft + head
  inRect(x, y, 372, 556, 712, 604, 712) || inTri(x, y, 388, 528, 388, 632, 300, 580); // bottom: shaft + head

function pixel(x, y) {
  // Template mode cuts the arrows out (transparent) instead of filling them.
  if (glyph(x, y)) return template ? CLEAR : FG;
  if (inRoundedRect(x, y, 64, 64, 960, 960, 180)) return BG;
  return CLEAR;
}

// --- encode PNG ---
const raw = Buffer.alloc(S * (S * 4 + 1));
let o = 0;
for (let y = 0; y < S; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    const [r, g, b, a] = pixel(x, y);
    raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${S}x${S}, ${png.length} bytes)`);
