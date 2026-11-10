// Server default notification level: read from Ready, updated by
// ServerUpdate, and sent by `setDefaultNotifications`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const S1 = ID("S1");
const S2 = ID("S2");

async function readyClient() {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ method: init?.method ?? "GET", url: String(url), body: init?.body });
    return new Response(
      JSON.stringify({ _id: S1, owner: ME, name: "A", channels: [], default_permissions: 0, default_notifications: "All" }),
      { status: 200 },
    );
  };
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
    servers: [
      { _id: S1, owner: ME, name: "A", channels: [], default_permissions: 0 },
      { _id: S2, owner: ME, name: "B", channels: [], default_permissions: 0, default_notifications: "All" },
    ],
    channels: [],
    members: [],
    emojis: [],
  });
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

test("a server without a default reads as undefined, one with it reads its level", async () => {
  const { client, restore } = await readyClient();
  try {
    assert.equal(client.servers.get(S1).defaultNotifications, undefined);
    assert.equal(client.servers.get(S2).defaultNotifications, "All");
  } finally {
    restore();
  }
});

test("a server update changes the default", async () => {
  const { client, restore } = await readyClient();
  try {
    await client.events.emit("event", {
      type: "ServerUpdate",
      id: S1,
      data: { default_notifications: "Mentions" },
      clear: [],
    });
    assert.equal(client.servers.get(S1).defaultNotifications, "Mentions");
  } finally {
    restore();
  }
});

test("setDefaultNotifications sends the level in a server edit", async () => {
  const { client, requests, restore } = await readyClient();
  try {
    await client.servers.get(S1).setDefaultNotifications("All");
    const edit = requests.find((r) => r.method === "PATCH");
    assert.ok(edit, "a PATCH was sent");
    assert.match(edit.url, new RegExp(`/servers/${S1}$`));
    assert.deepEqual(JSON.parse(edit.body), { default_notifications: "All" });
    assert.equal(client.servers.get(S1).defaultNotifications, "All");
  } finally {
    restore();
  }
});
