# Two host signals, probed (2026-11-23)

Spikes for `agents/roadmaps/later/road-to-host-signals-followups.md` § Codex (OSC 7501)
and `agents/roadmaps/road-to-agent-switch-statusline-usage.md` Phase 6 Step 1 (control
query). macOS, tmux, one signed-in profile each.

## Codex reports its own state over OSC 7501

**Setup.** Codex CLI **0.167.0**, interactive, in a tmux window like an AS-hosted one, with
`tmux pipe-pane -O -t <pane> 'cat >> raw.bin'`. One prompt ("run `ls -la` and count the
entries"), one tool call, turn end. Nothing was written back to the pane; no probe answered.

**Result.** The raw stream (29 KB) carried five OSC 7501 reports, unasked:

```
ESC ] 7501 ; state=idle:app=codex       (at start)
ESC ] 7501 ; state=working:app=codex    (prompt sent)
ESC ] 7501 ; state=idle:app=codex
ESC ] 7501 ; state=working:app=codex    (tool call)
ESC ] 7501 ; state=done:app=codex       (turn end)
```

Also present: OSC 0 (window title, 69 times — Codex puts the task title there), OSC 8
(hyperlinks), OSC 10/11 (colour queries Codex sends; tmux answers them, AS does not).

**Findings.**
1. `tmux pipe-pane -O` delivers the raw reports from a hosted window. The spike's first
   question is answered yes.
2. Codex 0.167.0 sends them without being probed, so AS never needs to type into the pane —
   the input lease (`src/host/lease.ts`) stays untouched.
3. The vocabulary seen: `state` ∈ {`idle`, `working`, `done`}, `app=codex`, fields joined by
   `:`, terminated by BEL or ST. `done` = the turn ended.
4. Cost: one `cat`-sized reader process per hosted Codex window; the stream is the window's
   own output, already produced. Measured per-report latency was not needed for a state dot.

## Claude Code answers a usage control query

**Setup.** Claude Code **2.1.316**, `claude -p --input-format stream-json --output-format
stream-json --verbose` with `CLAUDE_CONFIG_DIR` set to a signed-in profile; on stdin only
`{"type":"control_request","request_id":"u","request":{"subtype":"get_usage"}}` — no prompt.

**Result.** `control_response` `success` with `subscription_type`, `rate_limits_available`,
and `rate_limits` holding `five_hour` / `seven_day` (`utilization`, ISO `resets_at`), the
per-model weekly windows (null here), `limits[]` (`session`, `weekly_all`, `weekly_scoped`
with a model scope), `model_scoped`, `extra_usage`; plus `session` and `behaviors`. It works
without a prior `initialize`. Wall-clock **6.6 s** per query (process start plus the fetch).
Fixture: `tests/fixtures/claude-get-usage-2.1.316.json` (no account fields).

**Caveat.** The SDK inside the same binary exposes this request as
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(…)` (with an optional
`skip_behaviors`). It is a usage path that never hands the token to Agent Switch, but it is
declared unstable; any caller must treat an error or a changed shape as "source absent" and
fall back.
