# Probe: does moving a session to another account keep its prompt cache?

Date 2026-11-01 · Claude Code 2.1.316 · roadmap
`road-to-sessions-that-show-their-cache` step 0.1.

## Method

1. One `claude -p "Reply with exactly: OK"` turn in an empty scratch directory.
   The shell's `claude` wrapper placed it on profile **MatzeB** (Team plan).
2. The transcript was copied into the same encoded project dir of **Matze**
   (same organization as MatzeB) and **MatneX** (Max plan, other organization).
3. Within the 1h TTL, each profile resumed the session with one more
   `-p` turn (`command claude`, so `CLAUDE_CONFIG_DIR` was not re-picked).
   MatzeB resumed last as the control.
4. Probe copies were deleted afterwards.

Organization identity was compared by a hash of `oauthAccount.organizationUuid`
in each profile's `.claude.json`; no id is recorded here.

## Result (tokens, `usage` of the resumed turn)

| Resumed on | Organization | cache read | cache write (1h) | input |
|---|---|---:|---:|---:|
| MatzeB (control, origin) | Team | 14,430 | 13,247 | 4 |
| Matze | same as origin | 14,430 | 13,739 | 2 |
| MatneX | other | 11,736 | 17,536 | 2 |

The first turn on MatzeB, with nothing of its own cached yet, also read 11,736:
that prefix is Claude Code's shared system prompt and tools, which hit across
organizations.

## Conclusion

- Same organization: the move reads exactly what staying reads. The cache
  follows the session.
- Other organization: only the shared ~12k prefix hits; the conversation itself
  is written again. For a long session that is the whole context.
- D5 holds: "same organization → as warm as staying, other → re-sends the
  conversation". The shared prefix is small next to a real session and is
  not subtracted in the user-facing line.
