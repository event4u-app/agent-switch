import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-locking-"));
process.env.AGENT_SWITCH_HOME = HOME;
const PO = await import("../src/pools.js");
const PR = await import("../src/protection.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const poolsUrl = pathToFileURL(path.join(here, "../src/pools.js")).href;
const protUrl = pathToFileURL(path.join(here, "../src/protection.js")).href;

/** N processes write at once; every write must survive. */
async function race(n: number, body: (i: number) => string): Promise<void> {
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      new Promise<void>((resolve, reject) => {
        const p = spawn(process.execPath, ["--input-type=module", "-e", body(i)], { env: { ...process.env, AGENT_SWITCH_HOME: HOME }, stdio: "inherit" });
        p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`child ${i} exited ${c}`))));
      }),
    ),
  );
}

test("pools: concurrent member adds from separate processes lose no member", async () => {
  const file = path.join(HOME, "pools-race.json");
  const pool = PO.createPool("Race", file);
  await race(8, (i) => `const P = await import(${JSON.stringify(poolsUrl)}); for (let k = 0; k < 5; k++) P.addPoolMember(${JSON.stringify(pool.id)}, "claude/m${i}x" + k, ${JSON.stringify(file)});`);
  assert.equal(PO.findPool(pool.id, file)!.members.length, 40);
});

test("protection: concurrent per-profile writes from separate processes lose no profile", async () => {
  const file = path.join(HOME, "protection-race.json");
  await race(8, (i) => `const P = await import(${JSON.stringify(protUrl)}); for (let k = 0; k < 5; k++) P.setProtection("claude", "p${i}x" + k, { thresholdPct: 90 }, ${JSON.stringify(file)});`);
  for (let i = 0; i < 8; i++) for (let k = 0; k < 5; k++) assert.equal(PR.readProtection("claude", `p${i}x${k}`, file).thresholdPct, 90);
});

const profilesUrl = pathToFileURL(path.join(here, "../src/profiles.js")).href;

test("state: concurrent label and disabled writes from separate processes lose nothing", async () => {
  for (let i = 0; i < 8; i++) fs.mkdirSync(path.join(HOME, "claude", `s${i}`, "config"), { recursive: true });
  await race(8, (i) => `const P = await import(${JSON.stringify(profilesUrl)}); for (let k = 0; k < 3; k++) { P.setLabel("claude", "s${i}", "Work"); P.setDisabled("claude", "s${i}", true); }`);
  const PF = await import("../src/profiles.js");
  for (let i = 0; i < 8; i++) {
    assert.equal(PF.labelFor("claude", `s${i}`), "Work", `label of s${i}`);
    assert.equal(PF.isDisabled("claude", `s${i}`), true, `disabled s${i}`);
  }
});
