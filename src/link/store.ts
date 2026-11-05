/** Where switch requests live, and the CLI runner the executor moves work with. */

import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { ROOT } from "../profiles.js";
import type { Runner } from "./execute.js";
import { RequestStore } from "./requests.js";

export const REQUESTS_DIR = path.join(ROOT, "switch-requests");

export function requestStore(): RequestStore {
  return new RequestStore(REQUESTS_DIR);
}

/** Run this same agent-switch build as a child, so each move keeps every guard
 *  of its ordinary command. No TTY: interactive launches print their resume
 *  command instead, which the executor records. */
export const selfRunner: Runner = (argv) => {
  const r = spawnSync(process.execPath, [process.argv[1], ...argv], { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
};
