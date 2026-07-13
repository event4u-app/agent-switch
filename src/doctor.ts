/**
 * `agent-switch doctor` — a per-OS self-check.
 *
 * Reports health with actionable fixes and returns an exit code: 0 when there
 * is no hard error (warnings are fine), 1 when a check fails outright (e.g.
 * `claude` is not on PATH). Read-only — it never mutates a profile.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

import {
  ROOT,
  DEFAULT_CONFIG_DIR,
  configDir,
  listProfiles,
  profileExists,
  readState,
} from "./profiles.js";
import { credentialStore } from "./credentials.js";
import { sharedLinkHealth } from "./share.js";

const OK = "✅";
const WARN = "⚠️";
const ERR = "❌";

export function runDoctor(): number {
  let hardError = false;
  const line = (mark: string, msg: string) => console.log(`${mark}  ${msg}`);

  console.log(`agent-switch doctor — platform ${process.platform}, node ${process.version}`);
  console.log(
    process.platform === "darwin"
      ? "  credential store: macOS Keychain (hashed service per config dir), file fallback"
      : "  credential store: plaintext .credentials.json under each profile's config dir",
  );
  console.log("");

  // 1. claude binary on PATH — the hard requirement.
  const probe = spawnSync("claude", ["--version"], { stdio: "ignore" });
  if ((probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    line(ERR, "`claude` not found on PATH — install Claude Code, then reopen your shell.");
    hardError = true;
  } else if (probe.error) {
    line(WARN, `could not run \`claude --version\`: ${probe.error.message}`);
  } else {
    line(OK, "`claude` is on PATH.");
  }

  // 2. Default install (import source).
  if (fs.existsSync(DEFAULT_CONFIG_DIR)) line(OK, `default install present at ${DEFAULT_CONFIG_DIR}.`);
  else line(WARN, `no default ~/.claude install (that's fine unless you plan to \`import\`).`);

  // 3. Profiles.
  const profiles = listProfiles();
  if (profiles.length === 0) {
    line(WARN, `no profiles yet under ${ROOT} — create one with \`agent-switch add <name>\`.`);
  } else {
    line(OK, `${profiles.length} profile(s) under ${ROOT}: ${profiles.join(", ")}.`);
  }

  // 4. Active profile resolves.
  const active = readState().active;
  if (active && !profileExists(active)) {
    line(WARN, `active profile "${active}" no longer exists — run \`agent-switch use <name>\`.`);
  } else if (active) {
    line(OK, `active profile: ${active}.`);
  } else if (profiles.length > 0) {
    line(WARN, "no active profile set (falling back to default) — `agent-switch use <name>`.");
  }

  // 5. Credential readability per profile.
  const store = credentialStore();
  for (const p of profiles) {
    if (store.read(configDir(p)) !== null) line(OK, `${p}: credential readable.`);
    else line(WARN, `${p}: credential not readable — run \`agent-switch run ${p}\` and /login once.`);
  }

  // 6. Share-link health per profile.
  for (const p of profiles) {
    const health = sharedLinkHealth(configDir(p));
    if (health.length === 0) continue; // sharing not configured for this profile
    const forked = health.filter((h) => h.state === "forked").map((h) => h.name);
    const missing = health.filter((h) => h.state === "missing").map((h) => h.name);
    if (forked.length === 0 && missing.length === 0) {
      line(OK, `${p}: ${health.length} shared link(s) intact.`);
    } else {
      const parts = [
        forked.length ? `forked: ${forked.join(", ")}` : "",
        missing.length ? `missing: ${missing.join(", ")}` : "",
      ].filter(Boolean);
      line(WARN, `${p}: ${parts.join("; ")} — run \`agent-switch share sync\`.`);
    }
  }

  console.log("");
  line(hardError ? ERR : OK, hardError ? "doctor found a blocking problem (see above)." : "no blocking problems.");
  return hardError ? 1 : 0;
}
