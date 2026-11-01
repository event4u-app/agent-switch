/**
 * Usage, limits and login state: status, usage history, autoswitch, reset
 * (Codex reset credit), protection, auth-status.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  configDir,
  die,
  identity,
  listAllProfiles,
  listProfiles,
  profileDir,
  profileExists,
  requireProfile,
  activeFor,
  PROFILE_LABELS,
  readAutoSwitch,
  readAutoSwitchAll,
  setAutoSwitch,
  type AutoSwitchTag,
  readBinaryPath,
} from "../profiles.js";
import { ProviderId, PROVIDER_IDS, provider } from "../providers.js";
import { autoContinueState, clearAutoContinue, readProtection, setAutoContinue, setProtection } from "../protection.js";
import { HistorySample, LATEST_FILE, readHistory, recordHistorySample, writeLatestSnapshot } from "../history.js";
import { checkAuth, fetchProfile, fetchUsage } from "../api.js";
import { claudeLoginRefreshAllowed, defaultFreshenDeps, usageToken } from "../token-freshen.js";
import { formatSnapshot, parseUsage } from "../usage.js";
import { readCodexUsage } from "../codex-usage.js";
import { redeemResetCredit } from "../codex-reset.js";
import {
  authStatusFor,
  claudeSnapshot,
  confirmAction,
  formatContext,
  logActivity,
  parseMemberArg,
  worstLiveContext,
} from "./shared.js";

/**
 * Identity + (Claude only) usage. The default all-profile table is human-only.
 * `--json` emits the ACTIVE profile's snapshot ONLY — never a machine-readable
 * cross-account view (the anti-rotation boundary: no ranking material).
 */
export async function cmdStatus(providerId?: ProviderId, name?: string, json = false): Promise<void> {
  if (json) {
    const pid = providerId ?? "claude";
    const active = name ?? activeFor(pid);
    if (!active || !profileExists(pid, active)) die(`no active ${pid} profile for --json`);
    const usage = pid === "claude"
      ? await claudeSnapshot(active)
      : pid === "codex"
        ? await readCodexUsage(configDir("codex", active))
        : null;
    // Feed the 30-day usage history from the GUI's own fetches: the GUI polls
    // every displayed profile on each refresh, so recording the fresh snapshot
    // here (throttled to ~hourly) fills the chart for all profiles without
    // depending on the background daemon or an "active" profile being set.
    if (usage) {
      recordHistorySample(path.join(profileDir(pid, active), "usage-history.json"), usage);
      // Unthrottled: `dir` balances on usage only while it is minutes old.
      writeLatestSnapshot(path.join(profileDir(pid, active), LATEST_FILE), usage);
    }
    const wc = worstLiveContext(pid, active);
    const context = wc
      ? { sessionId: wc.sessionId, pct: wc.pct, contextTokens: wc.contextTokens, windowTokens: wc.windowTokens, model: wc.model, confidence: wc.confidence }
      : null;
    console.log(JSON.stringify({ provider: pid, name: active, identity: identity(pid, active), usage, context }, null, 2));
    return;
  }

  const rows = name
    ? [{ provider: providerId ?? "claude", name: requireProfile(providerId ?? "claude", name, "status") }]
    : (providerId ? listProfiles(providerId).map((n) => ({ provider: providerId, name: n })) : listAllProfiles());
  if (rows.length === 0) die("no profiles");

  for (const { provider: pid, name: n } of rows as { provider: ProviderId; name: string }[]) {
    const mark = activeFor(pid) === n ? "*" : " ";
    console.log(`${mark} ${pid}/${n} — ${identity(pid, n) ?? "not logged in"}`);
    const wc = worstLiveContext(pid, n);
    if (wc) console.log(`  live context: ${formatContext(wc)}  (session ${wc.sessionId.slice(0, 8)})`);
    if (pid === "codex") {
      // Last-known from the newest rollout (no live endpoint); shows nothing
      // until this profile has run codex at least once.
      const snap = await readCodexUsage(configDir("codex", n));
      const lines = snap ? formatSnapshot(snap) : [];
      if (lines.length > 0) lines.forEach((l) => console.log(l));
      else console.log("  (usage unavailable — token expired or not logged in)");
      continue;
    }
    if (pid !== "claude") {
      console.log("  (no usage readout for this provider — shows own usage only where available)");
      continue;
    }
    const token = usageToken(configDir("claude", n), defaultFreshenDeps(readBinaryPath("claude")), claudeLoginRefreshAllowed(n));
    if (!token) {
      const auth = authStatusFor("claude", n);
      console.log(
        auth.state === "sign-in-needed"
          ? `  (signed out — sign in again: agent-switch login ${n})`
          : "  (credential not readable — profile may not have run yet)",
      );
      continue;
    }
    const [profileInfo, raw] = await Promise.all([fetchProfile(token), fetchUsage(token)]);
    const org = profileInfo?.organization?.name ?? profileInfo?.account?.email ?? null;
    if (org) console.log(`  org: ${org}`);
    const lines = raw ? formatSnapshot(parseUsage(raw)) : [];
    if (lines.length > 0) lines.forEach((l) => console.log(l));
    else if (profileInfo) console.log("  (usage unavailable — API shape changed?)");
    else {
      // Both profile and usage came back empty — disambiguate a dead login from
      // a transient/offline failure with one read-only probe (no token write).
      const auth = await checkAuth(configDir("claude", n));
      console.log(
        auth === "expired"
          ? `  (login expired — run \`agent-switch run ${n}\` and /login again)`
          : "  (usage unavailable — offline, or the login expired)",
      );
    }
  }
}

