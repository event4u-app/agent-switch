# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/event4u-app/agent-switch/security/advisories/new),
not in a public issue. Include the version (`agent-switch --version`), your OS,
and the steps to reproduce.

You get an acknowledgement within a few working days. Fixes ship in a regular
release, and the advisory is published once a fixed version is available.

## Supported versions

Only the latest release receives security fixes. Update with
`agent-switch update`.

## Scope

agent-switch is a local tool. It stores logins only where each provider's own
tool keeps them, and it talks to the provider's own usage endpoints with each
account's own login. What it reads, stores and sends is documented in
[Security & privacy](https://event4u-app.github.io/agent-switch/trust/security-and-privacy/).
