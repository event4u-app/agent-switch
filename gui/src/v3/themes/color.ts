/** Tiny sRGB helpers for the theme system: WCAG contrast and mixing. Pure. */

export type Hex = `#${string}`;

function parse(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): Hex {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}` as Hex;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = parse(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** `a` mixed toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): Hex {
  const [p, q] = [parse(a), parse(b)];
  return toHex([0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * t) as [number, number, number]);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * The smallest shift of `fg` toward white (dark themes) or black (light themes)
 * that reaches `min` contrast against every background. The theme's own colour
 * is kept when it already passes — derived only where the palette falls short.
 */
export function ensureContrast(fg: string, bgs: string[], min: number, dark: boolean): Hex {
  const target = dark ? "#ffffff" : "#000000";
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(fg, target, t);
    if (bgs.every((bg) => contrast(c, bg) >= min)) return c;
  }
  return target as Hex;
}
