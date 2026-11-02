# v3.0 Phase 0 — spike results

Date 2026-11-02 · Claude Code 2.1.316 · macOS arm64 (tmux 3.7b), one Linux run
in an Alpine 3.21 container (tmux 3.5a) · roadmap
`road-to-agent-switch-v3-central` Phase 0. Every live Claude run used one
logged-in profile (MatneX) and injected its hooks with `--settings`, unless a
section says otherwise.

## S3 — `--settings` adds, it does not replace

Script `scripts/spikes/t12-settings-flag-merge.sh`. A scratch project with a
Stop hook in `.claude/settings.json` (project) and one in
`.claude/settings.local.json` (local), and a third arriving via `--settings`.

| Run | Stop hooks that fired |
|---|---|
| all sources | flag, local, project |
| `--setting-sources project` | flag, project |

`--settings` is an extra source next to the others; it survives a user who
narrows `--setting-sources`. The user scope (`<config>/settings.json`) was not
written for this test; it is a source of the same kind as project and local,
read the same way, but that row is inferred, not observed.

## S4 — event-store runtime (feeds E1)

Script `scripts/spikes/t13-sqlite-runtime.mjs`: one WAL database, 8 writer
processes × 500 single-row transactions, one reader process polling throughout.

| Runtime | stored / expected | time | rows/s | reader max |
|---|---:|---:|---:|---:|
| Node v26.7.0 `node:sqlite` | 4000 / 4000 | 312 ms | 12,840 | 0.87 ms |
| Node v24.19.0 `node:sqlite` | 4000 / 4000 | 306 ms | 13,076 | 12.71 ms |
| Bun 1.3.10 `bun:sqlite` | 4000 / 4000 | 344 ms | 11,645 | 0.82 ms |

- Both are correct under concurrent writers and fast enough by two orders of
  magnitude for hook ingest. Neither printed an experimental warning (Node 24, 26).
- **Packaging, Node:** `package.json` declares `engines.node >= 20` and CI tests
  Node 20 and 22. `node:sqlite` does not exist in Node 20 and needs at least
  22.13 without a flag (Node release notes; Node 20 and 22 were not run here —
  fetching other Node versions was not permitted in this session). Choosing Node
  means raising the engine floor.
- **Packaging, Bun:** `bun build --compile src/index.ts` builds today's CLI
  unchanged into one 61 MB binary that starts in ~22 ms. `__hook-event` through
  that binary: p50 17.5 ms, p95 20.4 ms over 50 events (Node baseline: p95 56 ms,
  `hook-event-cost-2026-11.md`). The binary prints version `0.0.0`: the version
  lookup reads `package.json` from disk and needs a build-time constant.

E1 stays with the owner: both work; Node costs an engine-floor raise, Bun costs a
second toolchain and a 61 MB download, and is already near the `as-hook` 20 ms
gate on its own.

## T-S1 — subagent payloads

Captured in `road-to-hooks-that-keep-up` (`scripts/spikes/t11-subagent-hook-capture.sh`,
`tests/fixtures/claude-subagent-hooks-2.1.316.jsonl`): `SubagentStop` carries
`agent_transcript_path`; both carry `agent_id`, `agent_type`, `cwd`, and the
parent's `session_id`.

## T-S2 and T-S3 — worktree subagents, child sessions

Script `scripts/spikes/t14-subagent-worktree-and-child.sh`, run twice with the
same result. A scratch git repo whose project hooks log event, session, cwd and
the env var `AGENT_SWITCH_PARENT_SESSION`; the parent ran with that env var and
one extra Stop hook via `--settings`; it started one worktree subagent and one
child `claude -p` through Bash.

- **T-S2:** a subagent with `isolation: worktree` reports
  `cwd = <repo>/.claude/worktrees/agent-<agent_id>` in both SubagentStart and
  SubagentStop. Branch and worktree of a subagent can be read from that cwd.
- **T-S3 (hooks):** the child session fired the project hook but **not** the
  hook the parent got through `--settings`. Flag settings are argv and are not
  inherited.
- **T-S3 (env):** the child saw `AGENT_SWITCH_PARENT_SESSION=parent-marker`.
  Env vars are inherited, so the lineage contract (Phase 2) works for council
  seats.

