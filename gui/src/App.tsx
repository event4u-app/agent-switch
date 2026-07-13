import { useEffect, useState } from "react";
import { activeStatus, listProfiles, openSession, switchProfile } from "./ipc.js";
import { groupByProvider, nearestLimit, type ProfileRow, type StatusJson, type ProviderId } from "./transforms.js";

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };

export default function App() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [status, setStatus] = useState<StatusJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setRows(await listProfiles());
      setStatus(await activeStatus());
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const grouped = groupByProvider(rows);
  const limit = nearestLimit(status?.usage ?? null);

  return (
    <main style={{ font: "13px -apple-system, system-ui, sans-serif", padding: 12, minWidth: 320 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>agent-switch</strong>
        <button onClick={refresh}>Refresh</button>
      </header>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {status && (
        <section style={{ margin: "8px 0", padding: 8, background: "rgba(127,127,127,.1)", borderRadius: 6 }}>
          <div>
            Active: <strong>{status.provider}/{status.name}</strong>
          </div>
          {status.usage ? (
            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
              {status.usage.windows.map((w) => (
                <li key={w.key}>
                  {w.label}: {w.utilization ?? "?"}%
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ opacity: 0.7 }}>no usage source</div>
          )}
          {limit !== null && <div style={{ opacity: 0.7 }}>nearest own limit: {limit}%</div>}
        </section>
      )}

      {(Object.keys(grouped) as ProviderId[]).map((pid) =>
        grouped[pid].length === 0 ? null : (
          <section key={pid} style={{ marginTop: 8 }}>
            <div style={{ opacity: 0.6, textTransform: "uppercase", fontSize: 11 }}>{PROVIDER_LABEL[pid]}</div>
            {grouped[pid].map((r) => (
              <div key={r.name} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>
                  {r.active ? "● " : "○ "}
                  {r.name} <span style={{ opacity: 0.6 }}>{r.identity ?? "—"}</span>
                  {r.liveSessions > 0 && <span style={{ opacity: 0.6 }}> · {r.liveSessions} live</span>}
                </span>
                <span>
                  {!r.active && <button onClick={() => switchProfile(pid, r.name).then(refresh)}>Use</button>}{" "}
                  <button onClick={() => openSession(pid, r.name)}>Run</button>
                </span>
              </div>
            ))}
          </section>
        ),
      )}
    </main>
  );
}
