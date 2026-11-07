import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERMISSION_SERVER,
  Permission,
  THREAD_PERMISSIONS,
} from "../../lib/index.js";

test("the thread permissions are the backend's bits", () => {
  assert.equal(Permission.CreateThreads, 1n << 43n);
  assert.equal(Permission.SendMessageInThreads, 1n << 44n);
  assert.equal(Permission.CreateForumPosts, 1n << 45n);
});

test("a new server starts with threads and forums open", () => {
  assert.equal(DEFAULT_PERMISSION_SERVER & THREAD_PERMISSIONS, THREAD_PERMISSIONS);
});
