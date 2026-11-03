# Council — v3.2 remote stages R1/R2 (design)

Mode `design` · 2 members (anthropic, openai) · subscription, $0.00 · 2026-11-03 · quorum 2/2 concluded.
Convened before the first edit of Phase 2–3 (security-sensitive surface). The prompt below was sent verbatim with the council CLI's neutral preamble; three literal syntax fragments were rephrased in prose first because the egress redactor refused them.

## Prompt (as sent)

~~~markdown
# Design: remote access to a local coding-agent manager, stages R1 and R2

## Context

Agent Switch is a local desktop app plus CLI (TypeScript, Node, Tauri GUI) that
manages several accounts of coding agents (Claude Code, Codex, ACP agents) on one
machine. It runs sessions in tmux ("hosted") or watches sessions in the user's own
terminal, and has a chat view whose per-session "bridge" process holds the agent
on stdio. Pending approvals ("the agent wants to run `rm -rf build`") and
questions of bridge chats are written to per-bridge JSON files and shown in a
"Needs you" list. A local engine listens on a 0600 Unix socket only; there is no
TCP port today.

The owner asks: "the app can be reached from anywhere". Fixed decisions:

- Stages: R1 vendor channel, R2 own tunnel (SSH / Tailscale), R3 end-to-end
  relay — R3 is **not** built now.
- Every stage is **off** until the user turns it on.
- The product's non-goal changes from "no server" to "no server outside your own
  network, no relay without end-to-end encryption".

Binding rules for every networked stage: auth always on; device tokens hashed,
with expiry and "revoke all"; pairing code only in the URL fragment, attempts
limited; Host and Origin checked, a missing Origin rejected; token never in a
URL, localStorage, logs or terminal; **no remote privilege escalation** (a remote
device may answer approvals, never loosen permission modes or change settings);
argv only, session ids validated; scopes split `view / respond / approve` versus
`terminal.write / file.upload / git.write`; a maximum device count.

## Proposed design

### R1 — Claude Remote Control (no inbound port)

- Setting per account, and per session at start: "Remote Control on". When on, a
  hosted Claude session starts with `claude --remote-control "<name>"`, name =
  the session title reduced to `[A-Za-z0-9 ._-]{1,60}`. The vendor's own channel
  carries the traffic; AS opens nothing.
- AS never passes a permission mode to it beyond what the session already has,
  and never `bypassPermissions`.
- Codex: no AS mechanism; the settings page points to the vendor app's own
  remote connections.

### R2a — over SSH, no listener at all

- `agent-switch remote rpc` reads one JSON request per line on stdin and answers
  on stdout. A laptop reaches a server's engine with
  `ssh server agent-switch remote rpc` — SSH is the authentication and the
  transport; AS opens no port and stores no token for this path.
- The same narrow API as R2b (below), with all scopes of the SSH user, except
  the forbidden operations, which do not exist in the API at all.

### R2b — phone web client inside the tailnet

- `agent-switch remote serve` starts an HTTP server bound **only** to the
  machine's Tailscale address (from `tailscale ip`; addresses in 100.64.0.0/10
  or fd7a:115c:a1e0::/48 only). No Tailscale address → it refuses to start. Never
  0.0.0.0, never a LAN address. Plain HTTP; the tailnet's WireGuard carries the
  encryption.
