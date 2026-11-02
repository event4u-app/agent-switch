---
complexity: large
status: planned
tree_pin: ff38137
---

# Roadmap: agent-switch v3.1 "Client" — chat view, diffs, terminal ⇄ chat

> **Source:** `agents/tmp.old/inbox-2026-11-b/` — owner turn 2 (2026-11-02): pin and
> resume old sessions, "a real replacement for Claude Desktop", switch the view
> between plain terminal and an own GUI over it with text input and drag & drop,
> see what changed as a collapsible diff "like Codex/git".
>
> **Pull trigger:** [`road-to-agent-switch-v3-central.md`](../road-to-agent-switch-v3-central.md)
> closed (store, host, input lease and library in place). Parked because every
> phase here builds on them.

## Branch

Targets `dev/v3` (branch model in
[`road-to-agent-switch-v3-central.md`](../road-to-agent-switch-v3-central.md)).

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

- [ ] Spike: long-lived stream-json process with `CLAUDE_CONFIG_DIR`, OAuth login
      and image content blocks.
- [ ] Spike S2: `PermissionRequest` hook as approval channel vs
      `--permission-prompt-tool` (latency, abort, always-allow).
- [ ] Spike: does `codex app-server` list and resume threads started in the CLI?
- [ ] ADR: bridge process model (CLI stdio process `agent-switch bridge` spawned by
      the engine vs in-engine manager; no new Tauri capability) and the per-session
      write lock.
- [ ] ADR: timeline reader for Claude history (extends ADR-002), fixtures per CC
      version; "open in terminal" when in doubt.

## Phase 1 — Read-only timeline

- [ ] AS event model v1 (`turn`, `message.delta`, `tool.*` with `parentToolId`,
      `diff`, `plan`, `approval.*`, `question.requested`, `subagent.*`, `limits`,
      `error`, `unknown` passed through — never dropped).
- [ ] Claude via the bridge, Codex via `codex app-server` (`thread/read`).
- [ ] Virtualised list; 50 real sessions render.

## Phase 2 — Interactive chat view

- [ ] Input with `@`-files and slash commands; message queueing while a turn runs.
- [ ] Drag & drop / paste: images as content blocks, repo files as `@path`, external
      files into a per-session attachment staging area (size limit, MIME sniff,
      SHA-256, TTL cleanup, symlink-race safe).
- [ ] Approval buttons; "needs you" links to the card; questions as forms.
- [ ] Stop and "interrupt now"; steering for Codex.
- [ ] Model / mode switch; context and cost header; notifications.
- [ ] Start a new session directly in the client view.

## Phase 3 — Changes and review

- [ ] Four scopes: this turn (diff events), session, worktree vs merge-base,
      staged. Bash-made changes visible via `git diff`.
- [ ] Collapsible file tree, unified and side-by-side; `agent-switch diff --json`.
- [ ] Discard / stage / unstage hunks with preflight (index lock, diff hash) and
      undo; only while no turn runs. Several sessions in one worktree → conflict flag.
- [ ] A diff comment becomes the next prompt; commit and PR; Codex `review/start`.
- [ ] Rewind via the terminal (no own rewind rebuild).

## Phase 4 — Terminal ⇄ chat switch

- [ ] Only between turns; one writer per session; handover via `respawn-pane` +
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

## Decisions

| ID | Question | Status |
|---|---|---|
| C-diff | Diff rendering library | decided in Phase 3 by a bundle-size/a11y comparison, no new runtime dep for the CLI |
| C-bill | Anthropic counts the client view as programmatic use; the billing split is only paused (since 2026-06-15) | risk, not a decision — terminal stays default |

## Risk Register

| Risk | Mitigation |
|---|---|
| Undocumented transcript layout | fixtures, version check, honest degrade |
| Provider policy change on programmatic use | terminal default; chat opt-in |
