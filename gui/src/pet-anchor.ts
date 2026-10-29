/** The pet's place as "this far from that corner of that screen", so a move to
 *  a screen of another size keeps it in the same corner. An absolute position
 *  from a laptop screen lands mid-screen on a wide monitor. All values are
 *  physical pixels. */

export interface Screen {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface PetAnchor {
  corner: Corner;
  /** Distance from the corner's vertical edge to the window's nearest edge. */
  dx: number;
  /** Distance from the corner's horizontal edge to the window's nearest edge. */
  dy: number;
  /** The screen it was placed on; null = whichever screen it is on. */
  screen: string | null;
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };

function contains(s: Screen, p: Point): boolean {
  return p.x >= s.position.x && p.x < s.position.x + s.size.width && p.y >= s.position.y && p.y < s.position.y + s.size.height;
}

export function anchorFor(pos: Point, size: Size, screens: readonly Screen[]): PetAnchor | null {
  const center = { x: pos.x + size.width / 2, y: pos.y + size.height / 2 };
  const s = screens.find((m) => contains(m, center)) ?? screens[0];
  if (!s) return null;
  const right = center.x >= s.position.x + s.size.width / 2;
  const bottom = center.y >= s.position.y + s.size.height / 2;
  return {
    corner: `${bottom ? "bottom" : "top"}-${right ? "right" : "left"}`,
    dx: Math.round(right ? s.position.x + s.size.width - (pos.x + size.width) : pos.x - s.position.x),
    dy: Math.round(bottom ? s.position.y + s.size.height - (pos.y + size.height) : pos.y - s.position.y),
    screen: s.name,
  };
}

/** Where the window goes for `anchor`: on its named screen when connected,
 *  else on `fallback`. Clamped so the window stays fully on that screen. */
export function placeFromAnchor(anchor: PetAnchor, size: Size, screens: readonly Screen[], fallback: Screen): Point {
  const s = (anchor.screen != null && screens.find((m) => m.name === anchor.screen)) || fallback;
  const right = anchor.corner.endsWith("right");
  const bottom = anchor.corner.startsWith("bottom");
  const x = right ? s.position.x + s.size.width - size.width - anchor.dx : s.position.x + anchor.dx;
  const y = bottom ? s.position.y + s.size.height - size.height - anchor.dy : s.position.y + anchor.dy;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    x: clamp(x, s.position.x, s.position.x + s.size.width - size.width),
    y: clamp(y, s.position.y, s.position.y + s.size.height - size.height),
  };
}
