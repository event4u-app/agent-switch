/**
 * Wires the council / arena / panel control to agent-config through the CLI: the global setting on Settings ›
 * Agents and one chat's own choice in its status bar. Read when shown and after every change.
 */

import { useCallback, useEffect, useState } from "react";

import * as ipc from "../../ipc.js";
import { DeliberationChip, DeliberationSettings, type DeliberationMode, type DeliberationState } from "../deliberation.js";

export function useDeliberation(key?: string, read = ipc.deliberationGet, write = ipc.deliberationSet) {
  const [state, setState] = useState<DeliberationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    read(key).then(
      (s) => alive && (setState(s), setError(null)),
      (e: unknown) => alive && setError(e instanceof Error ? e.message.split("\n")[0]! : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [key, read]);
  const set = useCallback(
    (mode: DeliberationMode | "inherit") =>
      write(mode, key).then(
        (s) => (setState(s), setError(null)),
        (e: unknown) => setError(e instanceof Error ? e.message.split("\n")[0]! : String(e)),
      ),
    [key, write],
  );
  return { state, error, set };
}

export function DeliberationGlobalSlot({ read, write }: { read?: typeof ipc.deliberationGet; write?: typeof ipc.deliberationSet }) {
  const d = useDeliberation(undefined, read, write);
  return <DeliberationSettings state={d.state} error={d.error} onChange={(m) => void d.set(m)} />;
}

/** Nothing while it loads or when agent-config cannot answer: the status bar stays as it was. */
export function DeliberationChipSlot({ sessionKey, read, write }: { sessionKey: string; read?: typeof ipc.deliberationGet; write?: typeof ipc.deliberationSet }) {
  const own = useDeliberation(sessionKey, read, write);
  const global = useDeliberation(undefined, read, write);
  if (!own.state || own.error) return null;
  return <DeliberationChip state={own.state} global={global.state?.mode ?? null} onChange={(m) => void own.set(m).then(() => undefined)} />;
}
