---
complexity: large
status: in-progress
tree_pin: ff38137
---

# Roadmap: agent-switch v3.1 "Client" — chat view, diffs, terminal ⇄ chat

> **Source:** `agents/tmp.old/inbox-2026-11-b/` — owner turn 2 (2026-11-02): pin and
> resume old sessions, "a real replacement for Claude Desktop", switch the view
> between plain terminal and an own GUI over it with text input and drag & drop,
> see what changed as a collapsible diff "like Codex/git". Second arrival the same
> day: the v3 UI design (`design/`), whose chat and review boards are v3.1.
>
> **Pull trigger:** [`road-to-agent-switch-v3-central.md`](road-to-agent-switch-v3-central.md)
> closed (store, host, input lease and library in place). Parked because every
> phase here builds on them.

## Branch

Targets `dev/v3` (branch model in
[`road-to-agent-switch-v3-central.md`](road-to-agent-switch-v3-central.md)).

## Design basis (binding)

The v3 UI spec [`docs/design/agent-switch-v3-ui-spec.md`](../../docs/design/agent-switch-v3-ui-spec.md)
is the spec here too, at strict fidelity (rules in
[`road-to-agent-switch-v3-central.md`](road-to-agent-switch-v3-central.md)
§ Design basis). This roadmap builds its v3.1 boards: Chat view (§10.8), Review
(§10.9), the `[Terminal | Chat]` switch (§6.2), "Review changes" in the Changes
window (§9.2), `⌘.` (§12) and behaviour rules §13.3–§13.5. Reference code:
`gui/src/v3/v31.tsx` in
[`docs/design/agent-switch-v3-reference.patch`](../../docs/design/agent-switch-v3-reference.patch).

## Owner demands answered here

D7 Claude-Desktop replacement · D8 view switch terminal ⇄ own GUI · D9 text input,
drag & drop upload · D10 diffs, collapsible · D11 "a real client".

## Constraints (binding)

- **No Claude Agent SDK** (proprietary licence, login grey zone, runtime
  dependency). Claude is driven via the unmodified binary: `claude -p
  --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --resume <id>`. A second assistant proposed
  "SDK first"; declined for these reasons.
- **Approvals stay real approvals** — never `bypassPermissions`, never `--bare`;
  on resume pass `--permission-mode` explicitly (`-p` resume does not restore it).
- **Terminal stays the default view**; the chat view is opt-in per session.
- A session running in the user's own terminal is **read-only** in the client,
  with a "take over?" banner — never steered remotely.
- The bridge never writes host index files.
- Codex uses the same AS event model — no provider-specific chat screen.

## Phase 0 — Spikes and ADRs

- [x] Spike: long-lived stream-json process with `CLAUDE_CONFIG_DIR`, OAuth login
      and image content blocks.
      → `agents/evidence/v31-phase0-spikes-2026-11.md` § C1: one process carried two turns, the profile's OAuth login
      worked from `CLAUDE_CONFIG_DIR`, a base64 PNG block was read correctly.
- [x] Spike S2 moved to v3.0 Phase 0 (the Needs-you zone needs it first); reuse its
      result for the approval card here.
      → `agents/evidence/v31-phase0-spikes-2026-11.md` § C2: S2 reused; for the bridge `--permission-prompt-tool stdio`
      gives `can_use_tool` requests on stdout, answered on stdin (deny and allow
      both verified).
- [x] Spike: does `codex app-server` list and resume threads started in the CLI?
      → `agents/evidence/v31-phase0-spikes-2026-11.md` § C3: yes, once `thread/list` names the source kinds; `thread/read`
      and `thread/resume` work. A Codex turn was not run (both logins fail to
      refresh, central blocker).
- [x] ADR: bridge process model (CLI stdio process `agent-switch bridge` spawned by
      the engine vs in-engine manager; no new Tauri capability) and the per-session
      write lock.
      → `docs/adr/ADR-009-v31-bridge-process-and-write-lock.md`: a CLI process
      per session, spawned by the GUI, holding the session's input lease.
- [x] ADR: timeline reader for Claude history (extends ADR-002), fixtures per CC
      version; "open in terminal" when in doubt.
      → `docs/adr/ADR-010-v31-timeline-reader.md`.

## Phase 1 — Read-only timeline

- [x] AS event model v1 (`turn`, `message.delta`, `tool.*` with `parentToolId`,
      `diff`, `plan`, `approval.*`, `question.requested`, `subagent.*`, `limits`,
      `error`, `unknown` passed through — never dropped).
      → `src/timeline/{events,claude,codex}.ts`; recorded fixtures
      `tests/fixtures/timeline/claude-2.1.316.jsonl` (transcript, anonymised) and
      `claude-stream-2.1.316.jsonl`; the Codex fixture is synthetic from the
      app-server schema (no Codex login can run a turn).