- **Pairing (local only):** the desktop app or `agent-switch remote pair` (device name and scopes as arguments) creates a code of 10 base32
  characters, valid 5 minutes, at most 5 wrong attempts across all codes before
  every open code is invalidated. It is shown as
  a link to the tailnet host and port whose fragment (after the # sign) carries the code (QR in the app). The fragment never
  reaches the server; the page's script POSTs it in a JSON body to `/api/pair`.
- **Device secret** (32 random bytes): returned once in that pairing response and set as a
  cookie with the flags HttpOnly and SameSite Strict, path limited to the API prefix. Stored on the server only as
  SHA-256 with device name, scopes, created, last seen, expiry (30 days, renewed
  on use up to 90 days absolute). At most 5 devices. Revoke one or "revoke all"
  only from the local app or CLI.
- **Every API call is POST** with a JSON body. Checks before anything else:
  `Host` equals the bound address or the machine's tailnet name with the port;
  `Origin` present and equal to the same origin (missing → 403);
  a JSON content type; body ≤ 64 KB; per-device and per-IP rate
  limit. Logs carry the device name, never the token or the cookie header.
- **API (the whole surface):**
  - `view`: `needs` (approvals, questions, limits), `sessions` (titles, state,
    account), `timeline` of one session (last 200 events).
  - `respond`: answer a question; send a message to a chat the app runs.
  - `approve`: allow once / deny an approval of a chat the app runs. "Always
    allow" is **not** offered remotely (it widens a rule permanently).
  - `terminal.write`, `file.upload`, `git.write`: names reserved, no endpoint
    exists in this stage; pairing refuses them.
  - Not in the API in any scope: permission mode, model, settings, agents,
    accounts, pairing, revoking, starting or ending sessions.
- **Reaching a bridge:** a remote answer is appended to that bridge's inbox file
  (one 0600 JSON-lines file per bridge, named by a hash of the session key). The bridge process watches
  its own inbox and applies an answer only if the approval id is still open in
  that bridge; the answer becomes the same `approve` / `deny` the chat view
  sends, so the terminal prompt, the chat card and the remote answer are one
  decision — the first one wins, later ones are dropped.
- Session ids and keys are validated against the existing key grammar before
  any file is touched.

### Board and default

The Remote settings page shows R1, R2 (SSH and tailnet client), R3 "later", the
paired devices with scopes and last seen, "Revoke" and "Revoke all". Everything
is off until turned on.

## Questions

1. Which threats does this design not cover, and which of its controls are
   weaker than they look?
2. Is a cookie (HttpOnly, SameSite=Strict, no `Secure` because plain HTTP inside
   the tailnet) the right place for the device token, given the rule "never in a
   URL or localStorage"?
3. Is the bridge inbox file the right way for a remote answer to reach the
   process that owns the session, or is there a simpler or safer path?
4. Anything that should be cut from this stage to keep it small and safe?
~~~

## anthropic · claude-sonnet-4-5

Looking at this design as an independent round-2 reviewer. I've read the document and both prior critiques. Here's my assessment:

## 1. Points from round 1 I agree with

**From Reviewer A:**
- Tailscale network as security perimeter is weaker than presented (exit nodes, subnet routers, no machine identity verification)
- Bridge inbox file has unspecified concurrency control — simultaneous writes, partial reads, race conditions on "first wins"
- `respond` and `approve` blast radius underspecified — can `respond` inject arbitrary commands? Can remote approval of `rm -rf /` bypass local permission mode?
- Missing rollback criteria: no automatic revocation triggers, no emergency kill-switch, no in-flight operation handling
- "5 devices" appears arbitrary without justification
- R2b Tailscale binding needs machine identity verification, not just IP prefix checks

**From Reviewer B (critical findings):**
- **R1 enforcement gap is the core flaw** — vendor channel may already exceed stated binding rules; no demonstrated enforcement of device limits, scopes, expiry
- "No remote privilege escalation" is not established by omitting settings endpoints — `approve` can authorize agent commands that modify config, credentials, git state indirectly
- **R2a is full owner authority** — SSH user can `agent-switch settings set`, edit files directly, bypass RPC surface entirely
- Approval arbitration is asserted ("first wins") but not designed — needs atomic state transitions, restart behavior, duplicate handling
- Browser security incomplete: device secret returned in JSON response (not just cookie), plain HTTP risks, address prefix ≠ authenticated membership
- Session-key validation doesn't secure inbox files (symlinks, parent directory ownership, stale records)

Both reviewers correctly identify **R1's inclusion under uniform binding rules** as the hardest architectural pushback. I agree completely.

## 2. Points I disagree with or refine

**Reviewer A's SHA-256 salt concern** — For 32 random bytes, lack of salt is acceptable. This isn't password hashing; it's storage of a secret with infeasible brute-force space. Reviewer B correctly deprioritizes this.

**Reviewer A's "5 devices seems arbitrary"** — I think 5 is reasonable as a default. The real question isn't the number, it's whether it's configurable and what the threat model is. But the design doesn't need to justify every constant.

**Reviewer B's "defer arbitrary chat messages"** — I'd go further: the `respond` scope should ONLY answer pre-existing structured questions from the bridge, period. "Send a message to a chat" is so underspecified I'd cut it entirely. What prevents injection of slash commands? What's the format? This needs to be "respond to question ID X with option A/B/C" or similar structured responses, not free-form messages.

## 3. New points and refinements not raised in round 1

### Critical architectural issues

**23. Permission mode inheritance creates an authority paradox**

The design says remote approvals can't "loosen permission modes" but doesn't specify what they inherit. Scenario:
- Local session runs in strict mode requiring approval for all git commands
- Remote device with `approve` scope sees "pending: git push origin main"
- Remote approves it

Is this allowed? If **yes**, the remote device has authority the local interactive user doesn't (escalation). If **no**, remote approvals are useless for strict-mode sessions (defeats the purpose). The design needs explicit rules: "remote approvals inherit the session's permission mode and cannot grant operations that mode prohibits" OR "remote approvals bypass local mode but log this elevation." Neither is obviously wrong, but the choice must be made and enforced.

**24. Account isolation is unspecified**

AS manages multiple agent accounts. R2b design mentions "setting per account" for R1 but not for R2b. Questions:
- Can one paired device access sessions from all accounts?
- Is account selection part of device scopes at pairing time?
- Can device scopes differ per account?

Without this, a device paired for one account's "view-only" access might have `approve` access to another account's sessions. The API calls reference "session IDs" but not account boundaries.

**25. Rate limiting is underspecified to the point of being unusable**

"Per-device and per-IP rate limit" — but no numbers, no algorithm (token bucket? fixed window?), no consequence (429 response? device revoked?). Critical questions:
- Is it 1 req/sec? 10? 1000?
- Applied before auth (protects pairing endpoint) or after (protects API)?
- Do expired tokens hitting the API count against limits?
- Can an attacker with 5 expired tokens DoS by hitting rate limits?

This needs concrete numbers. "100 requests per device per minute, 20 requests per IP per minute pre-auth, 429 response with retry-after header."

**26. Timeline exposure (scope `view`) is drastically underestimated**

"Last 200 events" can include:
- Credentials in shell output (`echo $AWS_SECRET`)
- API keys in error messages
- File contents from `cat ~/.ssh/id_rsa`
- Database dumps from tool output

`view` scope is not read-only metadata — it's read-only access to sensitive execution history. This should be explicit: "timeline includes all tool inputs and outputs, which may contain secrets" and potentially require a separate `timeline.read` scope under `view`.

**27. Device naming is user input used in logs**

Device names are client-provided at pairing. Are they:
- Sanitized against log injection (`device\n[ERROR] Fake error`)?
- Length-limited?
- Validated against a character set?

If device names appear in logs unsanitized, an attacker can inject fake log entries, potentially masking real events or triggering log-parsing alerts.

### Security boundary violations

**28. The forbidden operations list must be explicit**

Reviewer A noted this; I'll sharpen it: without a concrete list, "no remote privilege escalation" is unauditable. The design should have a table:

```
Remote RPC methods (R2a/R2b):
✓ sessions.list
✓ needs.list
✓ question.answer
✓ approval.allow_once
✓ approval.deny
✗ accounts.add
✗ accounts.delete
✗ settings.set
✗ pairing.create
✗ devices.revoke
✗ sessions.start
✗ sessions.kill
```

Every method not explicitly listed should return "not implemented" or 403. "Not in the API" is too vague.

**29. Localhost binding bypass is implied-prohibited but should be explicit**

The design says "bound **only** to the Tailscale address" which I interpret as not binding to 127.0.0.1 or 0.0.0.0. But this should be explicit: "bind to the single Tailscale IP, not localhost, not wildcard, not LAN addresses." Otherwise future implementations might bind to multiple addresses "for convenience."

**30. Git operations cross a boundary the design doesn't acknowledge**

The design reserves `git.write` but git is special:
- `git push` publishes to shared repos (affects others)
- `git push --force` can destroy history (destructive, visible)
- `git branch -D` can delete local state (destructive)

Even without `git.write` scope, remote `approve` can authorize these if the agent suggests them. The guidance says "actions visible to others warrant user confirmation" but remote approval bypasses that. Should git operations that modify remote state be forbidden from remote approval entirely? Or logged specially?

### Implementation hazards

**31. The 64 KB body limit is not a limit**

Most HTTP servers (Node's `http`, Express, Fastify) buffer the full request body before routing to handlers. Checking JSON size in handler code means the server already allocated memory for a 1 GB payload. This must be a middleware-level or server-config-level `maxBodySize` enforced by the HTTP layer, not application code.

**32. Session ID validation must check existence and ownership, not just format**

"Session IDs validated against existing key grammar" means format checking. But can I approve approval ID `abc-def-ghi` in session `xyz` if I guess the format correctly? The validation must be:

```
1. Format valid? (grammar check)
2. Session exists? (lookup in active sessions)
3. Session belongs to an account this device can access? (scope check)
4. Approval exists and is still open? (state check)
```

Right now step 3 is missing from the design.

**33. QR code pairing assumes local GUI access**

The pairing flow shows a QR code. But:
- If I'm SSHed into the server, I can't see GUI QR codes
- R2a is already remote

The flow needs a terminal alternative (`agent-switch remote pair --show-terminal`) or the design should state "pairing must be initiated locally."

**34. Pairing code entropy vs. 5-attempt lockout creates a DoS vector**

10 base32 chars = 50 bits. Unbrute-forceable. But "5 wrong attempts invalidate all codes" means an attacker doesn't need to guess codes — they just spam 5 failures to prevent legitimate pairing. This is defense-in-depth against an impossible attack that creates a real DoS vector.

Better approach: codes are single-use with attempt limits per code, not global. Or: codes are single-use, period, and there's a separate pre-auth rate limit.

**35. Token renewal oracle**

If I have an expired token, does the API return a different error than a wrong token? Can I determine when a device last used the API by testing expired tokens? This is a timing oracle. All auth failures should return the same generic error with the same timing.

### Rollback and recovery

**36. Server restart with pending inbox actions is undefined**

If the server stops while an approval is in the inbox but not yet applied:
- Is it honored when the bridge restarts? (Dangerous if device was revoked while offline)
- Discarded? (Lost user intent if legitimate)
- Timestamped and rejected if too old? (Best, but not specified)

The design needs explicit semantics for stale inbox entries.

**37. Tailscale IP changes during operation**

R2b binds at startup using `tailscale ip`. If Tailscale reconfigures (network roam, topology change), the IP can change but the server keeps running on the old IP. The design should either:
- Monitor Tailscale status and shut down if IP changes
- Rebind dynamically (complex)
- Accept this as a "restart required on network change" limitation and document it

### The architectural call I'd push back on second-hardest

After R1's enforcement gap (which both prior reviewers identified), my second-hardest pushback is:

**Plain HTTP when Tailscale supports HTTPS natively**

Reviewer A notes the missing `Secure` flag. Reviewer B notes browser risks. I'll be more direct: **there is no good reason to use plain HTTP.**

Tailscale provides HTTPS with certs (`tailscale cert`) and serves HTTPS natively (`tailscale serve https:PORT`). The justification "WireGuard encrypts the transport" is correct for confidentiality but misses:
- **Defense in depth:** plain HTTP cookies are exposed to local proxies, debugging tools, malware
- **Secure flag:** can't be set without HTTPS, meaning cookies leak if the user misconfigures or a future version adds a non-Tailscale listener
- **Certificate pinning:** HTTPS allows future hardening
- **Browser trust:** modern browsers increasingly restrict plain HTTP (even on private IPs)

**Evidence that would change my mind:**
- Tailscale HTTPS adds unacceptable latency (needs measurement)
- Tailscale cert management is too complex for the pairing flow (needs user research)
- AS explicitly wants to support non-Tailscale transports in R2 (then plain HTTP is a constraint, not a choice)

Otherwise: use HTTPS, set the Secure flag, and remove one entire class of attacks.

---

## Summary

**Must-fix before greenlighting:**
1. R1's vendor enforcement gap (both prior reviewers)
2. R2a's SSH owner authority vs. scoped-device model (Reviewer B)
3. Permission mode inheritance and account isolation (new)
4. Explicit forbidden operations list (Reviewer A noted, I sharpened)
5. Approval arbitration mechanism (Reviewer B)
6. Use Tailscale HTTPS or justify plain HTTP in depth (new, builds on both reviewers)

**Should-fix for safety:**
- Timeline sensitivity (new)
- Rate limit numbers (new)
- 64 KB limit enforcement layer (builds on Reviewer A)
- Session ID authorization checks (new)
- Device name sanitization (new)
- Inbox restart semantics (new)

I would **not greenlight R2b as designed**. R1 needs a separate trust contract or demonstrated vendor integration. R2a is fine if documented as "full SSH owner access" not "scoped RPC." R2b needs HTTPS, explicit account scoping, and approval arbitration designed, not asserted.

## openai · codex-default

I would **request changes before approval**. Reviewer B identifies the main architectural problems; Reviewer A adds useful operational concerns but also makes several incorrect security claims. References below use section names because the proposal has no line numbers.

**1. Prior points I agree with**

- **B1 — Must fix: R1 does not satisfy the stated universal guarantees.** In **“Binding rules for every networked stage,”** AS promises scoped devices, expiry, revocation and no remote settings changes. In **R1**, it controls only startup arguments. Those are different enforcement boundaries. Require a versioned vendor capability matrix and tested disconnection behavior, or explicitly give R1 a separate trust contract. A vendor-managed channel is not automatically low risk.

- **B2, A’s scope concern — Must fix: endpoint restrictions do not bound agent-mediated authority.** In **API**, `respond` and `approve` can cause filesystem or Git changes through the agent. “No `git.write` endpoint” therefore says little about actual Git authority. Replace the broad guarantee with “remote API calls cannot directly change policy,” unless policy is protected outside the agent’s writable boundary.

- **B3 — Must fix: distinguish SSH owner access from paired-device access.** In **R2a**, ordinary SSH as the engine owner already conveys much greater authority than the RPC API. That is acceptable if stated honestly. A restricted-device promise requires a separately constrained SSH identity; the narrow RPC handler alone cannot provide it.

- **B4/B7/B8 and A’s IPC concerns — Must fix: define one authoritative decision transition.** In **Reaching a bridge**, “first one wins” is a requirement, not an implementation. Every local and remote input must converge on the same bridge-owned arbitration. Include bridge generation, immutable approval identity, duplicate handling and an applied/rejected acknowledgement. Successful append means queued, not approved.

- **B5 — Must fix: keep the token out of JavaScript.** In **Device secret**, send it only through `Set-Cookie`, not also in JSON. Prefer HTTPS with a host-only, Secure, HttpOnly, SameSite=Strict cookie. Cookie path restriction is not service isolation. [Cookie semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

- **B’s rollback proposal and A’s missing shutdown concern — Must fix.** Specify what disabling each stage does to existing access and queued actions. Software rollback must preserve revocations.

I also agree with B’s proposed cuts: defer arbitrary chat messages and sliding expiry, and initially expose only viewing plus responses to existing requests.

**2. Prior points I disagree with**

- **A: “Tailscale IP binding [is] the sole control.” — Rejected.** The proposal also requires an application device secret. Network exposure remains important, but a reachable API is not an authenticated API.

- **A: exit nodes or subnet routers inherently bypass tailnet ACLs. — Rejected as stated.** These scenarios need concrete routing and policy evidence. Tailscale documents incoming ACL enforcement on destination devices; simply having an exit node or advertised route does not establish the claimed bypass. Verify supported configurations rather than treating that attack chain as proven. [Tailscale ACL enforcement](https://tailscale.com/docs/features/access-control/acls)

- **A: trust `X-Forwarded-For` or Tailscale-specific headers as defense in depth. — Rejected without a trusted proxy boundary.** Direct callers can forge headers. Serve supplies and sanitizes identity headers, but its documentation explicitly warns against accepting them through a directly reachable backend. [Serve identity boundary](https://tailscale.com/docs/features/tailscale-serve)

- **A: “Add Secure anyway”; its cost is zero. — Rejected.** A non-localhost HTTP deployment cannot set that cookie as proposed. Enable HTTPS first. Also, ordinary HTTPS does not automatically provide certificate pinning. [Secure cookie requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

- **A: R2 is read-only. — Rejected.** Answering questions and approving commands are consequential writes. The design excludes particular direct operations, not mutation generally.

- **A: salt/password hashing is a material missing control. — Rejected.** SHA-256 is appropriate for uniformly random 256-bit bearer secrets. Protecting token storage and avoiding disclosure matter more here.

- **Automatic global revocation after unauthenticated failures — Rejected as a default.** That hands attackers a denial-of-service mechanism. Throttle failures; reserve global revocation for evidence of compromise or a local user action.

**3. New findings and refinements**

**High / must fix — scopes lack resource boundaries.**  
In **API**, `view / respond / approve` describe operations but not which accounts or sessions a device may access. Does pairing once authorize every future session, including another account’s confidential project? State that explicitly, or add locally selected account/session restrictions enforced on every lookup and decision.

**High / must fix — the remote process must not become an independent policy authority.**  
The proposal leaves unclear whether `remote serve` can access the owner’s unrestricted engine socket and write bridge files directly. Centralize authorization and dispatch in one gateway; keep transport handlers thin. Otherwise SSH, HTTP and local UI implementations will drift. Reusing the Unix socket is simpler only if its protocol provides the needed constrained dispatch—it is not automatically safer.

**High / must fix — approval context must survive display limits.**  
In **view**, “last 200 events” and request-size limits do not guarantee the phone displays the exact command, working directory, tool and relevant arguments being approved. Define a dedicated approval payload. Mark truncation clearly and disable approval when essential context cannot be displayed. Bind the response to that payload’s version.

**High / must fix — revocation needs a precise ordering guarantee.**  
B’s “recheck when applied” is necessary but incomplete: revocation can race between that check and execution. Define an atomic authorization/acceptance boundary shared with revocation. After that boundary, label the decision accepted and potentially irreversible; do not promise that disabling remote can undo an already accepted agent action.

**Medium / must fix — bounded requests do not imply bounded service cost.**  
In **Every API call**, add response-byte limits, header/body deadlines, connection limits and bounded pending work. Two hundred events can still contain enormous tool output. Pre-authentication protections must cover pairing and slow connections.

**Medium / defer — lifetime notifications and the five-device rationale.**  
These deserve documentation, but neither blocks a small first release. The five-device cap can be a deliberately conservative product limit.

**The architectural call I would challenge hardest**

It is **placing R1 and scoped R2 devices under one security promise**. That obscures who actually enforces authority and revocation.

Evidence that would change my mind: a supported-version capability matrix and integration tests demonstrating every claimed restriction, including existing-session disconnection. Current vendor documentation is a starting point, not that proof. [Claude Remote Control documentation](https://code.claude.com/docs/en/remote-control)

My revised sequence is: settle the authority contracts; implement shared dispatch and arbitration; exercise them through explicitly owner-trusted SSH; add HTTPS browser viewing; then enable remote decisions after race, restart and revocation tests pass. R1 can proceed independently once its contract is resolved. Disable an affected stage on an authorization bypass, cross-session decision, stale approval application or broken revocation guarantee.

**Approval summary:** retain the narrow surface, separate R1’s trust contract, centralize decision authority, and ship browser mutations only after their lifecycle is proven.

## Convergence / divergence

- **Converged (anthropic, openai):** R1 must not share one security promise with scoped R2 devices — the vendor enforces R1's devices and revocation, AS only adds the start flag.
- **Converged:** R2a over SSH is full owner authority; say so instead of calling `remote rpc` a scoped surface.
- **Converged:** "first one wins" must be a bridge-owned atomic transition with an applied/rejected acknowledgement; a written request means queued, not approved; stale requests refused.
- **Converged:** device scopes lack account/session boundaries; `view` of a timeline exposes tool output that may hold secrets.
- **Converged:** plain HTTP is the wrong default for the phone client — use Tailscale HTTPS with a Secure, HttpOnly, SameSite=Strict cookie, secret only via Set-Cookie.
- **Converged:** cut free-form chat messages from `respond`; ship browser mutations only after race, restart and revocation tests (openai: sequence contracts → shared arbitration → SSH → HTTPS viewing → remote decisions).
- **Divergent detail:** anthropic flags the global 5-attempt pairing lockout as a DoS vector (per-code limits instead); openai rejects automatic global revocation on unauthenticated failures for the same reason. Not contradictory.

Settled-by-decision (council advice + owner's choice of option 1), not by an eval.
- scope: the phone web client (R2b) and device pairing for v3.2 Phase 3.
- revisit-if: Tailscale is installed on a test machine and the shared bridge arbitration has shipped, so HTTPS serving, revocation races and restart behaviour can be tested end to end.

## Host verdict per finding

| Finding | Verdict | Reason (host evidence) |
|---|---|---|
| R1 separate trust contract | accept | `src/remote.ts` header and the Remote board say Anthropic decides R1 devices; AS only adds `--remote-control` (`remoteControlArgs`). |
| R2a = owner authority | accept | `remote rpc` documented as convenience, not sandbox (`starlight/.../guides/remote-access.mdx`); off by default (`readRemote`). |
| Bridge-owned arbitration with ack | accept | `src/bridge/inbox.ts`: bridge applies only while the approval is open, acks applied/rejected, refuses requests > 120 s; sensitivity-checked test in `tests/bridge-inbox.test.ts`. |
| No "always allow" remotely | accept | only allow-once/deny exist in `RPC_METHODS` and `InboxDecision`. |
| Explicit method table, unknown → not_implemented | accept | `RPC_METHODS`; `Object.hasOwn` so `__proto__`/`constructor` do not resolve (`tests/remote.test.ts`). |
| Cut free-form `respond` messages | accept | not built; `remote rpc` has no message method. |
| Phone client: HTTPS, Secure cookie, scopes per account, timeline exposure, rate limits, pairing DoS | accept-with-modification | the whole phone client is deferred to Later with the trigger above rather than built over plain HTTP. |
| Tailscale exit-node / subnet-router bypass (raised in round 1, contested by openai) | reject | no listener exists in this stage; moot until the phone client. |
| SHA-256 without salt for device secrets | reject | both members agree: fine for 256-bit random secrets; moot until pairing exists. |
