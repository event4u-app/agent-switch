/**
 * Generate the source app icon (1024×1024 RGBA PNG) with zero dependencies.
 *
 * Brand mark: an event4u-orange rounded-square with a white rotating-arrows
 * "refresh" glyph (a broken ring + two clockwise arrowheads — the reset/switch
 * motif). Edit the palette or glyph below, then re-run
 * `npm run tauri icon <this-output>` to regenerate the platform set.
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
// Colored mode: event4u-orange body + white glyph. Template mode: opaque body
// (color is ignored by macOS; black is the correct neutral for other
// platforms) and the glyph cut out to transparency.
const BG = template ? [0, 0, 0, 255] : [209, 92, 56, 255]; // #d15c38 event4u orange
const FG = [255, 255, 255, 255]; // white glyph (colored mode only)
const CLEAR = [0, 0, 0, 0];

// --- geometry helpers ---
const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
};
const sign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
const inTri = (px, py, ax, ay, bx, by, cx, cy) => {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

// A "refresh" mark: two clockwise arcs (a broken ring with two ~10° gaps) plus
// an arrowhead at each arc's leading end — the rotating-arrows / recycle glyph.
const CX = 512, CY = 512;
const R_IN = 262, R_OUT = 340; // ~78px stroke
const R_MID = (R_IN + R_OUT) / 2;
const DEG = Math.PI / 180;
// Two ~170° arcs (clockwise; image y grows down), gaps at ~205° (lower-left)
// and ~25° (right) where the arrowheads sit.
const inArc = (x, y) => {
  const dx = x - CX, dy = y - CY;
  const d = Math.hypot(dx, dy);
  if (d < R_IN || d > R_OUT) return false;
  let a = Math.atan2(dy, dx) / DEG;
  if (a < 0) a += 360;
  return (a >= 30 && a <= 200) || a >= 210 || a <= 20;
};
// Arrowhead triangle at the leading (clockwise) end of an arc — [tip, outer,
// inner] vertices flaring past the stroke and pointing along the tangent.
const head = (deg) => {
  const a = deg * DEG;
  const rx = Math.cos(a), ry = Math.sin(a);
  const tx = -Math.sin(a), ty = Math.cos(a); // clockwise tangent
  const flare = 52, len = 132;
  return [
    CX + R_MID * rx + tx * len, CY + R_MID * ry + ty * len,
    CX + (R_OUT + flare) * rx, CY + (R_OUT + flare) * ry,
    CX + (R_IN - flare) * rx, CY + (R_IN - flare) * ry,
  ];
};
const H1 = head(200), H2 = head(20);
const glyph = (x, y) =>
  inArc(x, y) ||
  inTri(x, y, H1[0], H1[1], H1[2], H1[3], H1[4], H1[5]) ||
  inTri(x, y, H2[0], H2[1], H2[2], H2[3], H2[4], H2[5]);

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
