# v3.2 fidelity rows — Agents and Remote boards (2026-11)

drafted-at: 2026-11-03

The design acceptance of spec §14 for the two boards road-to-agent-switch-v3-reach
adds, each row with the evidence taken. The source boards are the reference
patch's `settings3.tsx` (`AgentsSettings`, `RemoteSettings`) per ADR-008.

| Board | Chapter | Evidence |
|---|---|---|
| Agents | Layout 1440×900, three themes, nothing clipped or wrapped | `V3_CASES=seeded V3_CLICKS="Settings ⌘,\|Agents" npm --prefix gui run v3-render`: darcula, github-light, github-dark-hc clean, on real `agents --json` output |
| Agents | Five-column grid (Agent, Binary, Class, Model, switch), class chip with its detail as title, "local · <runner> · <model>" with the Cpu mark, "provider default" otherwise, "Add agent" with the suggestions line | `gui/src/v3/settings.tsx` `AgentsSettings`, ported from the reference; `reach.test.tsx` "Agents (v3.2)" |
| Agents | Additions not on the board: the binary's version or "not found" as a tooltip; the "Add agent" menu (the board draws only the button) | `AgentsSettings`; no visible element added to a row |
| Remote | Layout 1440×900, three themes | `V3_CLICKS="Settings ⌘,\|Remote"`: three themes clean |
| Remote | Three stage cards (icon tile, title, detail, switch; R3 dimmed "not available yet"), R1 account chips with the Codex note, Paired devices card and the scopes note | `RemoteSettings`, ported from the reference; `reach.test.tsx` "Remote (v3.2)" |
| Remote | Deviations, from the council review of 2026-11-03 | R1/R2 start **off** (E-remote-default) instead of the board's "on"; R2 detail and its three notes name SSH as the sign-in instead of device tokens and the fragment pairing code; "Paired devices" shows "No paired devices" without the Revoke / Revoke all buttons, because no device pairing exists until the phone client (Later) |
| Both | Radii and controls from §3.1 and the kit: 10 px cards, `ui/Switch`, `Chip`, `ui/Button` | `settings.tsx` |
| Both | Reachable in ≤ 2 clicks | `reach.test.tsx` — Settings › Agents, Settings › Remote |
| Both | Nav order per §10.5 (… Open in, Agents, Remote, Updates …) | `settings.test.tsx` |

Not covered here: a live ACP or local-model turn rendered in the chat view — no
ACP agent on this machine has a working login and no local runner is installed
(`agents/evidence/v32-phase0-spikes-2026-11.md`).
