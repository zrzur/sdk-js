// Unread state and the account's own messages: a message this account sent
// (here or on another device) never makes a channel unread or adds a mention,
// and an ack made on another device clears the channel here too.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const C1 = ID("C1");
const M1 = "01ARZ3NDEKTSV4RRFFQ69G5M01";
const M2 = "01ARZ3NDEKTSV4RRFFQ69G5M02";
const M3 = "01ARZ3NDEKTSV4RRFFQ69G5M03";
const M4 = "01ARZ3NDEKTSV4RRFFQ69G5M04";

const readyEvent = {
  type: "Ready",
  users: [
    { _id: ME, username: "me", discriminator: "0001", relationship: "User" },
    { _id: OTHER, username: "other", discriminator: "0002", relationship: "None" },
  ],
  servers: [
    { _id: ID("SV"), owner: ME, name: "S", channels: [C1], default_permissions: 0 },
  ],
  channels: [
    { channel_type: "TextChannel", _id: C1, server: ID("SV"), name: "general", last_message_id: M1 },
  ],
  members: [],
  emojis: [],
};

/** A client that has synced: the channel is read up to M1 */
async function readyClient() {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (String(url).includes("/sync/unreads")) {
      return new Response(
        JSON.stringify([{ _id: { channel: C1, user: ME }, last_id: M1, mentions: [] }]),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  };
  const client = new Client({ baseURL: "http://localhost:1", syncUnreads: true, autoReconnect: false });
  await client.events.emit("event", readyEvent);
  await new Promise((r) => setTimeout(r, 10));
  return {
    client,
    requests,
    restore: () => {
      client.channelUnreads.cancelBackgroundSync();
      globalThis.fetch = realFetch;
    },
  };
}

const message = (id, author, extra = {}) => ({
  type: "Message",
  _id: id,
  channel: C1,
  author,
  content: "hi",
  ...extra,
});

test("the account's own message does not make the channel unread", async () => {
  const { client, requests, restore } = await readyClient();
  try {
    const channel = client.channels.get(C1);
    assert.equal(channel.unread, false, "read before");
    await client.events.emit("event", message(M2, ME));
    assert.equal(channel.lastMessageId, M2);
    assert.equal(channel.unread, false, "own message is read");
    assert.equal(client.channelUnreads.get(C1).lastMessageId, M2);
    assert.ok(
      !requests.some((r) => r.startsWith("PUT") && r.includes("/ack/")),
      "the server marks it read itself: no ack request",
    );
  } finally {
    restore();
  }
});

test("someone else's message still makes the channel unread", async () => {
  const { client, restore } = await readyClient();
  try {
    const channel = client.channels.get(C1);
    await client.events.emit("event", message(M2, OTHER));
    assert.equal(channel.unread, true);
  } finally {
    restore();
  }
});

test("the account's own message never counts as a mention of itself", async () => {
  const { client, restore } = await readyClient();
  try {
    const channel = client.channels.get(C1);
    await client.events.emit("event", message(M2, ME, { mentions: [ME] }));
    assert.equal(channel.mentions?.size ?? 0, 0, "no self mention");
    assert.equal(channel.unread, false);
  } finally {
    restore();
  }
});

test("sending after unread messages from others marks them read, as the server does", async () => {
  const { client, restore } = await readyClient();
  try {
    const channel = client.channels.get(C1);
    await client.events.emit("event", message(M2, OTHER, { mentions: [ME] }));
    assert.equal(channel.unread, true);
    await client.events.emit("event", message(M3, ME));
    assert.equal(channel.unread, false);
    assert.equal(channel.mentions?.size ?? 0, 0);
  } finally {
    restore();
  }
});

test("an ack from another device clears the channel here, keeping newer mentions", async () => {
  const { client, restore } = await readyClient();
  try {
    const channel = client.channels.get(C1);
    await client.events.emit("event", message(M2, OTHER, { mentions: [ME] }));
    await client.events.emit("event", message(M3, OTHER, { mentions: [ME] }));
    assert.equal(channel.mentions.size, 2);

    // the other device read up to M2
    await client.events.emit("event", { type: "ChannelAck", id: C1, user: ME, message_id: M2 });
    assert.equal(client.channelUnreads.get(C1).lastMessageId, M2);
    assert.deepEqual([...channel.mentions], [M3], "the newer mention stays");
    assert.equal(channel.unread, true, "M3 is still new");

    // and then up to the end
    await client.events.emit("event", { type: "ChannelAck", id: C1, user: ME, message_id: M3 });
    assert.equal(channel.unread, false);
    assert.equal(channel.mentions.size, 0);
  } finally {
    restore();
  }
});

test("a stale server read mark does not make a channel ending in an own message unread", async () => {
  const { client, restore } = await readyClient();
  try {
    const channel = client.channels.get(C1);
    // the newest message is mine, but the server row still says M1 (an old
    // row from before the server acked own messages)
    client.messages.getOrCreate(M3, { _id: M3, channel: C1, author: ME, content: "mine" }, false);
    client.channels.updateUnderlyingObject(C1, "lastMessageId", M3);
    assert.equal(client.channelUnreads.get(C1).lastMessageId, M1);
    assert.equal(channel.unread, false);
  } finally {
    restore();
  }
});

test("an older ack from another device does not move the read point back", async () => {
  const { client, restore } = await readyClient();
  try {
    const channel = client.channels.get(C1);
    await client.events.emit("event", message(M4, ME));
    await client.events.emit("event", { type: "ChannelAck", id: C1, user: ME, message_id: M2 });
    assert.equal(client.channelUnreads.get(C1).lastMessageId, M4);
    assert.equal(channel.unread, false);
  } finally {
    restore();
  }
});
