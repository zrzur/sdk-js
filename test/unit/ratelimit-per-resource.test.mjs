// The server keeps one messaging bucket per channel. A channel that used up
// its bucket must not make the client wait before sending to another one.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Api } from "../../lib/index.js";

const A = "01JCHANNE1000000000000000A";
const B = "01JCHANNE1000000000000000B";

function api() {
  const sent = [];
  const client = new Api({
    baseURL: "https://api.example",
    authentication: { bot: "placeholder" },
    fetch: async (url) => {
      const channel = String(url).includes(A) ? "A" : "B";
      sent.push({ channel, at: Date.now() });
      return new Response("{}", {
        status: 200,
        headers: {
          "x-ratelimit-bucket": `bucket-${channel}`,
          // channel A is used up for 400 ms, channel B has room
          "x-ratelimit-remaining": channel === "A" ? "0" : "5",
          "x-ratelimit-reset-after": "400",
        },
      });
    },
  });
  return { client, sent };
}

test("a used-up channel does not hold back another channel", async () => {
  const { client, sent } = api();
  await client.post(`/channels/${A}/messages`, { content: "1" });
  await client.post(`/channels/${B}/messages`, { content: "1" });
  const started = Date.now();
  await client.post(`/channels/${B}/messages`, { content: "2" });
  assert.ok(Date.now() - started < 200, "channel B was sent at once");
  assert.equal(sent.length, 3);
});

test("the used-up channel itself waits for its bucket", async () => {
  const { client } = api();
  await client.post(`/channels/${A}/messages`, { content: "1" });
  const started = Date.now();
  await client.post(`/channels/${A}/messages`, { content: "2" });
  assert.ok(Date.now() - started >= 380, "channel A waited for the reset");
});
