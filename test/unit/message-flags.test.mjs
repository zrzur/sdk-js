// Message flags are bit positions on the server (MessageFlags in
// crates/core/models): 1 << 1 silent, 1 << 2 @everyone, 1 << 3 @here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const C1 = ID("C1");

async function client() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [
      { _id: ME, username: "me", discriminator: "0001", relationship: "User" },
      { _id: OTHER, username: "other", discriminator: "0002", relationship: "None" },
    ],
    servers: [{ _id: ID("SV"), owner: OTHER, name: "S", channels: [C1], default_permissions: 0 }],
    channels: [{ channel_type: "TextChannel", _id: C1, server: ID("SV"), name: "general" }],
    members: [],
    emojis: [],
  });
  return { client, restore: () => (globalThis.fetch = realFetch) };
}

test("a silent message does not count as a mention; @everyone and @here do", async () => {
  const { client: c, restore } = await client();
  try {
    const message = (n, flags) => {
      const id = `01ARZ3NDEKTSV4RRFFQ69G5M0${n}`;
      c.events.emit("event", { type: "Message", _id: id, channel: C1, author: OTHER, content: "hi", flags });
      return c.messages.get(id);
    };
    assert.equal(message(1, 1 << 1).mentioned, false, "silent");
    assert.equal(message(2, 1 << 2).mentioned, true, "@everyone");
    assert.equal(message(3, 1 << 3).mentioned, true, "@here");
    assert.equal(message(4, 0).mentioned, false, "plain");
  } finally {
    restore();
  }
});