/** Manually redeem one banked rate-limit reset for a Codex profile. Consumes a
 *  real, scarce credit — the GUI gates this behind a confirmation. */
export async function cmdReset(providerId: ProviderId, name?: string, yes = false): Promise<void> {
  if (providerId !== "codex") die("reset is only available for codex (banked rate-limit resets).");
  const n = requireProfile("codex", name, "reset");
  if (!(await confirmAction(`Redeem one banked rate-limit reset for codex/${n}? Credits are scarce and cannot be returned.`, yes))) {
    console.log("Cancelled — nothing redeemed.");
    return;
  }
  const r = await redeemResetCredit(configDir("codex", n));
  logActivity("redeem", `codex/${n}`, r.ok ? "redeemed one banked reset" : `redeem failed: ${r.reason ?? "unknown"}`, "user ran `agent-switch reset`", r.ok);
  if (r.ok) {
    console.log(`Redeemed a reset for codex/${n} (windows_reset=${r.windowsReset ?? "?"}).`);
  } else {
    die(`reset failed: ${r.reason ?? "unknown"}`);
  }
}

export function cmdAutoswitch(
  providerId: ProviderId,
  providerExplicit: boolean,
  mode?: string,
  flags: Record<string, string | boolean> = {},
): void {
  const thresholdFlag = flags.threshold;
  const threshold = typeof thresholdFlag === "string" ? Number(thresholdFlag) : undefined;
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 1 || threshold > 100)) {
    die("--threshold must be a number between 1 and 100");
  }
  // --tag <all|work|personal|other>: restrict switch targets to accounts with
  // that label (case-insensitive). "all" clears the filter.
  const tagFlag = flags.tag;
  let tag: AutoSwitchTag | undefined;
  if (typeof tagFlag === "string") {
    const low = tagFlag.toLowerCase();
    const matched = low === "all" ? "all" : PROFILE_LABELS.find((l) => l.toLowerCase() === low);
    if (!matched) die("--tag must be one of: all, work, personal, other");
    tag = matched as AutoSwitchTag;
  }
  if (mode === "on" || mode === "off") {
    // Auto-switch only makes sense where there is a usage readout to trigger on
    // (Claude today). Elsewhere there is nothing to act on, so enabling is refused.
    if (mode === "on" && !provider(providerId).hasUsageReadout) {
      die(`auto-switch is only available for providers with a usage readout (Claude, Codex).`);
    }
    const cfg = setAutoSwitch(providerId, {
      enabled: mode === "on",
      ...(threshold !== undefined ? { threshold } : {}),
      ...(tag !== undefined ? { tag } : {}),
    });
    const tagNote = cfg.tag === "all" ? "" : `, tag ${cfg.tag}`;
    console.log(`Near-limit notifications for ${providerId} ${cfg.enabled ? "ON" : "OFF"} (threshold ${cfg.threshold}%${tagNote}).`);
    if (cfg.enabled) {
      console.log(
        `Once the active ${providerId} profile hits the threshold, the daemon NOTIFIES you and SUGGESTS the\n` +
          "account with the most headroom — it never switches automatically; switching stays a manual action.\n" +
          "On Codex it also tells you when a banked reset is available — redeeming one stays your call (`agent-switch reset`).\n" +
          "Run `agent-switch service start` so the daemon is watching.",
      );
    }
    return;
  }
  if (mode === undefined || mode === "status") {
    if (flags.json) {
      // The GUI needs every provider's state at once (per-tab dots).
      console.log(JSON.stringify(readAutoSwitchAll()));
      return;
    }
    for (const p of providerExplicit ? [providerId] : PROVIDER_IDS) {
      const cfg = readAutoSwitch(p);
      const tagNote = cfg.tag === "all" ? "" : `, tag ${cfg.tag}`;
      console.log(`${p}: near-limit notifications ${cfg.enabled ? "ON" : "OFF"} (threshold ${cfg.threshold}%${tagNote}).`);
    }
    return;
  }
  die("usage: agent-switch autoswitch on|off|status [--provider P] [--threshold <1-100>] [--tag all|work|personal|other] [--json]");
}

