# agent-switch GUI (tray/menubar)

A Tauri (Rust tray/window + React UI) client for `agent-switch`. It is a **client
of the CLI** — it never re-implements profile or credential logic. It calls the
`agent-switch <cmd> --json` contract and reads `daemon-state.json`.

## Contract (the only coupling to the core)

- `agent-switch list --json` — profiles grouped by provider (identity/active/live).
- `agent-switch status --json` — the **active** profile's own usage snapshot.
- `agent-switch service status` — daemon health.
- Actions call `agent-switch use|run|web`.

No cross-account usage ranking or switch-on-limit exists here (the anti-rotation
lock — see `agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md`).

## Develop

```bash
cd gui
npm install
npm test            # vitest — pure view-model transforms
npm run tauri dev   # run the tray app (needs the Rust toolchain + a desktop session)
npm run tauri build # package (.app/.dmg on macOS, .msi/.exe on Windows)
```

## Prerequisites (GUI only — the CLI core stays dependency-free)

- Node ≥ 18 and the Rust toolchain (`rustc`/`cargo`).
- A tray icon at `src-tauri/icons/icon.png` (generate with `npm run tauri icon <src>`).
- Platform webview: macOS/Windows ship one; Linux needs `webkit2gtk`.

The `agent-switch` binary must be on `PATH` (the GUI shells out to it).
