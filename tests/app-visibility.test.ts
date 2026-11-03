import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appHidden, visibilityFile, writeVisibility, VISIBILITY_TTL_MS } from "../src/app-visibility.js";

test("appHidden: only a recent 'hidden' from the app pauses; no app, 'visible' or a stale report do not", () => {
  const f = visibilityFile(fs.mkdtempSync(path.join(os.tmpdir(), "asw-vis-")));
  const t = new Date("2026-11-02T10:00:00Z");
  assert.equal(appHidden(f, t.getTime()), false, "no app");
  writeVisibility(f, false, t);
  assert.equal(appHidden(f, t.getTime() + 60_000), true);
  assert.equal(appHidden(f, t.getTime() + VISIBILITY_TTL_MS + 1), false, "the app may have crashed hidden");
  writeVisibility(f, true, t);
  assert.equal(appHidden(f, t.getTime() + 60_000), false);
  if (process.platform !== "win32") assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});
