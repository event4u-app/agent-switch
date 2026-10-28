# Non-goals

agent-switch earns trust by what it refuses to do. Its whole mechanism is
"set an environment variable and get out of the way" — every item below
would break that promise, so it is out of scope permanently, not merely
unscheduled. Each entry names the concrete alternative this ecosystem
offers instead.

## No prompt compression (Caveman-class rewriting)

Heuristically stripping "filler" from prompts in the transport path can
delete meaning-bearing hedges and qualifiers, and it competes with doing
token economy at the source. **Instead:** [agent-config](https://github.com/event4u-app/agent-config)
manages what agents load per request (thin, deterministic, verifiable),
and [rtk](https://github.com/rtk-ai/rtk) (third-party, Apache-2.0)
filters *tool output* — not prompts — where you opt in.

## No MITM proxy, no TLS interception

agent-switch never sits in your traffic. No root CA, no cert
installation, no sudo, no request rewriting. **Instead:** per-profile
`CLAUDE_CONFIG_DIR` isolation — the provider CLI talks to its vendor
directly, unmodified.

## No client fingerprinting or impersonation

agent-switch never masquerades as another client, never reconstructs
vendor billing fingerprints, and never scrubs identifying headers.
**Instead:** each profile is a real, independently logged-in account
using the vendor's own client.

## No provider free-tier pooling

Aggregating free tiers across providers whose terms prohibit proxy/relay
use is a ToS minefield that shifts risk onto the user. **Instead:**
agent-switch pools *your own* accounts — the ones you already pay for
and are entitled to use — and only switches which one is active, when
you tell it to.

## No request-level routing

Routing individual requests between providers requires intercepting
them (see MITM above). **Instead:** agent-switch's honest form of
routing is account-level and explicit. The background daemon
(`src/daemon.ts`) never switches anything on its own: with the opt-in,
default-off near-limit notifications it *notifies* you and *suggests* the
account with the most headroom; on Codex it tells you when a banked reset
is available but never redeems one. A new session can be placed by a
folder rule, including a rule that points at a pool you created yourself
(`agent-switch pool`), which picks the member with the most fresh headroom
and says why (`agent-switch dir --json`). That pick reads cached usage only
(the background service refreshes pool members every 5 minutes); with no
member checked in the last 10 minutes it falls back to the active profile. Own profiles only, no traffic
touched, and a running session changes its account only when you confirm
it.

## No bundled dashboard server

agent-switch ships a CLI (zero runtime dependencies) and an optional
tray GUI that is a thin client of the CLI's `--json` contract. It does
not run a web server, does not open ports, and does not grow a hosted
dashboard. **Instead:** the GUI renders what the CLI already knows; for
agent governance surfaces, agent-config's own local UI is embedded via
its documented contract rather than rebuilt.
