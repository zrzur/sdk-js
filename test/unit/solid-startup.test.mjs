// The app client: a failing /sync/unreads must not block Ready, and threads
// never enter a server's channel list.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;

function makeClient(fetchImpl) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const client = new Client({
    baseURL: "http://localhost:1",
    syncUnreads: true,
    autoReconnect: false,
  });
  return { client, restore: () => (globalThis.fetch = realFetch) };
}

const readyEvent = {
  type: "Ready",
  users: [
    { _id: ID("AA"), username: "me", discriminator: "0001", relationship: "User" },
  ],
  servers: [
    { _id: ID("SV"), owner: ID("AA"), name: "S", channels: [ID("C1")], default_permissions: 0 },
  ],
  channels: [{ channel_type: "TextChannel", _id: ID("C1"), server: ID("SV"), name: "general" }],
  members: [],
  emojis: [],
};

test("a 429 on /sync/unreads does not block Ready and is retried later", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const { client, restore } = makeClient(async (url) => {
    if (String(url).includes("/sync/unreads")) {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ type: "TooManyRequests" }), {
          status: 429,
          headers: { "retry-after": "40" },
        });
      }
      return new Response("[]", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  try {
    let readyEmitted = false;
    client.on("ready", () => (readyEmitted = true));
    await client.events.emit("event", readyEvent);
    await new Promise((r) => setImmediate(r));
    assert.equal(client.ready(), true, "client is ready despite the 429");
    assert.equal(readyEmitted, true);
    assert.equal(calls, 1);
    t.mock.timers.tick(39_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1, "waits for Retry-After before retrying");
    t.mock.timers.tick(2_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2, "retried after Retry-After");
    t.mock.timers.tick(600_000);
    assert.equal(calls, 2, "stops after success");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("any failure on /sync/unreads still leaves the client ready", async () => {
  const { client, restore } = makeClient(async () => {
    throw new TypeError("network down");
  });
  try {
    await client.events.emit("event", readyEvent);
    assert.equal(client.ready(), true);
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("a new thread is not added to the server's channel list", async () => {
  const { client, restore } = makeClient(async () => new Response("[]", { status: 200 }));
  try {
    await client.events.emit("event", readyEvent);
    const server = client.servers.get(ID("SV"));
    assert.ok(server.channelIds.has(ID("C1")));
    await client.events.emit("event", {
      type: "ChannelCreate",
      channel_type: "TextChannel",
      _id: ID("T1"),
      server: ID("SV"),
      name: "a thread",
      parent: ID("C1"),
      thread: { starter_message: ID("M1"), archived: false },
    });
    assert.ok(client.channels.has(ID("T1")), "thread is known");
    assert.equal(server.channelIds.has(ID("T1")), false);
    await client.events.emit("event", {
      type: "ChannelCreate",
      channel_type: "TextChannel",
      _id: ID("C2"),
      server: ID("SV"),
      name: "second",
    });
    assert.ok(server.channelIds.has(ID("C2")), "normal channels still added");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

const M1 = "01ARZ3NDEKTSV4RRFFQ69G5M01";
const M2 = "01ARZ3NDEKTSV4RRFFQ69G5M02";
const withMessage = {
  ...readyEvent,
  channels: [
    { channel_type: "TextChannel", _id: ID("C1"), server: ID("SV"), name: "general", last_message_id: M2 },
  ],
};

function unreadsFetch(rows, counter = { n: 0 }) {
  return async (url) => {
    if (String(url).includes("/sync/unreads")) {
      counter.n++;
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
}

test("sync() overwrites the entry created before the answer and clears missing ones", async () => {
  const rows = [{ _id: { channel: ID("C1"), user: ID("AA") }, last_id: M2, mentions: [] }];
  const { client, restore } = makeClient(unreadsFetch(rows));
  try {
    await client.events.emit("event", withMessage);
    await new Promise((r) => setImmediate(r));
    const channel = client.channels.get(ID("C1"));
    assert.equal(client.channelUnreads.loaded, true);
    assert.equal(channel.unread, false, "a read channel is read after the sync");

    // the server now lists nothing: the entry is cleared, the channel is unread again
    rows.length = 0;
    await client.channelUnreads.sync();
    assert.equal(channel.unread, true);
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("before the first sync no channel is unread; the flag follows the sync", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { client, restore } = makeClient(async (url) => {
    if (String(url).includes("/sync/unreads")) {
      await gate;
      return new Response(JSON.stringify([{ _id: { channel: ID("C1"), user: ID("AA") }, last_id: M2, mentions: [] }]), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  try {
    await client.events.emit("event", withMessage);
    const channel = client.channels.get(ID("C1"));
    assert.equal(client.channelUnreads.loaded, false);
    assert.equal(channel.unread, false, "unknown is not unread");
    release();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(client.channelUnreads.loaded, true);
    assert.equal(channel.unread, false);
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("an ack made while the sync is in flight is not undone by the answer", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { client, restore } = makeClient(async (url) => {
    if (String(url).includes("/sync/unreads")) {
      await gate;
      return new Response(JSON.stringify([{ _id: { channel: ID("C1"), user: ID("AA") }, last_id: M1, mentions: [] }]), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  try {
    await client.events.emit("event", withMessage);
    const channel = client.channels.get(ID("C1"));
    await channel.ack(M2, false, true);
    release();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(channel.unread, false, "the newer local ack wins over the older server row");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("a late answer after cancel is ignored, and 401 stops the retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  const { client, restore } = makeClient(async (url) => {
    if (String(url).includes("/sync/unreads")) {
      calls++;
      if (calls === 1) {
        await gate;
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify({ type: "InvalidSession" }), { status: 401 });
    }
    return new Response("{}", { status: 200 });
  });
  try {
    await client.events.emit("event", withMessage);
    client.channelUnreads.cancelBackgroundSync();
    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(client.channelUnreads.loaded, false, "a cancelled answer is not applied");
    client.channelUnreads.syncInBackground();
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(600_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2, "no retry after a 401");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("leaving a server also drops its threads from client.channels", async () => {
  const { client, restore } = makeClient(async () => new Response("[]", { status: 200 }));
  try {
    await client.events.emit("event", readyEvent);
    await client.events.emit("event", {
      type: "ChannelCreate",
      channel_type: "TextChannel",
      _id: ID("T1"),
      server: ID("SV"),
      name: "a thread",
      parent: ID("C1"),
      thread: { starter_message: ID("M1"), archived: false },
    });
    assert.ok(client.channels.has(ID("T1")));
    await client.events.emit("event", { type: "ServerDelete", id: ID("SV") });
    assert.equal(client.channels.has(ID("T1")), false);
    assert.equal(client.channels.has(ID("C1")), false);
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

const M3 = "01ARZ3NDEKTSV4RRFFQ69G5M03";

test("an ack stays protected until its PUT settles, across a second sync", async () => {
  let releasePut;
  const putGate = new Promise((r) => (releasePut = r));
  let rows = [{ _id: { channel: ID("C1"), user: ID("AA") }, last_id: M1, mentions: [] }];
  const { client, restore } = makeClient(async (url, init) => {
    if (String(url).includes("/sync/unreads")) {
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (init?.method === "PUT") await putGate;
    return new Response("{}", { status: 200 });
  });
  try {
    await client.events.emit("event", withMessage);
    await new Promise((r) => setTimeout(r, 20));
    const channel = client.channels.get(ID("C1"));
    await channel.ack(M2, true); // sends the PUT at once, which waits on the gate
    // a later sync starts (and clears its own marks) while the PUT is open
    await client.channelUnreads.sync();
    assert.equal(channel.unread, false, "the old server row does not undo the ack");
    releasePut();
    await new Promise((r) => setTimeout(r, 20));
    // PUT settled: the server's word counts again
    await client.channelUnreads.sync();
    assert.equal(channel.unread, true, "after the PUT settled the server row wins");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("a mention newer than a local ack survives the sync merge", async () => {
  let gate = Promise.resolve();
  const { client, restore } = makeClient(async (url) => {
    if (String(url).includes("/sync/unreads")) {
      await gate;
      return new Response(
        JSON.stringify([{ _id: { channel: ID("C1"), user: ID("AA") }, last_id: M1, mentions: [M3, M1] }]),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });
  try {
    await client.events.emit("event", withMessage);
    await new Promise((r) => setTimeout(r, 20));
    const channel = client.channels.get(ID("C1"));
    let release;
    gate = new Promise((r) => (release = r));
    const syncing = client.channelUnreads.sync();
    await channel.ack(M2, false, true); // while the answer is on its way
    release();
    await syncing;
    const unread = client.channelUnreads.get(ID("C1"));
    assert.equal(unread.lastMessageId, M2, "the ack mark stays");
    assert.deepEqual([...unread.messageMentionIds], [M3], "only the mention after the ack remains");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("marking a whole server read is held until its request settles", async () => {
  let releasePut;
  const putGate = new Promise((r) => (releasePut = r));
  const rows = [{ _id: { channel: ID("C1"), user: ID("AA") }, last_id: M1, mentions: [] }];
  const { client, restore } = makeClient(async (url, init) => {
    if (String(url).includes("/sync/unreads")) {
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (init?.method === "PUT") await putGate;
    return new Response("{}", { status: 200 });
  });
  try {
    await client.events.emit("event", withMessage);
    await new Promise((r) => setTimeout(r, 20));
    const channel = client.channels.get(ID("C1"));
    const acking = client.servers.get(ID("SV")).ack();
    await client.channelUnreads.sync();
    assert.equal(channel.unread, false, "the old server row does not undo the ack");
    releasePut();
    await acking;
    await client.channelUnreads.sync();
    assert.equal(channel.unread, true, "after the request settled the server row counts again");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});

test("an ack whose PUT settles while a sync is in flight is not undone by that sync", async () => {
  let releasePut, releaseSync;
  const putGate = new Promise((r) => (releasePut = r));
  const syncGate = new Promise((r) => (releaseSync = r));
  let gateSync = false;
  const rows = [{ _id: { channel: ID("C1"), user: ID("AA") }, last_id: M1, mentions: [] }];
  const { client, restore } = makeClient(async (url, init) => {
    if (String(url).includes("/sync/unreads")) {
      if (gateSync) await syncGate;
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (init?.method === "PUT") await putGate;
    return new Response("{}", { status: 200 });
  });
  try {
    await client.events.emit("event", withMessage);
    await new Promise((r) => setTimeout(r, 20));
    const channel = client.channels.get(ID("C1"));
    await channel.ack(M2, true); // PUT waits
    gateSync = true;
    const syncing = client.channelUnreads.sync(); // asked before the server has the ack
    releasePut(); // the PUT settles first ...
    await new Promise((r) => setTimeout(r, 20));
    releaseSync(); // ... then the older answer arrives
    await syncing;
    assert.equal(channel.unread, false, "the answer that was asked before the ack is dropped");
  } finally {
    client.channelUnreads.cancelBackgroundSync();
    restore();
  }
});
