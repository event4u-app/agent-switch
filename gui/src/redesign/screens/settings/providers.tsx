import { useState } from "react";
import { Link2 } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import type { ProviderId, ProviderSurface } from "../../../transforms.js";
import { Badge } from "../../../ui/Badge.js";
import { Button } from "../../../ui/Button.js";
import { SettingGroup } from "../../../ui/Setting.js";
import { Switch } from "../../../ui/Switch.js";
import { TextInput } from "../../../ui/TextInput.js";
import { TOOL_LABEL } from "../../../vm/rules.js";
import { useAS } from "../../../vm/store.js";
import type { Provider } from "../../../vm/types.js";
import { useRun } from "./prefs.js";

/** Gemini has no backend; the design lists it as planned. */
const GEMINI_PLANNED: Provider = { id: "gemini", installed: false, binaryPath: null, binName: "gemini", cli: false, gui: null, planned: true };

/** The provider list as shown: the backend's providers plus the planned ones it lacks. */
export function providerRows(providers: readonly Provider[]): Provider[] {
  return providers.some((p) => p.id === "gemini") ? [...providers] : [...providers, GEMINI_PLANNED];
}

/** Settings › Providers (bundle `hR`, artboard 24). */
export function ProvidersSettings() {
  const s = useAS();
  const run = useRun();
  const [linking, setLinking] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  // Only a provider with a registered desktop app gets an App switch (classic window).
  const withApp = new Set(s.surfaces.map((x) => x.tool));

  async function link(id: ProviderId) {
    const p = path.trim();
    if (!p || !s.act.linkProviderBinary) return;
    setBusy(true);
    const ok = await run(async () => (await s.act.linkProviderBinary!(id, p), true));
    setBusy(false);
    if (ok) {
      setLinking(null);
      setPath("");
    }
  }

  async function unlink(id: ProviderId) {
    if (!s.act.unlinkProviderBinary) return;
    setBusy(true);
    await run(() => s.act.unlinkProviderBinary!(id));
    setBusy(false);
  }

  return (
    <>
      <p className="-mt-2 text-xs text-ac-muted">
        Enable the providers you use. Disabling one hides it — your accounts are kept and return when you re-enable it. If
        a provider's CLI isn't on your PATH, link its binary and you can still use it.
      </p>
      <SettingGroup>
        {providerRows(s.providers).map((u) => {
          const id = u.id as ProviderId;
          const surfaces: ("cli" | "gui")[] = u.planned ? ["cli"] : withApp.has(u.id) ? ["cli", "gui"] : ["cli"];
          return (
            <div key={u.id} className="flex flex-col gap-3 px-4 py-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className={cn("flex items-center gap-2 text-[13px]", u.installed ? "text-ac-text" : "text-ac-muted")}>
                    {TOOL_LABEL[u.id]}
                    {u.planned && <Badge tone="info">Planned</Badge>}
                  </p>
                  <p className="mt-0.5 truncate font-ac-mono text-[11px] text-ac-muted" title={u.binaryPath ?? undefined}>
                    {u.planned
                      ? "Sign-in support is planned."
                      : u.binaryPath
                        ? `Linked: ${u.binaryPath}`
                        : u.installed
                          ? "Installed"
                          : "Not installed — link its binary to use it"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {surfaces.map((surface) => {
                    const checked = surface === "cli" ? u.cli : !!u.gui;
                    // Can't turn a surface ON while the provider isn't installed or linked.
                    const disabled = (!u.installed && !checked) || !!u.planned || !s.act.setProvider;
                    const name = `${TOOL_LABEL[u.id]} ${surface === "cli" ? "CLI" : "App"}`;
                    const backendSurface: ProviderSurface = surface === "cli" ? "cli" : "ui";
                    return (
                      <span key={surface} className="flex items-center gap-2 text-[11px] text-ac-muted">
                        {surface === "cli" ? "CLI" : "App"}
                        <Switch
                          label={name}
                          checked={checked}
                          disabled={disabled}
                          onChange={(on) => void run(() => s.act.setProvider!(id, backendSurface, on))}
                        />
                      </span>
                    );
                  })}
                </div>
              </div>
              {!u.planned && (u.binaryPath || !u.installed) && linking !== u.id && (
                <div className="flex flex-wrap gap-2">
                  {u.binaryPath ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setLinking(u.id);
                          setPath(u.binaryPath ?? "");
                        }}
                      >
                        <Link2 /> Change link
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void unlink(id)}>
                        Unlink
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setLinking(u.id);
                        setPath("");
                      }}
                    >
                      <Link2 /> Link binary …
                    </Button>
                  )}
                </div>
              )}
              {linking === u.id && (
                <div className="flex items-center gap-2">
                  <TextInput
                    mono
                    autoFocus
                    aria-label={`Path to ${u.binName}`}
                    className="flex-1"
                    value={path}
                    placeholder={`/full/path/to/${u.binName}`}
                    onChange={(e) => setPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void link(id);
                      if (e.key === "Escape") setLinking(null);
                    }}
                  />
                  <Button size="sm" variant="primary" disabled={busy || !path.trim()} onClick={() => void link(id)}>
                    Link
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLinking(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </SettingGroup>
    </>
  );
}
