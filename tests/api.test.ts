import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyAuthStatus } from "../src/api.js";

// The pure core of the read-only login check (checkAuth). A dead login is ONLY
// a 401/403; everything else (offline, transient, API change) is "unknown" so a
// flaky network is never misreported as an expired login.
test("classifyAuthStatus: 401/403 = expired login", () => {
  assert.equal(classifyAuthStatus(401), "expired");
  assert.equal(classifyAuthStatus(403), "expired");
});

test("classifyAuthStatus: 2xx = ok", () => {
  assert.equal(classifyAuthStatus(200), "ok");
  assert.equal(classifyAuthStatus(204), "ok");
});

test("classifyAuthStatus: null (network/timeout) and other statuses = unknown, never expired", () => {
  assert.equal(classifyAuthStatus(null), "unknown");
  assert.equal(classifyAuthStatus(500), "unknown");
  assert.equal(classifyAuthStatus(429), "unknown");
  assert.equal(classifyAuthStatus(302), "unknown");
});
