import { Fragment, type ReactNode } from "react";
import { t, type TKey } from "./index.js";

/** `t()` for copy with React nodes inside: `{name}` placeholders take nodes
 *  (`tx("x.nothing", { q: <b>{q}</b> })`), so word order stays the
 *  translation's, never the code's. String/number params work as in `t()`. */
export function tx(key: TKey, nodes: Record<string, ReactNode>): ReactNode {
  const marker = "\u0000";
  const pre = t(key, Object.fromEntries(Object.keys(nodes).map((k) => [k, `${marker}${k}${marker}`])));
  const parts = pre.split(marker);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          return <Fragment key={i}>{nodes[p]}</Fragment>;
        }
        return p ? <Fragment key={i}>{p}</Fragment> : null;
      })}
    </>
  );
}
