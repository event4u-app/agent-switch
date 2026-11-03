---
complexity: large
status: planned
tree_pin: ff38137
---

# Roadmap: agent-switch v3.2 "Reach" — more agents, local models, access from anywhere

> **Source:** `agents/tmp.old/inbox-2026-11-b/` — owner turn 3 (2026-11-02): connect
> other agents and models incl. local ones; "the app can be reached from anywhere";
> deep code analysis of two terminal-multiplexer-class agent clients. Second
> arrival the same day: the v3 UI design (`design/`), whose Agents and Remote
> boards are v3.2.
>
> **Pull trigger:** [`road-to-agent-switch-v3-client.md`](archive/road-to-agent-switch-v3-client.md)
> closed, and owner decisions E4/E5 below answered.
> **Activated 2026-11-03** by the owner ("v3-reach aus later zurückholen"):
> v3-client is closed; E4, E5 and E-remote-default stay open and gate only
> Phases 2–3 — Phase 0 and Phase 1 do not depend on them.

## Branch

Targets `dev/v3` (branch model in
[`road-to-agent-switch-v3-central.md`](archive/road-to-agent-switch-v3-central.md)).

## Design basis (binding)

The v3 UI spec [`docs/design/agent-switch-v3-ui-spec.md`](../../docs/design/agent-switch-v3-ui-spec.md)
is the spec here too, at strict fidelity (rules in
[`road-to-agent-switch-v3-central.md`](archive/road-to-agent-switch-v3-central.md)
§ Design basis). This roadmap builds its v3.2 boards: Settings › Agents and
Settings › Remote (§10.5), Antigravity as a tool in New session (§8.1), and
behaviour rule §13.5 for remote approvals. Reference code:
`gui/src/v3/settings3.tsx` in
[`docs/design/agent-switch-v3-reference.patch`](../../docs/design/agent-switch-v3-reference.patch).

## Owner demands answered here

D12 learn from the two analysed clients · D13 other agents and local models ·
D14 access from anywhere.

## Constraints (binding)

- **Local models via agents that support them** (e.g. OpenCode + Ollama/LM Studio).
  AS runs no own MLX/llama server, no model hub, no own agent loop.
- AS installs nothing silently; install commands run visibly in the terminal.
- **Rules for every networked stage:** auth always on; device tokens hashed, with
  expiry and "revoke all"; pairing code only in the URL fragment, attempts limited;
  Host and Origin checked, missing Origin rejected; token never in URL,
  localStorage, logs or terminal; **no remote privilege escalation** (remote may
  answer approvals, never loosen permission modes); argv only, session ids
  validated; remote scopes split `view/respond/approve` vs
  `terminal.write/file.upload/git.write`; maximum device count.
- Stage 3 (relay) only with end-to-end encryption and self-hostable relay.

## Phase 0 — Spikes

- [ ] S6: Antigravity ACP server — origin, licence, behaviour with AS profiles.
- [ ] S7: local models via OpenCode and via `codex --oss` + Ollama.
- [ ] Gemini ACP `session/load` and history.
- [ ] GUI PATH bootstrap for version managers (nvm, volta, mise, asdf, nix) plus
      CLI version probe.

## Phase 1 — ACP agents and local models

- [ ] M15 agent registry (name, binary, args, ACP yes/no) in settings; the ACP
      agent list as suggestions; ACP driver for Gemini, Antigravity (after S6),
      OpenCode, Goose, Qwen Code — all through the AS event model.
- [ ] Three classes shown honestly: deep (Claude, Codex: accounts + limits),
      ACP (limits only if reported), terminal-only — Settings › Agents lists one row
      per agent with its class ("deep" / "ACP" / "terminal only") and a switch
      (spec §10.5).
- [ ] M16 "local" marker for agents configured with a local model; optional local
      model for titles/summaries, otherwise none.

## Phase 2 — Remote stage 1 (host-native)

- [ ] Settings › Remote (spec §10.5): the stages R1 Claude Remote Control, R2 own
      tunnel (SSH/Tailscale), R3 E2E relay ("later"); paired devices with their
      scopes; no stage opens a port outside the user's network. An approval
      answered remotely is the same decision as the terminal prompt (§13.5).
- [ ] M17 per-session / per-account switch "Remote Control on" → start with
      `--remote-control "<name>"`; no inbound port. Codex: pointer to the ChatGPT
      app's remote connections.

## Phase 3 — Remote stage 2 (own tunnel)

- [ ] M18 engine socket over SSH stream forwarding or Tailscale; guide "engine on
      the server, app on the laptop". Optional phone web client **only inside the
      tailnet**, token-gated, all rules above.
- [ ] `NON-GOALS.md` updated per E5 in the same change.

## Later (trigger named)

- Own session host (fd hand-over, Windows via ConPTY) — trigger: Windows demand or
  tmux problems in daily use.
- Remote stage 3, E2E relay — trigger: E4 = yes and stages 1/2 shown insufficient.
- Full-text search over contents — trigger: timeline reader stable over two CC
  versions.
- GitLab merge requests through `glab`, the GitHub PR facts' twin (match by head
  SHA, the same four axes, one batched call per repo) — carried from v3-central
  Phase 3 on 2026-11-03 — trigger: a session works in a GitLab repository and
  `glab` is installed, so the API shape can be checked against real answers.
- Agent View as second host, Agent Teams, OTel export; Azure DevOps PRs;
  encrypted versioned vault backups.
- Team features without credential pooling — trigger: own request.

## Acceptance

- One ACP agent and one local-model agent run a turn in the client view.
- Remote stage 1 and 2 work without AS opening a port outside the tailnet; a
  remote client cannot change a permission mode (test).
- The Agents and Remote boards pass the design acceptance of spec §14 and get
  their rows in the fidelity matrix.

## Decisions

| ID | Question | Status |
|---|---|---|
| E4 | Pursue remote stage 3 (relay) at all? | **owner** — recommendation: stages 1 and 2 first; relay only with E2E + self-hosting |
| E5 | Change `NON-GOALS.md` "no server" → "no server outside your own network, no relay without E2E" | **owner** — recommendation yes, with this roadmap |
| E-remote-default | The Remote board shows R1 and R2 "on"; the constraints keep every networked stage opt-in | **owner** — recommendation: off until the user turns a stage on; the board shows a configured state |
| E6 | Antigravity via Google's ACP server instead of terminal only | decided: yes after S6 is green |

## Risk Register

| Risk | Mitigation |
|---|---|
| ACP adapters differ in maturity | per-agent capability flags; terminal fallback |
| Remote surface | stages, rules above, test that remote cannot escalate |
