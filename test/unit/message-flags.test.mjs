// Message flags are bit positions on the server (MessageFlags in
// revolt-models): bit 1 = silent (2), bit 2 = @everyone (4),
// bit 3 = @here (8). The app reads and sends them the same way.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const C1 = ID("C1");

async function readyClient() {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ method: init?.method ?? "GET", url: String(url), body: init?.body });
    return new Response(
      JSON.stringify({ _id: ID("M9"), channel: C1, author: ME, content: "hi" }),
      { status: 200 },
    );
  };
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
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

const ids = { silent: ID("M1"), everyone: ID("M2"), here: ID("M3"), plain: ID("M4") };

async function withMessages(fn) {
  const { client, requests, restore } = await readyClient();
  try {
    for (const [key, flags] of [["silent", 2], ["everyone", 4], ["here", 8], ["plain", 0]]) {
      await client.events.emit("event", {
        type: "Message",
        _id: ids[key],
        channel: C1,
        author: OTHER,
        content: key,
        flags,
      });
    }
    await fn(client, requests);
  } finally {
    restore();
  }
}

test("@everyone and @here mention the reader; a silent message does not", async () => {
  await withMessages((client) => {
    assert.equal(client.messages.get(ids.everyone).mentioned, true, "@everyone");
    assert.equal(client.messages.get(ids.here).mentioned, true, "@here");
    assert.equal(client.messages.get(ids.silent).mentioned, false, "silent");
    assert.equal(client.messages.get(ids.plain).mentioned, false, "plain");
  });
});

test("mentionsEveryone and mentionsOnline read their own bit", async () => {
  await withMessages((client) => {
    assert.equal(client.messages.get(ids.everyone).mentionsEveryone, true);
    assert.equal(client.messages.get(ids.everyone).mentionsOnline, false);
    assert.equal(client.messages.get(ids.here).mentionsOnline, true);
    assert.equal(client.messages.get(ids.here).mentionsEveryone, false);
  });
});

test("isSuppressed reads the silent bit", async () => {
  await withMessages((client) => {
    assert.equal(client.messages.get(ids.silent).isSuppressed, true);
    assert.equal(client.messages.get(ids.everyone).isSuppressed, false);
  });
});

test("@silent sends the silent bit the server reads", async () => {
  await withMessages(async (client, requests) => {
    await client.channels.get(C1).sendMessage("@silent hello");
    const post = requests.find((r) => r.method === "POST");
    const body = JSON.parse(post.body);
    assert.equal(body.content, "hello");
    assert.equal(body.flags, 2);
  });
});