Consequence for M3: a child of a hosted session reports to AS only when the
user's own settings carry AS hooks (or AS exports the lineage env vars and the
child's events arrive another way). The parent's hooks alone do not cover it.

## T-S4 — `claude agents --json`

Per `CLAUDE_CONFIG_DIR`, `claude agents --json --all` lists that account's live
sessions: `pid`, `cwd`, `kind` (`interactive`), `startedAt`, `sessionId`,
`name`, `status` (`busy` / `idle`). Three profiles answered, each with its own
running session. It is a second live-state source next to the pid files.

## S5 — tmux as host

Script `scripts/spikes/t15-tmux-host.sh`, all seven checks green on macOS (tmux
3.7b) and Linux (tmux 3.5a): own server `-L as-<uid>…` with `-f /dev/null`; one
window per session started by argv; two linked view sessions on different
windows at the same time; `send-keys -l` reaches exactly one window and
`capture-pane` reads it back; closing a viewer keeps every hosted session;
`refresh-client` is accepted (it reports "can't find client" without an
attached terminal, as expected headless); the user's default server is
unchanged.

## S2 — `PermissionRequest` hook as the approval channel (feeds D-approve)

Script `scripts/spikes/t16-permission-request-hook.sh` (`-p`) plus an
interactive run in a private tmux server.

| Case (`claude -p`, default permission mode) | hook fired | command ran | turn |
|---|---|---|---:|
| no hook | — | no (no one to ask) | 10 s |
| hook answers allow after 1 s | yes | **yes** | 10 s |
| hook answers deny | yes | no | 7 s |
| hook `timeout: 2`, sleeps 6 s | yes | no | 7 s |

Interactive (hook answers allow after 3 s, sampled every second): the
terminal's own "Do you want to proceed?" prompt appeared at 3 s **while the hook
was still running**; at 6 s the hook's answer removed the prompt and the command
ran. With the 2 s timeout the terminal prompt stayed and waited for a key.

So the hook is a real approval channel, runs **next to** the terminal prompt
(never instead of it), and a slow or absent answer leaves the normal prompt in
place; it does not hold the turn longer than the prompt itself would. It works
for any session whose settings carry the hook — hosted or in the user's own
terminal. `--permission-prompt-tool` needs an MCP server and only exists under
`-p`; it was not pursued.

Side effect: running interactive Claude in a scratch folder under
`~/.agent-switch/` added two project entries for the (deleted) scratch paths to
the profile's `.claude.json`. Harmless, left in place.

## S8 — next-turn model and thinking

Interactive session in a private tmux server, started with
`--model opus --effort high`, then `/model sonnet` and `/effort low` typed in.

- `/model` mid-conversation asks first ("This conversation is cached for the
  current model … the full history gets re-read"), then switches.
- **Both commands persist** beyond the session: `/model sonnet` wrote
  `"model": "sonnet"` and `/effort low` wrote
  `modelSettings.claude-sonnet-5-5.effortLevel = "low"` into the profile's
  `settings.json` ("saved as your default for new sessions"). The probe removed
  both keys again afterwards (a copy of the file as the probe left it was kept
  outside the repo).
- The transcript names the model per answer (`message.model`) and the effort per
  answer (`effort`, `perTurnEffort`), so the chips can read both, with the
  transcript as provenance.
- `ctx %` already has a source with provenance: the transcript reader
  (`src/telemetry.ts`, `contextForRow` in `src/commands/shared.ts`).

Consequence: AS must not type `/model` or `/effort` into a session — that would
change the user's defaults for every new session on that account. The way to set
model and thinking for the next turn without that is the existing in-place
respawn between turns (`claude --resume <id> --model … --effort …`, the
mechanism behind `takeover --in-place` in `src/tmux.ts`), which costs the same
cache re-read the `/model` dialog warns about.

## S9 — Desktop apps (spec §15.3)

Claude Desktop 4.29.0 declares one URL scheme (`claude://`) and document types
for desktop extensions (`.dxt`, `.mcpb`) and skill files only — no folder type.
`open -a Claude <worktree>` therefore cannot hand it a project, and nothing in
its launcher resumes a CLI session (its own Code-tab sessions are indexed by
Desktop metadata files, `src/desktop-sessions.ts`). Under "no URL schemes" the
honest entry is "opens the app", not "opens this project". Codex Desktop is not
installed on this machine; not verified.
