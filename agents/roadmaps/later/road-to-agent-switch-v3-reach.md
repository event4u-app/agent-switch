---
complexity: large
status: planned
tree_pin: ff38137
---

# Roadmap: agent-switch v3.2 "Reach" — more agents, local models, access from anywhere

> **Source:** `agents/tmp.old/inbox-2026-11-b/` — owner turn 3 (2026-11-02): connect
> other agents and models incl. local ones; "the app can be reached from anywhere";
> deep code analysis of two terminal-multiplexer-class agent clients.
>
> **Pull trigger:** [`road-to-agent-switch-v3-client.md`](road-to-agent-switch-v3-client.md)
> closed, and owner decisions E4/E5 below answered.

## Branch

Targets `dev/v3` (branch model in
[`road-to-agent-switch-v3-central.md`](../road-to-agent-switch-v3-central.md)).

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
      ACP (limits only if reported), terminal-only.
- [ ] M16 "local" marker for agents configured with a local model; optional local
      model for titles/summaries, otherwise none.

## Phase 2 — Remote stage 1 (host-native)

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
- Agent View as second host, Agent Teams, OTel export; GitLab/Azure DevOps PRs;
  encrypted versioned vault backups.
- Team features without credential pooling — trigger: own request.

## Acceptance

- One ACP agent and one local-model agent run a turn in the client view.
- Remote stage 1 and 2 work without AS opening a port outside the tailnet; a
  remote client cannot change a permission mode (test).

## Decisions

| ID | Question | Status |
|---|---|---|
| E4 | Pursue remote stage 3 (relay) at all? | **owner** — recommendation: stages 1 and 2 first; relay only with E2E + self-hosting |
| E5 | Change `NON-GOALS.md` "no server" → "no server outside your own network, no relay without E2E" | **owner** — recommendation yes, with this roadmap |
| E6 | Antigravity via Google's ACP server instead of terminal only | decided: yes after S6 is green |

## Risk Register

| Risk | Mitigation |
|---|---|
| ACP adapters differ in maturity | per-agent capability flags; terminal fallback |
| Remote surface | stages, rules above, test that remote cannot escalate |
