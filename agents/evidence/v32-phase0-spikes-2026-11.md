<!-- evidence-type: spike -->

# v3.2 Phase 0 spikes — 2026-11-03

Roadmap: `agents/roadmaps/road-to-agent-switch-v3-reach.md` Phase 0.
Machine: macOS (arm64), Gemini CLI 0.50.0, agy 1.4.12, codex-cli 0.166.0,
Claude Code 2.1.316. OpenCode, Goose, Qwen Code, Ollama and LM Studio are not
installed. Scripts were throwaway (an ACP JSON-RPC probe over stdio) and are
summarised here, not committed.

Source of the agent list used below: the ACP registry,
`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, fetched
2026-11-03 (46 agents).

## S6 — Antigravity ACP server: origin, licence, behaviour with AS profiles

| Question | Finding |
|---|---|
| Origin | Google LLC. The registry entry `antigravity-acp` 1.4.5 is a per-platform zip on `dl.google.com/agy-extensions/releases/…` (`agy_acp_server.par`), not part of the `agy` install and not on npm. The npm packages that wrap it (e.g. `@bamoo456/antigravity-acp`) are unofficial downloaders. |
| Licence | `proprietary`, `license_url: https://antigravity.google/terms`. |
| Terms | The wrappers quote Google's Antigravity terms: using third-party software to access Antigravity, including through Antigravity OAuth, is a breach and may lead to suspension; Google's FAQ points third-party agents to a Vertex AI or AI Studio API key instead. |
| Size | darwin-arm64 archive ≈ 301 MB, ≈ 876 MB unpacked (measured by the wrapper's manifest for 1.1.1). |
| Behaviour with AS profiles | **Not run.** Driving it with the owner's Antigravity OAuth login from AS is exactly the use the terms name; a 300 MB proprietary download for that was not taken. |

**Verdict: red.** E6 ("Antigravity via ACP after S6 is green") does not fire.
Antigravity stays **terminal only** in AS. The ACP suggestion list leaves
`antigravity-acp` out and says why. Re-open trigger: Google allows third-party
ACP clients on the consumer login, or the owner uses an API-key login, which
the agent registry row could then carry.

## S7 — local models via OpenCode and `codex --oss` + Ollama

| Path | Finding |
|---|---|
| OpenCode | Registry `opencode` 2.2.5 (MIT), started as `opencode acp` (JSON-RPC over stdio). A local model is a provider block in `opencode.json` (global `~/.config/opencode/opencode.json`, project `opencode.json`, or a file named by `OPENCODE_CONFIG`): `"ollama": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "http://localhost:11434/v1" }, "models": { "<id>": {} } }`, LM Studio the same at `http://127.0.0.1:1234/v1`; the model is chosen as `"model": "<provider>/<id>"`. The darwin-arm64 zip was downloaded and its SHA-256 matched the registry (`25ba9908…ce767`). |
| Codex | `codex --oss --local-provider ollama|lmstudio` (also on `codex exec`); without `--local-provider` it takes the config default or asks. |
| Live turn | **Not run.** Ollama is not installed, and starting the downloaded OpenCode and Ollama binaries from this session was refused by the session's permission policy (code from outside the repository). A live turn needs the owner to install Ollama (or LM Studio) and one of the two agents. |

**Verdict: the configuration shape is known; the live turn is open.** AS does
not need its own model runner: OpenCode reads the provider block, Codex takes
two flags. What AS records per agent is therefore just "local · <runner> ·
<model>" (M16), taken from the agent's own config, never a model AS runs.

## Gemini ACP `session/load` and history

`gemini --acp` (0.50.0) answers `initialize` with protocol version 1 and

```json
"agentCapabilities": { "loadSession": true,
  "promptCapabilities": { "image": true, "audio": true, "embeddedContext": true },
  "mcpCapabilities": { "http": true, "sse": true } }
```

and four auth methods (`oauth-personal`, `gemini-api-key`, `vertex-ai`, `gateway`).

| Call | Result |
|---|---|
| `session/new` | refused: `-32000` "This client is no longer supported for Gemini Code Assist for individuals … migrate to the Antigravity suite" (`IneligibleTierError`, `UNSUPPORTED_CLIENT`) — the owner's personal Google login is no longer served to Gemini CLI |
| `session/load` (unknown id) | `-32000` "Authentication required" — load is gated on auth before the id is looked at |
| `session/list` | `-32601` method not found — there is no listing over ACP |
| `gemini --list-sessions` | the same eligibility error; the chats live as `~/.gemini/tmp/<project>/chats/session-<time>-<id>.jsonl` |

**Verdict:** the protocol path works and `session/load` is advertised, so AS
resumes a Gemini session by id through ACP and keeps the id itself (no listing
over the protocol). A turn needs an API-key or Vertex login on this machine —
the personal login is refused by Google, not by AS.

## GUI PATH bootstrap for version managers, and the CLI version probe

A GUI-started process on macOS gets `/usr/bin:/bin:/usr/sbin:/sbin`. Today
`npmSearchPath` adds node's own dir, Homebrew, `/usr/local/bin`,
`~/.npm-global/bin` and `~/.local/bin`, which misses every version manager.

| Source | On this machine |
|---|---|
| login shell, `env -i HOME=… TERM=dumb zsh -ilc 'printf "__ASPATH__%s__END__" "$PATH"' </dev/null` | 109 ms; the user's zsh prints its own noise (a prompt plugin's errors) on stderr and stdout, so the PATH is cut out between the two markers, never taken as the whole output |
| `~/.nvm/versions/node/<default>/bin` | absent |
| `~/.volta/bin` | absent |
| `~/.local/share/mise/shims` | present (node, npm, npx, bun, corepack shims) — and **not** on the login PATH, because mise activates in the interactive prompt hook |
| `~/.asdf/shims` | absent |
| `~/.nix-profile/bin`, `/nix/var/nix/profiles/default/bin` | absent |
| `~/.bun/bin`, `~/.cargo/bin` | present, both on the login PATH |

**Verdict:** take both — the login shell's PATH (markers, `TERM=dumb`, stdin
closed, 3 s timeout, never its exit status) **and** the known version-manager
directories that exist on disk (nvm through its `default` alias, volta, mise
shims, asdf shims, nix profiles, bun, cargo), deduplicated, inherited PATH
first. The mise case shows the login shell alone is not enough.

The version probe stays `<binary> --version` with a timeout and the first
version-looking token (`parseVersionToken`), run with that PATH; Gemini prints
`0.50.0`, agy `1.4.12`, codex `codex-cli 0.166.0`.
