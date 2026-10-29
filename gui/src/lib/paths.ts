/**
 * Folder paths typed into the window (binding form, start folder). The CLI
 * gets an absolute path: a leading `~` is expanded here, because no shell sits
 * between the GUI and `agent-switch`. A path starting with `-` is refused — the
 * CLI would parse it as a flag.
 */

import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";

/** `~` / `~/x` → `<home>` / `<home>/x`; anything else (and an unknown home) unchanged. */
export function expandHome(path: string, home: string | null): string {
  if (!home || (path !== "~" && !path.startsWith("~/"))) return path;
  const base = home.replace(/\/+$/, "");
  return path === "~" ? base : `${base}${path.slice(1)}`;
}

/** Why a typed folder can't be used, or null. */
export function folderProblem(path: string): string | null {
  return path.trim().startsWith("-") ? "A folder path can't start with “-”." : null;
}

export type TypedFolder = { ok: true; path: string } | { ok: false; reason: string };

/** The folder to send to the CLI for what the user typed. */
export function typedFolder(raw: string, home: string | null): TypedFolder {
  const path = raw.trim();
  if (!path) return { ok: false, reason: "Enter a folder path." };
  const problem = folderProblem(path);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, path: expandHome(path, home) };
}

let cached: Promise<string | null> | null = null;

/** The user's home dir via Tauri's path API (null outside Tauri). */
export function getHomeDir(): Promise<string | null> {
  cached ??= homeDir().then(
    (h) => h || null,
    () => null,
  );
  return cached;
}

/** React: the home dir once known (null until then / outside Tauri). */
export function useHomeDir(): string | null {
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getHomeDir().then((h) => alive && setHome(h));
    return () => {
      alive = false;
    };
  }, []);
  return home;
}
