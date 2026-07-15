import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  appendNotification,
  clearNotifications,
  readNotifications,
  DEDUP_WINDOW_MS,
  MAX_NOTIFICATIONS,
} from "../src/notifications.js";

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-notif-"));
  return path.join(dir, "notifications.json");
}

test("readNotifications returns [] for a missing/malformed file (never throws)", () => {
  const f = tmpFile();
  assert.deepEqual(readNotifications(f), []);
  fs.writeFileSync(f, "{ not json");
  assert.deepEqual(readNotifications(f), []);
});

test("appendNotification stores newest-last with an id + timestamp", () => {
  const f = tmpFile();
  const a = appendNotification({ kind: "success", title: "A", message: "first" }, 1000, f);
  const b = appendNotification({ kind: "error", title: "B", message: "second" }, 2000, f);
  assert.ok(a && b);
  const list = readNotifications(f);
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "A");
  assert.equal(list[1].title, "B");
  assert.equal(list[1].ts, 2000);
  assert.notEqual(list[0].id, list[1].id);
});

test("appendNotification deduplicates an identical event within the window", () => {
  const f = tmpFile();
  const first = appendNotification({ kind: "warning", title: "T", message: "same" }, 1000, f);
  const dup = appendNotification({ kind: "warning", title: "T", message: "same" }, 1000 + DEDUP_WINDOW_MS - 1, f);
  assert.ok(first);
  assert.equal(dup, null); // deduped
  assert.equal(readNotifications(f).length, 1);
});

test("appendNotification re-appends an identical event after the dedup window", () => {
  const f = tmpFile();
  appendNotification({ kind: "warning", title: "T", message: "same" }, 1000, f);
  const later = appendNotification({ kind: "warning", title: "T", message: "same" }, 1000 + DEDUP_WINDOW_MS + 1, f);
  assert.ok(later);
  assert.equal(readNotifications(f).length, 2);
});

test("a different event is never deduped even within the window", () => {
  const f = tmpFile();
  appendNotification({ kind: "warning", title: "T", message: "same" }, 1000, f);
  const other = appendNotification({ kind: "warning", title: "T", message: "different" }, 1001, f);
  assert.ok(other);
  assert.equal(readNotifications(f).length, 2);
});

test("the log is capped at MAX_NOTIFICATIONS (oldest dropped)", () => {
  const f = tmpFile();
  for (let i = 0; i < MAX_NOTIFICATIONS + 10; i++) {
    appendNotification({ kind: "info", title: `n${i}`, message: `m${i}` }, 1000 + i, f);
  }
  const list = readNotifications(f);
  assert.equal(list.length, MAX_NOTIFICATIONS);
  // oldest surviving is n10, newest is the last appended
  assert.equal(list[0].title, "n10");
  assert.equal(list[list.length - 1].title, `n${MAX_NOTIFICATIONS + 9}`);
});

test("clearNotifications empties the log", () => {
  const f = tmpFile();
  appendNotification({ kind: "info", title: "x", message: "y" }, 1000, f);
  clearNotifications(f);
  assert.deepEqual(readNotifications(f), []);
});
