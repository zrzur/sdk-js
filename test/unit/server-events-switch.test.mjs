// Per-server events switch: off unless the server says so, updated by
// ServerUpdate, and sent in a server edit.
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
      JSON.stringify({ _id: S1, owner: ME, name: "A", channels: [], default_permissions: 0, events_enabled: true }),
      { status: 200 },
    );
  };
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
    servers: [
      { _id: S1, owner: ME, name: "A", channels: [], default_permissions: 0 },
      { _id: S2, owner: ME, name: "B", channels: [], default_permissions: 0, events_enabled: true },
    ],
    channels: [],
    members: [],
    emojis: [],
  });
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

test("a server without the field has events off, one with it on", async () => {
  const { client, restore } = await readyClient();
  try {
    assert.equal(client.servers.get(S1).eventsEnabled, false);
    assert.equal(client.servers.get(S2).eventsEnabled, true);
  } finally {
    restore();
  }
});

test("a server update turns events on and off again", async () => {
  const { client, restore } = await readyClient();
  try {
    const update = (on) =>
      client.events.emit("event", { type: "ServerUpdate", id: S1, data: { events_enabled: on }, clear: [] });
    await update(true);
    assert.equal(client.servers.get(S1).eventsEnabled, true);
    await update(false);
    assert.equal(client.servers.get(S1).eventsEnabled, false);
  } finally {
    restore();
  }
});

test("setEventsEnabled sends the switch in a server edit", async () => {
  const { client, requests, restore } = await readyClient();
  try {
    await client.servers.get(S1).setEventsEnabled(true);
    const edit = requests.find((r) => r.method === "PATCH");
    assert.ok(edit, "a PATCH was sent");
    assert.match(edit.url, new RegExp(`/servers/${S1}$`));
    assert.deepEqual(JSON.parse(edit.body), { events_enabled: true });
    assert.equal(client.servers.get(S1).eventsEnabled, true);
  } finally {
    restore();
  }
});
