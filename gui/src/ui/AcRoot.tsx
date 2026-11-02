import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";

const PortalContainer = createContext<HTMLElement | null>(null);

/** Where Radix portals mount: inside the `.as-ac` root so overlays inherit its tokens. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainer) ?? undefined;
}

/** The redesign root (bundle `L0`). Children render only once the container
 *  exists, so the first overlay never portals to <body> outside the tokens.
 *  `mode` forces a palette; omitted → follows `data-theme` on <html>. */
export function AcRoot({
  mode,
  className,
  style,
  children,
}: {
  mode?: "light" | "dark";
  className?: string;
  /** v3 themes: the resolved `--ac-*` tokens, set on the root so they win over the stylesheet. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setEl} className={`as-ac ${className ?? ""}`} data-mode={mode} style={style}>
      <PortalContainer.Provider value={el}>{el && children}</PortalContainer.Provider>
    </div>
  );
}
