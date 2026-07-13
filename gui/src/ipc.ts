/**
 * IPC layer: the GUI drives the `agent-switch` binary through its `--json`
 * contract and never re-implements profile logic. Thin wrappers only — the
 * testable reshaping lives in transforms.ts.
 */

import { Command } from "@tauri-apps/plugin-shell";
import type { ProfileRow, StatusJson, ProviderId } from "./transforms.js";

async function runCli(args: string[]): Promise<string> {
  const out = await Command.create("agent-switch", args).execute();
  if (out.code !== 0) throw new Error(out.stderr || `agent-switch ${args.join(" ")} failed`);
  return out.stdout;
}

export async function listProfiles(): Promise<ProfileRow[]> {
  return JSON.parse(await runCli(["list", "--json"]));
}

export async function activeStatus(): Promise<StatusJson> {
  return JSON.parse(await runCli(["status", "--json"]));
}

export async function switchProfile(provider: ProviderId, name: string): Promise<void> {
  await runCli(["use", name, "--provider", provider]);
}

export async function openSession(provider: ProviderId, name: string): Promise<void> {
  // Fire-and-forget a new session; the CLI injects the provider env var.
  Command.create("agent-switch", ["run", name, "--provider", provider]).spawn();
}

export async function openWeb(name: string): Promise<void> {
  Command.create("agent-switch", ["web", name]).spawn();
}
