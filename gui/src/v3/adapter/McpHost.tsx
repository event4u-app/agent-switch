/** Accounts › MCP & plugins on real data: `mcp --json`, read when shown. */

import { useEffect, useState } from "react";

import * as ipc from "../../ipc.js";
import { McpView } from "../mcp.js";

export function McpHost({ toast, io = ipc }: { toast: (t: { tone: "alert"; text: string }) => void; io?: Pick<typeof ipc, "mcpList" | "mcpOpen"> }) {
  const [accounts, setAccounts] = useState<ipc.McpAccountJson[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    io.mcpList()
      .then((a) => alive && setAccounts(a))
      .catch((e: unknown) => alive && toast({ tone: "alert", text: `Could not read the MCP configuration: ${e instanceof Error ? e.message : String(e)}` }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [io]);
  return <McpView accounts={accounts} loading={loading} onReveal={(key) => void io.mcpOpen(key).catch((e: unknown) => toast({ tone: "alert", text: e instanceof Error ? e.message : String(e) }))} />;
}
