# Agent View under agent-switch profiles — spike record (2026-11-01)

Step 0.1 of `agents/roadmaps/later/road-to-the-rows-where-others-lead.md` (F2).
Question: does a Claude Code background session (`claude --bg`, Agent View)
started under a profile bill that profile, or does it reach another account's
supervisor, as caam reports for its `HOME`-based profiles?

## Setup

- macOS, Claude Code **2.1.316**, agent-switch at `aa0fb8d`.
- Profile A = `MatzeB` (matze.b@…), profile B = `MathiasB` (mathias.b@…), both
  signed in to the same Team org. No supervisor was running before the test.
- Each session started as the wrapper does it: `CLAUDE_CONFIG_DIR=<profile
  config dir> claude --bg "<prompt>"`, cwd `~/.agent-switch` (trusted in both
  profiles). Prompt: run `echo CFG=$CLAUDE_CONFIG_DIR` once, change nothing.
  (`agent-switch run <p> -- --bg …` could not be used: it passed the `--`
  separator through, so Claude read `--bg` as prompt text — fixed in the same
  change, see below.)

## Observed

| | A (`MatzeB`) | B (`MathiasB`) |
|---|---|---|
| Supervisor (`claude.exe daemon run --origin transient`) | own process, `CLAUDE_CONFIG_DIR=…/MatzeB/config` | own process, `CLAUDE_CONFIG_DIR=…/MathiasB/config` |
| Daemon state dir under `/tmp/cc-daemon-501/` | `c93136f4` | `e72e5779` (separate; B printed "Starting background service…") |
| Background session process env | `CLAUDE_CONFIG_DIR=…/MatzeB/config` | `CLAUDE_CONFIG_DIR=…/MathiasB/config` |
| Session's own `echo` | `CFG=…/MatzeB/config` | `CFG=…/MathiasB/config` |
| Transcript written under | `MatzeB/config/projects/…` | `MathiasB/config/projects/…` |
| `claude agents --json` under that profile | lists only A's session | lists only B's sessions (plus B's own interactive one) |
| `claude auth status` under that profile | matze.b@… | mathias.b@… |

B did **not** attach to A's supervisor; each config dir gets its own
supervisor and state dir, and every session bills the profile it was started
under.

## Verdict

**No wrong-account path at this version.** agent-switch isolates by
`CLAUDE_CONFIG_DIR`, and Agent View keys its supervisor on the config dir, so
caam's finding (supervisor ignores a per-profile `HOME`) does not apply. Step
0.2's doctor check and opt-in are not needed; D4 stays as written (never set
`CLAUDE_CODE_DISABLE_AGENT_VIEW`). Revisit if a Claude Code release shares one
supervisor across config dirs.

Both test sessions were stopped and removed (`claude stop`/`rm`) and the two
transient supervisors ended afterwards. Cost: two one-line turns per account,
plus two accidental turns from the `run --` bug.
