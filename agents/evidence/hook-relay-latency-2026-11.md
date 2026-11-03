# Probe: what a hook costs through the `as-hook` relay

Date 2026-11-03 · roadmap `road-to-agent-switch-v3-central` Phase 1, M2 ·
decision E1 (measure the acknowledged path on macOS, Linux and Windows; the
runtime follows from it). Script: `scripts/spikes/m2-hook-relay.mjs`; CI job
`hook relay <os>` runs it on every push.

## Acknowledgement point

An event is acknowledged when it is **durably stored**: the engine's `hook` op
answers `{"stored": true}` only after the ring line is written (handed to the
OS, as the 2.x append was) and the store row is attempted
(`src/hook-intake.ts`, `src/engine/server.ts`). The relay exits on that answer
and on nothing else; any other answer, or none within 1.5 s, sends the same
stdin to `agent-switch __hook-event`. Consequence, measured below as a harness
fault: an engine that cannot answer in 1.5 s doubles an event rather than lose
it.

## Method

Per path, against a throwaway `AGENT_SWITCH_HOME`, the engine in its own
process: one warm-up, then 50 hooks one after another (wall p50 / p95, CPU via
`/usr/bin/time -p` on Unix in 10 ms steps), then 50 hooks started at once (wall
p95 per hook). Events expected vs. ring lines vs. store rows. Paths:
`node-floor` (`node -e 0`), `cli` (the 2.x `__hook-event`), `relay` (with
engine), `relay-fallback` (no engine: relay, then the CLI).

## Results

### macOS arm64 (local, Node 26.7.0, 18 cores, load average ~25)

| path | seq wall p50 ms | seq wall p95 ms | CPU p50 ms | CPU s / 100 | 50-parallel wall p95 ms | events expected | in ring | in store |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| node-floor | 28.3 | 32.9 | 10.0 | 1.04 | 106.7 | 0 | 0 | – |
| cli | 55.1 | 63.6 | 50.0 | 5.12 | 279.7 | 100 | 100 | – |
| relay | 3.9 | 4.5 | 0.0 | 0.00 | 16.4 | 100 | 100 | 100 |
| relay-fallback | 55.6 | 75.7 | 50.0 | 5.32 | 306.6 | 100 | 100 | – |

The relay's own CPU is below the 10 ms resolution of `time -p`; the engine's
share runs in the engine process and is not in this column.

### CI (GitHub-hosted runners, Node 22)

See the next section; filled from the `hook relay <os>` job summaries of the
PR's head.

## Reading

- **Node cannot meet the 20 ms budget.** Starting Node and doing nothing is
  already p95 32.9 ms here — before a byte of the payload is read. Bun's
  compiled CLI measured p95 20.4 ms (S4), also over budget. So the relay is
  native (Rust, no dependencies, ~350 KB), and the engine stays on Node: E1's
  "no runtime switch" holds for the engine, and the measurement settles the
  relay.
- **0 events lost**, sequentially and with 50 hooks at once, on every path.
- **Harness fault found on the way:** with the engine inside the measuring
  process, `spawnSync` blocked it; every relay call waited 1.5 s and fell back,
  and 51 of 151 ring lines were doubles. That is the designed failure mode
  (double, never lose), and the reason the engine must not run on the hook's
  critical path inside a blocked event loop. The script now runs the engine in
  its own process.