/**
 * `agent-switch usage history [--provider claude] [--profile <name>] [--json]`
 * — the daemon-recorded usage-history ring per profile (same file the daemon
 * appends: `<profileDir>/usage-history.json`). `--json` is the GUI contract:
 * `[{ profile, samples: [{ at, windows }] }]`. Own-profile data only.
 */
export function cmdUsageHistory(providerId: ProviderId, sub?: string, flags: Record<string, string | boolean> = {}): void {
  if (sub !== "history") die("usage: agent-switch usage history [--provider P] [--profile <name>] [--json]");
  const profiles = typeof flags.profile === "string"
    ? [requireProfile(providerId, flags.profile, "usage history --profile")]
    : listProfiles(providerId);
  if (profiles.length === 0) die(`no ${providerId} profiles`);

  const rows: { profile: string; samples: HistorySample[] }[] = profiles.map((p) => ({
    profile: p,
    samples: readHistory(path.join(profileDir(providerId, p), "usage-history.json")),
  }));

  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    if (r.samples.length === 0) {
      console.log(`${providerId}/${r.profile}: no usage history yet (the daemon records samples — agent-switch service start)`);
      continue;
    }
    const first = r.samples[0].at;
    const last = r.samples[r.samples.length - 1].at;
    console.log(`${providerId}/${r.profile}: ${r.samples.length} sample${r.samples.length === 1 ? "" : "s"} (${first} → ${last})`);
  }
}

export function cmdAuthStatus(providerId: ProviderId | undefined, json: boolean): void {
  const rows = (providerId ? listProfiles(providerId).map((n) => ({ provider: providerId, name: n })) : listAllProfiles()).map((r) =>
    authStatusFor(r.provider, r.name),
  );
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) return void console.log("No profiles.");
  for (const r of rows) {
    const exp = r.expiresAt ? `, ends ${r.expiresAt}` : "";
    console.log(`${`${r.provider}/${r.name}`.padEnd(24)} ${r.state}${exp} — ${r.detail}`);
  }
}

