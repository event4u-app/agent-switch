# Docs screenshots

`generate.mjs` renders the documentation screenshots as **SVG** into
`../public/screenshots/`. The docs reference them at
`/agent-switch/screenshots/<name>.svg`.

## Regenerate

```bash
node generate.mjs      # or, from the repo root: task docs:screenshots
```

Pure Node, **zero dependencies** — no browser, no npm install. The generated
SVGs are committed, so the docs build never runs this; it is a dev-time tool.

## Everything here is fake and anonymized

These are illustrative mock screenshots, not captures of a real session. The
generator only ever emits:

- **Fake emails** on the reserved `.example` TLD (`you@company.example`,
  `you@personal.example`, `dev@event4u.example`) — never a real address.
- **Generic profile names** (`work`, `privat`, `event4u`).
- **No real tokens, paths, account IDs, or usage data.**

When adding or editing a fixture in `generate.mjs`, keep to this rule: no real
account, email, or identifier may appear. If you need a new sample identity, use
another `<label>@<something>.example` address.

## Output

| File | Shows |
| --- | --- |
| `asw-list.svg` | `asw` profile list + a switch |
| `list-multiprovider.svg` | `agent-switch list` grouped by provider |
| `status.svg` | `agent-switch status` (usage + context bars) |
| `sessions.svg` | `agent-switch sessions` (context %) |
| `doctor.svg` | `agent-switch doctor` self-check |
| `gui-main.svg` | Tray-GUI main window mock |
| `gui-sessions.svg` | Tray-GUI sessions panel mock |
