<!-- evidence-type: spike -->

# v3.1 Phase 0 spikes — 2026-11-03

Roadmap: `agents/roadmaps/road-to-agent-switch-v3-client.md` Phase 0.
Binaries: Claude Code 2.1.316, codex-cli 0.166.0, macOS. Account: one of the
owner's Claude profiles via `CLAUDE_CONFIG_DIR`, model `haiku` to keep the spend
small. Scripts were throwaway and are summarised here, not committed.

## C1 — long-lived stream-json process, OAuth, image blocks

`claude -p --input-format stream-json --output-format stream-json --verbose
--include-partial-messages --model haiku --permission-mode default`, one process,
two user messages written to stdin one after the other.

| Check | Result |
|---|---|
| Login | the profile's OAuth login from `CLAUDE_CONFIG_DIR`; no API key, no extra flag |
| Process between turns | alive after turn 1 (1.8 s) and after turn 2 (2.8 s); exits 0 when stdin closes |
| Image | turn 2 was `[text, {type: "image", source: {type: "base64", media_type: "image/png", …}}]` with an 8×8 red PNG; the answer was "Red" |
| Event kinds seen | `system:init`, `system:status`, `system:thinking_tokens`, `stream_event:{message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop}`, `assistant`, `rate_limit_event`, `result:success` |

So one bridge process per session can carry many turns; images need no file on
disk. `system:init` arrives per turn, not once.

## C2 — approvals (S2 reused, plus the stdio control protocol)

S2 (v3.0, `agents/evidence/v3-phase0-spikes-2026-11.md` § S2) showed the
`PermissionRequest` hook is a real approval channel next to the terminal prompt.
For the bridge there is a shorter path on the unmodified binary:

`--permission-prompt-tool stdio` makes Claude write a `control_request` with
`subtype: "can_use_tool"`, the tool name and its input to stdout, and wait for a
`control_response` on stdin.

| Answer | Bash `echo spike > spike.txt` |
|---|---|
| `{behavior: "deny", message}` | not run, no file; turn ends normally |
| `{behavior: "allow", updatedInput}` | run, file written |

So the approval card answers the bridge directly; the Needs-you row and the
terminal stay one decision because the bridge is the session's only writer
(ADR-009). This is the binary's own protocol — no Agent SDK.

## C3 — `codex app-server` and threads started in the CLI

`codex app-server` (JSON-RPC over stdio, `initialize` then `initialized`).

| Call | Result |
|---|---|
| `thread/list {limit}` | 0 threads — the default filter is "interactive sources" only |
| `thread/list {sourceKinds: [cli, vscode, exec, appServer, unknown]}` | both threads on disk, started with `codex exec` (`source: "exec"`) |
| `thread/read {threadId, includeTurns: true}` | the turns, item kind `userMessage` |
| `thread/resume {threadId, excludeTurns: true}` | ok: model, cwd, approval policy, sandbox |

So yes: the app server lists, reads and resumes threads the CLI started, as
long as the list call names the source kinds. The protocol schema
(`codex app-server generate-json-schema`) also has `turn/start`, `turn/steer`,
`turn/interrupt`, `review/start` and the approval requests
(`CommandExecutionRequestApproval`, `FileChangeRequestApproval`) the client needs.
Not checked: a turn on Codex — both Codex logins fail to refresh their token
(`road-to-agent-switch-v3-central` open blocker); reading needs no network.
