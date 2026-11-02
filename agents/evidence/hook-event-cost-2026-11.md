# Probe: what one `agent-switch __hook-event` costs

Date 2026-11-02 · agent-switch 2.11.0 (`ff38137`) · Node v26.7.0 · macOS arm64 ·
roadmap `road-to-hooks-that-keep-up` Phase 0 step 3. Script:
`scripts/spikes/t10-hook-event-cost.mjs`.

## Method

50 runs of the built CLI (`node dist/index.js __hook-event`) with a Stop payload
on stdin, against a throwaway `AGENT_SWITCH_HOME`, each under `/usr/bin/time -p`
(CPU in 10 ms steps). Two back-to-back passes; the second is the baseline.

## Result

| Pass | wall p50 | wall p95 | CPU p50 | CPU p95 | CPU s / 100 events |
|---|---:|---:|---:|---:|---:|
| 1 | 53.8 ms | 67.3 ms | 50 ms | 60 ms | 5.00 |
| 2 (baseline) | 45.3 ms | 56.4 ms | 40 ms | 50 ms | 3.92 |

All 50 events were recorded in both passes. Nearly all of the cost is Node
starting and loading the CLI; the append itself is one small write.

## What this is for

The v3.0 roadmap gates its native `as-hook` relay on p95 < 20 ms against this
baseline (`road-to-agent-switch-v3-central.md` Phase 1, M2), and asks for the
CPU seconds per 100 hooks before and after in the release note.
