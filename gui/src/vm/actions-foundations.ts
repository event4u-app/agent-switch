/**
 * Backend seam for the foundation readouts (protection, pools, folder rules,
 * guard, activity, health). Same contract as `createActions` in actions.ts —
 * one ipc call per method, reload after a write — kept in its own file so it
 * can be merged into `Actions` without touching the screens lane.
 */

import * as ipc from "../ipc.js";
import type { ProviderId } from "../transforms.js";
import { splitAccountId } from "./actions.js";
import { activityFromEntries, checksFromDoctor, readinessFromDoctor } from "./build.js";
import type { ActivityEvent, Check, GuardPolicy, Readiness, Tool, ViewModel } from "./types.js";

export interface FoundationActions {
  /** Limit warning per account; only the given fields change. */
  setProtection(accountId: string, patch: { enabled?: boolean; thresholdPct?: number }): Promise<void>;
  /** Returns the new pool's id (derived by the CLI from the name). */
  createPool(name: string): Promise<string>;
  renamePool(poolId: string, name: string): Promise<void>;
  /** The CLI refuses while a folder rule points at the pool — the error says which. */
  deletePool(poolId: string): Promise<void>;
  setPoolMembership(poolId: string, accountId: string, member: boolean): Promise<void>;
  /** Preview of pools derived from Work / Personal / Other labels; creates nothing. */
  previewPoolSuggestions(): Promise<ipc.PoolProposal[]>;
  /** Create the suggested pools; returns the ids created. */
  confirmPoolSuggestion(): Promise<string[]>;
  /** Map a folder (and its subfolders) to an account or, for one tool, a pool. */
  mapFolder(dir: string, target: { accountId: string } | { pool: string; tool: Tool }): Promise<void>;
  /** Remove a folder rule; without a tool every tool's rule on that folder goes. */
  unmapFolder(dir: string, tool?: Tool): Promise<void>;
  /** Which account a start in `dir` would use for `tool`, and why. */
  explainFolder(dir: string, tool: Tool): Promise<ipc.DirResolution>;
  setGuard(policy: GuardPolicy): Promise<void>;
  /** Re-read the activity log without a full reload. */
  refreshActivity(limit?: number): Promise<ActivityEvent[]>;
  /** Re-run `doctor` without a full reload. */
  runHealthCheck(): Promise<{ readiness: Readiness; checks: Check[] }>;
}

/** The redesign knows `gemini`; no backend does yet. */
function providerOf(tool: Tool): ProviderId {
  if (tool === "gemini") throw new Error("Gemini has no backend yet.");
  return tool;
}

export function createFoundationActions(_getVm: () => ViewModel, reload: () => Promise<void>): FoundationActions {
  const thenReload =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const r = await fn(...a);
      await reload();
      return r;
    };

  return {
    setProtection: thenReload(async (id: string, patch: { enabled?: boolean; thresholdPct?: number }) => {
      await ipc.setProtection(...splitAccountId(id), patch);
    }),
    createPool: thenReload(async (name: string) => (await ipc.createPool(name)).id),
    renamePool: thenReload(async (poolId: string, name: string) => {
      await ipc.renamePool(poolId, name);
    }),
    deletePool: thenReload((poolId: string) => ipc.deletePool(poolId)),
    setPoolMembership: thenReload(async (poolId: string, id: string, member: boolean) => {
      const [provider, name] = splitAccountId(id);
      await (member ? ipc.addPoolMember(poolId, provider, name) : ipc.removePoolMember(poolId, provider, name));
    }),
    previewPoolSuggestions: () => ipc.suggestPools(),
    confirmPoolSuggestion: thenReload(() => ipc.confirmPoolSuggestions()),
    mapFolder: thenReload(async (dir: string, target: { accountId: string } | { pool: string; tool: Tool }) => {
      if ("accountId" in target) {
        const [provider, name] = splitAccountId(target.accountId);
        await ipc.mapFolder(provider, { profile: name }, dir);
      } else {
        await ipc.mapFolder(providerOf(target.tool), { pool: target.pool }, dir);
      }
    }),
    unmapFolder: thenReload((dir: string, tool?: Tool) => ipc.unmapFolder(dir, tool ? providerOf(tool) : undefined)),
    explainFolder: (dir: string, tool: Tool) => ipc.resolveDir(providerOf(tool), dir),
    setGuard: thenReload(async (policy: GuardPolicy) => {
      await ipc.setGuard(policy);
    }),
    refreshActivity: async (limit = 200) => activityFromEntries(await ipc.listActivity(limit)),
    runHealthCheck: async () => {
      const r = await ipc.doctor();
      return { readiness: readinessFromDoctor(r.readiness), checks: checksFromDoctor(r) };
    },
  };
}
