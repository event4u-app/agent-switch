/**
 * Generate the macOS menu-bar template icon (1024×1024 RGBA PNG) with zero
 * dependencies, from the geometry of the app mark.
 *
 * The coloured app icon is not generated: its source is the designed artwork
 * `src-tauri/icons/source/agent-switch-icon-{dark,light}.svg` (+ the rendered
 * `icon-source.png`). Regenerate the platform set with
 * `npm run tauri icon icon-source.png`.
 *
 * The template must be monochrome-by-alpha: macOS renders it by its alpha
 * channel alone (black on a light menu bar, white on a dark one), so the
 * gradients and glow of the app mark cannot be used. This draws the same
 * strokes — the two switch arcs, their arrowheads and the check — opaque on
 * transparent, with 4×4 supersampling for clean edges at 22 pt.
 *
 *   node scripts/gen-icon.mjs [outfile]   (default: src-tauri/icons/tray.png)
 */
import * as zlib from "node:zlib";
import * as fs from "node:fs";

const out = process.argv[2] ?? "src-tauri/icons/tray.png";
const S = 1024;
const SS = 4;
const DEG = Math.PI / 180;

// Geometry in the 1024 viewBox of the app mark. Strokes are slightly heavier
// than the artwork so the glyph survives the 22 pt menu-bar size.
const C = 512, R = 286, ARC_W = 92, CHECK_W = 64;
const ARCS = [
  [218, 325], // warm arc, upper half, clockwise
  [38, 145], // cool arc, lower half, clockwise
];
const TRIS = [
  [720, 245, 821, 357, 657, 370],
  [304, 781, 203, 669, 367, 656],
];
const CHECK = [[414, 510], [476, 573], [610, 438]];

const angleOf = (x, y) => {
  const a = Math.atan2(y - C, x - C) / DEG;
  return a < 0 ? a + 360 : a;
};
const capsOf = ([a0, a1]) => [a0, a1].map((a) => [C + R * Math.cos(a * DEG), C + R * Math.sin(a * DEG)]);
const inArc = (x, y, [a0, a1]) => {
  const d = Math.hypot(x - C, y - C);
  if (Math.abs(d - R) <= ARC_W / 2) {
    const a = angleOf(x, y);
    if (a >= a0 && a <= a1) return true;
  }
  // Round cap only at the tail; the head end runs into its arrowhead.
  const [[cx, cy]] = capsOf([a0, a1]);
  return Math.hypot(x - cx, y - cy) <= ARC_W / 2;
};
const sign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
const inTri = (px, py, [ax, ay, bx, by, cx, cy]) => {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const inCheck = (x, y) =>
  segDist(x, y, CHECK[0], CHECK[1]) <= CHECK_W / 2 || segDist(x, y, CHECK[1], CHECK[2]) <= CHECK_W / 2;

const covered = (x, y) => ARCS.some((a) => inArc(x, y, a)) || TRIS.some((t) => inTri(x, y, t)) || inCheck(x, y);

const raw = Buffer.alloc(S * (S * 4 + 1));
let o = 0;
for (let y = 0; y < S; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    let hits = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) if (covered(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
    raw[o++] = 0; raw[o++] = 0; raw[o++] = 0;
    raw[o++] = Math.round((255 * hits) / (SS * SS));
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
