// Forwarding: Message.forward posts to the forward route with the original's
// channel and id, and the copy's `forwarded` origin is read into the message.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const C1 = ID("C1");
const C2 = ID("C2");
const M1 = "01ARZ3NDEKTSV4RRFFQ69G5M01";
const M2 = "01ARZ3NDEKTSV4RRFFQ69G5M02";

const readyEvent = {
  type: "Ready",
  users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
  servers: [{ _id: ID("SV"), owner: ME, name: "S", channels: [C1, C2], default_permissions: 0 }],
  channels: [
    { channel_type: "TextChannel", _id: C1, server: ID("SV"), name: "general" },
    { channel_type: "TextChannel", _id: C2, server: ID("SV"), name: "news" },
  ],
  members: [],
  emojis: [],
};

const origin = {
  channel: C1,
  server: ID("SV"),
  message: M1,
  sent_at: "2026-11-09T12:00:00.000Z",
  note: "look",
};

test("forward posts the original's channel, id and note, and reads the origin", async () => {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ method: init?.method ?? "GET", url: String(url), init });
    if (String(url).endsWith("/messages/forward")) {
      return new Response(
        JSON.stringify({ _id: M2, channel: C2, author: ME, content: "hi", forwarded: origin }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
    await client.events.emit("event", readyEvent);
    await client.events.emit("event", {
      type: "Message",
      _id: M1,
      channel: C1,
      author: ME,
      content: "hi",
    });
    const original = client.messages.get(M1);
    assert.equal(original.forwarded, undefined);

    const copy = await original.forward(client.channels.get(C2), "  look  ", "key-1");

    const sent = requests.find((r) => r.url.endsWith("/messages/forward"));
    assert.ok(sent, "the forward route was called");
    assert.equal(sent.method, "POST");
    assert.ok(sent.url.endsWith(`/channels/${C2}/messages/forward`));
    assert.deepEqual(JSON.parse(sent.init.body), { channel: C1, message: M1, note: "look" });
    assert.equal(new Headers(sent.init.headers).get("Idempotency-Key"), "key-1");

    assert.equal(copy.id, M2);
    assert.deepEqual(copy.forwarded, origin);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an empty note is left out", async () => {
  const realFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/messages/forward")) {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ _id: M2, channel: C2, author: ME }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
    await client.events.emit("event", readyEvent);
    await client.events.emit("event", { type: "Message", _id: M1, channel: C1, author: ME, content: "x" });
    await client.messages.get(M1).forward(C2, "   ");
    assert.deepEqual(body, { channel: C1, message: M1 });
  } finally {
    globalThis.fetch = realFetch;
  }
});