- [x] Claude via the bridge, Codex via `codex app-server` (`thread/read`).
      → `agent-switch bridge` / `timeline` (`src/commands/bridge.ts`,
      `src/bridge/{claude,codex}-bridge.ts`). Live run against Claude 2.1.316:
      a new session, a Write approval asked and answered, the file written, the
      turn ended. Found on the way: a bridge whose agent binary failed to start
      never exited (test red first).
- [ ] Virtualised list; 50 real sessions render.

## Phase 2 — Interactive chat view

- [ ] Chat body per spec §10.8: user bubble right-aligned on raise, assistant
      prose plain, collapsible tool cards (state dot, tool name, argument in
      mono; "Update" opens to a diff), the subagent "Task" row with the violet
      worktree badge and "subagent · via hook".
- [ ] Composer per spec §10.8: attachment chips, the queue placeholder while a
      turn runs, Attach, Mode ("Ask before edits ▾"), "Stop ⌘.", "Queue ↵";
      `@`-files and slash commands; messages typed during a turn are queued, not
      sent (§13.4).
- [ ] Drag & drop / paste: images as content blocks, repo files as `@path`, external
      files into a per-session attachment staging area (size limit, MIME sniff,
      SHA-256, TTL cleanup, symlink-race safe).
- [ ] Approval card per spec §10.8: "✓ Allow once ↵", "Always allow “<rule>”",
      "Deny", and "Same rule as the terminal prompt · never bypassed"; one decision
      with the Needs-you row and the terminal (§13.5); questions as forms.
- [ ] Stop and "interrupt now"; steering for Codex.
- [ ] Model / mode switch; context and cost header; notifications.
- [ ] Start a new session directly in the client view.

## Phase 3 — Changes and review

- [ ] Review page tab per spec §10.9: scope segmented This turn (diff events) /
      Session / Worktree vs main (merge-base) / Staged, plus Unified / Split.
      Bash-made changes visible via `git diff`. Opened from "Review changes" in the
      Changes window.
- [ ] File tree with the Marker on the current file; `agent-switch diff --json`.
- [ ] While a turn runs: the info strip, and stage / discard / revert disabled with
      "Unlocks when the turn ends" (§13.4).
- [ ] Discard / stage / unstage hunks with preflight (index lock, diff hash) and
      undo; only while no turn runs. Several sessions in one worktree → conflict flag.
- [ ] A line comment is "sent when the turn ends" as the next prompt; "Commit N
      staged…" and "Create PR"; Codex `review/start`.
- [ ] Rewind via the terminal (no own rewind rebuild).

## Phase 4 — Terminal ⇄ chat switch

- [ ] The session bar's `[Terminal | Chat]` switch (spec §6.2): only between
      turns; disabled with "Chat needs a session hosted in Agent Switch" for
      sessions in the user's own terminal; one writer per session; handover via `respawn-pane` +
      `--resume` (`src/tmux.ts` in-place mechanism); "switch after this turn"
      (arm pattern, `src/rebind-arm.ts`).
- [ ] Offered only where the adapter declares a shared conversation (Claude,
      Codex); otherwise the view is fixed at start.
- [ ] Second-writer rejection test; 20 switches without mixing.

## Phase 5 — Desktop parity

- [ ] Projects view; MCP and plugin management per account (read + open config,
      no own installer); what Claude Desktop does that this client does not, listed
      honestly on the docs site.

## Acceptance

- A full workflow (prompt, approval, edit, image, question, stop, review, commit,
  PR) without the terminal, for Claude and Codex.
- 20 terminal ⇄ chat switches without mixing; a second writer is rejected.
- Discard has undo; Bash changes appear in the worktree diff.
- The chat and review boards pass the design acceptance of spec §14 (three themes,
  1440×900, no clipping or wraps) and get their rows in the fidelity matrix.

## Decisions

| ID | Question | Status |
|---|---|---|
| C-diff | Diff rendering library | decided in Phase 3 by a bundle-size/a11y comparison, no new runtime dep for the CLI |
| C-send | Spec proposal: "Queue" becomes "Send" when no turn runs (§10.8) | **owner** — marked "proposal" in the spec, not built until confirmed |
| C-bill | Anthropic counts the client view as programmatic use; the billing split is only paused (since 2026-06-15) | risk, not a decision — terminal stays default |

## Risk Register

| Risk | Mitigation |
|---|---|
| Undocumented transcript layout | fixtures, version check, honest degrade |
| Provider policy change on programmatic use | terminal default; chat opt-in |
