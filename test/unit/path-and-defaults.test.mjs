import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Api,
  DEFAULT_PERMISSION_DIRECT_MESSAGE,
  ERROR_CODES,
  Permission,
} from "../../lib/index.js";

function recordingApi() {
  const calls = [];
  const api = new Api({
    baseURL: "http://api.test",
    authentication: { bot: "placeholder" },
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return new Response("{}", { status: 200 });
    },
  });
  return { api, calls };
}

test("an id of '..' never reaches another route with the bot's token", async () => {
  const { api, calls } = recordingApi();
  for (const id of ["..", ".", "%2e%2e", "%2E%2e", "..\\x/.."]) {
    await assert.rejects(
      () =>
        api.raw(
          "delete",
          `/channels/${id}/messages/01HZZZZZZZZZZZZZZZZZZZZZZZ`,
        ),
      TypeError,
      id,
    );
  }
  await assert.rejects(() => api.raw("get", "/users/../bots/@me"), TypeError);
  assert.equal(calls.length, 0, "nothing was sent");
});

test("ordinary paths, dots inside names and query strings still pass", async () => {
  const { api, calls } = recordingApi();
  await api.raw("get", "/users/@me");
  await api.raw("get", "/invites/a.b..c");
  await api.raw(
    "get",
    "/channels/01HZZZZZZZZZZZZZZZZZZZZZZZ/messages?before=..",
  );
  await api.raw("put", "/channels/01H/messages/01J/reactions/%F0%9F%91%8D");
  assert.equal(calls.length, 4);
});

test("direct messages allow masquerade, as on the server", () => {
  assert.equal(
    DEFAULT_PERMISSION_DIRECT_MESSAGE & Permission.Masquerade,
    Permission.Masquerade,
  );
});

test("the core entry point lists the API's error types", () => {
  assert.ok(ERROR_CODES.includes("MissingPermission"));
  assert.ok(ERROR_CODES.length >= 150);
});