export function cmdProtection(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const usageLine =
    "usage: agent-switch protection [--json] | protection set <provider/name> [--on|--off] [--threshold <1-100>] | protection wait <on|off|default> <claude/name>";
  if (sub === undefined || sub === "status" || sub === "list") {
    const rows = listAllProfiles().map((p) => ({
      profile: `${p.provider}/${p.name}`,
      ...readProtection(p.provider, p.name),
      // What Claude Code itself does at the limit; null for providers without the setting.
      hostWaits: p.provider === "claude" ? autoContinueState(configDir(p.provider, p.name)) : null,
    }));
    if (flags.json) return void console.log(JSON.stringify(rows, null, 2));
    if (rows.length === 0) return void console.log("No profiles.");
    const waitText = { on: "Claude waits at the limit", default: "Claude waits at the limit (default)", off: "stops at the limit", unknown: "settings.json unreadable" };
    for (const r of rows) {
      const wait = r.hostWaits ? `  ·  ${waitText[r.hostWaits]}` : "";
      console.log(`${r.profile.padEnd(24)} ${r.enabled ? "on " : "off"}  at ${r.thresholdPct}%${wait}`);
    }
    console.log("\nA warning when a profile reaches its threshold — agent-switch pauses and switches nothing.");
    console.log("At 100 % Claude Code's own auto-continue decides: wait for the reset, or stop. Change it with `agent-switch protection wait on|off <claude/name>`, or return to Claude's default with `protection wait default <claude/name>`.");
    return;
  }
  if (sub === "wait") {
    const state = args[0];
    if (state !== "on" && state !== "off" && state !== "default") die(usageLine);
    const m = parseMemberArg(args[1], usageLine);
    if (m.provider !== "claude") die("protection wait applies to Claude profiles only (it sets Claude Code's autoContinueAtUsageLimit)");
    requireProfile(m.provider, m.name, "protection wait");
    const cfg = configDir(m.provider, m.name);
    try {
      if (state === "default") clearAutoContinue(cfg);
      else setAutoContinue(cfg, state === "on");
    } catch (e) {
      die((e as Error).message);
    }
    logActivity("protection", `${m.provider}/${m.name}`, `auto-continue ${state}`, "user ran `agent-switch protection wait`");
    // A shared settings.json is one file for every profile linked to it.
    let shared: string[] = [];
    try {
      const real = fs.realpathSync(path.join(cfg, "settings.json"));
      shared = listProfiles("claude").filter((n) => {
        try {
          return fs.realpathSync(path.join(configDir("claude", n), "settings.json")) === real;
        } catch {
          return false;
        }
      });
    } catch {
      shared = [m.name];
    }
    if (flags.json) return void console.log(JSON.stringify({ profile: `${m.provider}/${m.name}`, hostWaits: autoContinueState(cfg), affected: shared.map((n) => `claude/${n}`) }, null, 2));
    const targets = `${shared.map((n) => `claude/${n}`).join(", ")}${shared.length > 1 ? " (shared settings.json)" : ""}`;
    if (state === "default") {
      console.log(`Claude auto-continue back to Claude Code's default for ${targets}.`);
      console.log("The setting is no longer pinned; Claude Code decides (today: wait for the reset and continue).");
      return;
    }
    console.log(`Claude auto-continue ${state} for ${targets}.`);
    console.log(state === "on" ? "At the limit, a session waits for the reset and continues by itself." : "At the limit, Claude Code offers the wait as a choice instead.");
    return;
  }
  if (sub !== "set") die(usageLine);
  const m = parseMemberArg(args[0], usageLine);
  requireProfile(m.provider, m.name, "protection set");
  if (flags.on && flags.off) die("pass either --on or --off, not both");
  const threshold = typeof flags.threshold === "string" ? Number(flags.threshold) : undefined;
  if (threshold !== undefined && !(Number.isInteger(threshold) && threshold >= 1 && threshold <= 100)) die("--threshold must be a whole number between 1 and 100");
  if (!flags.on && !flags.off && threshold === undefined) die(usageLine);
  const next = setProtection(m.provider, m.name, {
    ...(flags.on ? { enabled: true } : {}),
    ...(flags.off ? { enabled: false } : {}),
    ...(threshold !== undefined ? { thresholdPct: threshold } : {}),
  });
  logActivity("protection", `${m.provider}/${m.name}`, `${next.enabled ? "on" : "off"} at ${next.thresholdPct}%`, "user ran `agent-switch protection set`");
  if (flags.json) return void console.log(JSON.stringify({ profile: `${m.provider}/${m.name}`, ...next }, null, 2));
  console.log(`Session protection for ${m.provider}/${m.name}: ${next.enabled ? "on" : "off"} at ${next.thresholdPct}%.`);
}
