import type { IdentityColor } from "../vm/types.js";

export function identityColor(c: IdentityColor): string {
  return `var(--ac-id-${c})`;
}

/** Identity-colour circle; `ring` = halo while the account has live sessions. Bundle `je`. */
export function AccountDot({ color, size = 10, ring }: { color: IdentityColor; size?: number; ring?: boolean }) {
  const c = identityColor(color);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: c,
        boxShadow: ring ? `0 0 0 3px color-mix(in srgb, ${c} 25%, transparent)` : undefined,
      }}
    />
  );
}
