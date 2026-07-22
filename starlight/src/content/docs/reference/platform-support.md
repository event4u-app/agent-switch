---
title: Platform support
description: Cross-platform behavior, isolation gotchas, Windows specifics, and unsigned-build launch workarounds for agent-switch.
---

agent-switch is cross-platform with explicit degradation per OS and provider. Run [`agent-switch doctor`](/agent-switch/reference/cli/) for live per-OS / per-provider status.

:::note
`ADOPTED.md` in the repo tracks the full per-OS contract matrix (verified / degraded / broken) as the source of truth. This page is a brief summary — consult `ADOPTED.md` for the authoritative status.
:::

## Isolation gotchas

- `CLAUDE_CONFIG_DIR` relocates the config **home** only. On Linux the XDG state dir `~/.local/state/claude/` is **not** per-profile.
- The VS Code Claude extension ignores `CLAUDE_CONFIG_DIR` (upstream issue #30538) — isolation works for the CLI only.
- **Never run `claude auth logout` to switch** — it revokes the credential server-side.

## Windows specifics

- Directory sharing uses junctions (no admin required).
- File sharing needs Developer Mode enabled.
- `cmd.exe` has no shell wrapper — use `agent-switch run`.

## Unsigned desktop builds

The desktop installers are not yet code-signed or notarized. The first launch needs a one-time OS trust workaround.

:::caution
**macOS (Gatekeeper):** right-click the app → **Open**, or clear the quarantine attribute:

```bash
xattr -dr com.apple.quarantine <app>
```

**Windows (SmartScreen):** click **More info** → **Run anyway**.
:::

## See also

- [Tray / menubar GUI](/agent-switch/guides/tray-gui/) — launching the desktop GUI.
- [CLI reference](/agent-switch/reference/cli/) — the `doctor` self-check.
