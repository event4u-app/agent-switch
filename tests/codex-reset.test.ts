import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { availableResetCredits, redeemResetCredit } from "../src/codex-reset.js";

// The redeem call itself would consume a real, scarce reset credit, so it is not
// exercised here — only the safe-degradation path (no token → no network call).

test("availableResetCredits / redeemResetCredit degrade safely with no auth token", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-codex-reset-"));
  try {
    assert.equal(await availableResetCredits(dir), null); // no auth.json → no network
    assert.deepEqual(await redeemResetCredit(dir), { ok: false, reason: "no token" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
