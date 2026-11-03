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

### CI (GitHub-hosted runners, Node 22.23.4, PR #140 head `b6a3faa`, run 41589890962)

macOS arm64, 5 cores:

| path | seq wall p50 ms | seq wall p95 ms | CPU p50 ms | CPU s / 100 | 50-parallel wall p95 ms | events expected | in ring | in store |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| node-floor | 29.9 | 33.9 | 20.0 | 1.90 | 241.1 | 0 | 0 | – |
| cli | 72.4 | 92.6 | 70.0 | 6.62 | 725.0 | 100 | 100 | – |
| relay | 4.8 | 5.7 | 0.0 | 0.00 | 24.8 | 100 | 100 | 100 |
| relay-fallback | 69.6 | 82.6 | 70.0 | 6.46 | 903.3 | 100 | 100 | – |

(macOS numbers from run 41589220672; the fix in between touched only the Windows path.)

Linux x64, 4 cores:

| path | seq wall p50 ms | seq wall p95 ms | CPU p50 ms | CPU s / 100 | 50-parallel wall p95 ms | events expected | in ring | in store |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| node-floor | 26.9 | 35.6 | 10.0 | 1.44 | 395.9 | 0 | 0 | – |
| cli | 96.7 | 98.9 | 100.0 | 9.66 | 1813.7 | 100 | 100 | – |
| relay | 3.3 | 3.9 | 0.0 | 0.00 | 62.2 | 100 | 100 | 100 |
| relay-fallback | 96.2 | 99.3 | 100.0 | 9.52 | 2046.7 | 100 | 100 | – |

Windows x64, 4 cores (no `time`, so no CPU column):

| path | seq wall p50 ms | seq wall p95 ms | CPU p50 ms | CPU s / 100 | 50-parallel wall p95 ms | events expected | in ring | in store |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| node-floor | 45.7 | 48.0 | – | – | 740.5 | 0 | 0 | – |
| cli | 158.0 | 172.7 | – | – | 3151.5 | 100 | 100 | – |
| relay | 8.7 | 10.5 | – | – | 222.1 | 100 | 100 | 100 |
| relay-fallback | 164.0 | 171.5 | – | – | 3392.1 | 100 | 100 | – |

The first Windows run doubled events: with 20 hooks at once every pipe instance
was taken (`ERROR_PIPE_BUSY`) and 9 relays fell back. The relay now retries a
busy pipe until its answer timeout; the run above has 0 doubles.

## Reading

- **Node cannot meet the 20 ms budget.** Starting Node and doing nothing is
  already p95 32.9 ms here — before a byte of the payload is read. Bun's
  compiled CLI measured p95 20.4 ms (S4), also over budget. So the relay is
  native (Rust, no dependencies, ~350 KB), and the engine stays on Node: E1's
  "no runtime switch" holds for the engine, and the measurement settles the
  relay.
- **The 20 ms gate holds per hook on all three platforms**: relay p95 3.9 ms
  (Linux), 5.7 ms (macOS), 10.5 ms (Windows), against 98.9 / 92.6 / 172.7 ms
  for the 2.x CLI.
- **50 hooks started at the same instant do not fit 20 ms on a 4–5 core
  runner** (p95 24.8 ms macOS, 62.2 ms Linux, 222 ms Windows) — the queue is the
  engine's single event loop and the runner's cores, and the CLI path is 14–29×
  slower under the same load. The gate is read as per-hook latency; the burst is
  reported here, not hidden. Revisit-if: a real session shows hook bursts of
  that size, or the engine's `hook` op takes more than a few ms per event.
- **0 events lost, 0 doubled**, sequentially and with 50 hooks at once, on every
  path and platform.
- **Harness fault found on the way:** with the engine inside the measuring
  process, `spawnSync` blocked it; every relay call waited 1.5 s and fell back,
  and 51 of 151 ring lines were doubles. That is the designed failure mode
  (double, never lose), and the reason the engine must not run on the hook's
  critical path inside a blocked event loop. The script now runs the engine in
  its own process.
