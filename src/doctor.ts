/**
 * `agent-switch doctor` — a per-OS, per-provider self-check.
 *
 * Reports health with actionable fixes and returns an exit code: 0 when there
 * is no hard error, 1 when a provider that has profiles is missing its binary.
 * Read-only — it never mutates a profile.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

import { ROOT, activeFor, configDir, listProfiles, profileExists } from "./profiles.js";
import { Provider, allProviders, provider } from "./providers.js";
import { credentialStore } from "./credentials.js";
import { sharedLinkHealth } from "./share.js";

const OK = "✅";
const WARN = "⚠️";
const ERR = "❌";

function binaryOnPath(binary: string): "yes" | "no" | "error" {
  const probe = spawnSync(binary, ["--version"], { stdio: "ignore" });
  if ((probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return "no";
  if (probe.error) return "error";
  return "yes";
}

function credentialReadable(p: Provider, name: string): boolean {
  const cfg = p.configDirFor(configDir(p.id, name));
  if (p.id === "claude") return credentialStore().read(cfg) !== null;
  try {
    fs.accessSync(p.credentialPath(cfg));
    return true;
  } catch {
    return false;
  }
}

export function runDoctor(): number {
  let hardError = false;
  const line = (mark: string, msg: string) => console.log(`${mark}  ${msg}`);

  console.log(`agent-switch doctor — platform ${process.platform}, node ${process.version}`);
  console.log(
    process.platform === "darwin"
      ? "  claude credential store: macOS Keychain (hashed per config dir), file fallback"
      : "  claude credential store: plaintext .credentials.json per profile",
  );
  console.log("");

  for (const p of allProviders()) {
    const names = listProfiles(p.id);
    const onPath = binaryOnPath(p.binary);

    if (onPath === "no") {
      if (names.length > 0) {
        line(ERR, `\`${p.binary}\` not on PATH but ${names.length} ${p.id} profile(s) exist — install ${p.id}.`);
        hardError = true;
      } else {
        line(WARN, `\`${p.binary}\` not on PATH (no ${p.id} profiles yet — fine unless you use ${p.id}).`);
      }
      continue;
    }
    if (onPath === "error") line(WARN, `could not probe \`${p.binary} --version\`.`);
    else line(OK, `\`${p.binary}\` is on PATH.`);

    if (names.length === 0) {
      line(WARN, `  no ${p.id} profiles yet — \`agent-switch add <name>${p.id === "claude" ? "" : ` --provider ${p.id}`}\`.`);
      continue;
    }
    line(OK, `  ${names.length} ${p.id} profile(s): ${names.join(", ")}.`);

    const active = activeFor(p.id);
    if (active && !profileExists(p.id, active)) {
      line(WARN, `  active ${p.id} profile "${active}" no longer exists.`);
    }
    for (const n of names) {
      if (credentialReadable(p, n)) line(OK, `  ${p.id}/${n}: credential readable.`);
      else line(WARN, `  ${p.id}/${n}: credential not readable — \`agent-switch run ${n}${p.id === "claude" ? "" : ` --provider ${p.id}`}\` and log in.`);
    }
  }

  // Share-link health (Claude-config sharing).
  for (const n of listProfiles("claude")) {
    const health = sharedLinkHealth(configDir("claude", n));
    if (health.length === 0) continue;
    const forked = health.filter((h) => h.state === "forked").map((h) => h.name);
    const missing = health.filter((h) => h.state === "missing").map((h) => h.name);
    if (forked.length === 0 && missing.length === 0) {
      line(OK, `claude/${n}: ${health.length} shared link(s) intact.`);
    } else {
      const parts = [forked.length ? `forked: ${forked.join(", ")}` : "", missing.length ? `missing: ${missing.join(", ")}` : ""].filter(Boolean);
      line(WARN, `claude/${n}: ${parts.join("; ")} — run \`agent-switch share sync\`.`);
    }
  }

  console.log(`\n  profile root: ${ROOT}`);
  console.log("");
  line(hardError ? ERR : OK, hardError ? "doctor found a blocking problem (see above)." : "no blocking problems.");
  return hardError ? 1 : 0;
}
