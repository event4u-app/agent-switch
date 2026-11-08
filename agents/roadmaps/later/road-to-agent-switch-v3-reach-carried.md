---
complexity: standard
status: parked
relates:
  - slug: road-to-agent-switch-v3-reach
    relation: split-from
    note: "Carried on 2026-11-03 when v3-reach closed: the phone client (council review), the laptop app on a remote engine, and the live acceptance turns."
review_by: 2027-01-07
entry_condition:
  what: "Phase 1.a/b: `command -v ollama || command -v lms || command -v opencode` succeeds, or ~/.gemini/settings.json selectedType is gemini-api-key or vertex-ai. Phase 1.c: the owner runs one hosted session with R1 on and follows it from claude.ai/code (runnable today). Phase 2: `command -v tailscale` succeeds on a test machine. Phase 3: the owner records a shortfall of `remote rpc` over SSH."
  when: "Checked at every /roadmap:triage-parked; Phase 1.c at the next owner session on the Mac."
  who: "owner"
---

# Road to agent-switch v3.2 "Reach" — the carried items

> Last triaged: 2026-11-07 — Phase 1.a/b and Phase 2 triggers unmet (no local runner, Gemini on oauth-personal, no tailscale); Phase 3 unverifiable. Phase 1.c needs only Claude (`--remote-control`, `src/remote.ts`) and can be run by the owner now. All 9 steps still needed; no other roadmap covers them.

> **Source:** [`road-to-agent-switch-v3-reach.md`](../archive/road-to-agent-switch-v3-reach.md),
> closed 2026-11-03. Council review of the remote stages:
> `agents/evidence/reviews/council-feat-v3-reach-agents.findings.md`.
>
> _Resume when:_ any trigger below fires. Each phase stands alone.

## Phase 1 — Live acceptance turns

_Trigger:_ a Gemini API-key or Vertex login on this machine, or OpenCode or Codex
with Ollama or LM Studio installed.

- [ ] One ACP agent runs a turn in the chat view (`bridge --new --agent <id>`),
      with one approval answered in the card.
- [ ] One agent with a local model runs a turn, and its row reads
      "local · <runner> · <model>".
- [ ] One hosted Claude session started with `--remote-control` is followed from
      claude.ai/code; turning R1 off for the account leaves new sessions without
      it.

## Phase 2 — Phone web client inside the tailnet

_Trigger:_ Tailscale installed on a test machine, so HTTPS serving, revocation
races and restart behaviour can be tested end to end. Design constraints from the
council review, all binding:

- [ ] HTTPS through Tailscale; the device secret only as a Secure, HttpOnly,
      SameSite=Strict cookie, never in a response body, URL, localStorage or log.
- [ ] Pairing started locally only; the code in the URL fragment, single-use,
      attempts limited per code (no global lockout an attacker can trigger).
- [ ] Devices scoped per account; `view` of a timeline separate from answering
      approvals, because tool output can hold secrets.
- [ ] Approvals through the bridge inbox's one decision (`src/bridge/inbox.ts`),
      with a dedicated approval payload the phone shows in full or refuses.
- [ ] Revocation ordering and restart tests green before the client may answer
      approvals; until then it only views.

## Phase 3 — Desktop app on a remote engine

_Trigger:_ the CLI over SSH (`agent-switch remote rpc`) shown insufficient in
daily use.

- [ ] The desktop app on a laptop reads the Needs-you list and answers approvals
      of an engine on a server over SSH, with the same three methods.
