// Category settings: the edit request, the note on a category, and a
// category list that changes with a ServerUpdate.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const S1 = ID("S1");
const TEAM = { id: "team", title: "Team", channels: [], description: "For the moderation team", default_permissions: { a: 0, d: 1048576 } };
const OPEN = { id: "open", title: "Open", channels: [] };

async function readyClient() {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ method: init?.method ?? "GET", url: String(url), body: init?.body });
    return new Response(
      JSON.stringify({ _id: S1, owner: ME, name: "A", channels: [], default_permissions: 0, categories: [TEAM, OPEN] }),
      { status: 200 },
    );
  };
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
    servers: [{ _id: S1, owner: ME, name: "A", channels: [], default_permissions: 0, categories: [TEAM, OPEN] }],
    channels: [],
    members: [],
    emojis: [],
  });
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

test("editCategory sends the title and note to the category's own route", async () => {
  const { client, requests, restore } = await readyClient();
  try {
    await client.servers.get(S1).editCategory("team", { title: "Staff", description: "" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method.toUpperCase(), "PATCH");
    assert.equal(requests[0].url, `http://localhost:1/servers/${S1}/categories/team`);
    assert.deepEqual(JSON.parse(requests[0].body), { title: "Staff", description: "" });
  } finally {
    restore();
  }
});

test("a category carries its note", async () => {
  const { client, restore } = await readyClient();
  try {
    const categories = client.servers.get(S1).categories;
    assert.equal(categories[0].description, "For the moderation team");
    assert.equal(categories[1].description, undefined);
  } finally {
    restore();
  }
});

test("a ServerUpdate without a private category takes it out of the list", async () => {
  const { client, restore } = await readyClient();
  try {
    await client.events.emit("event", { type: "ServerUpdate", id: S1, data: { categories: [OPEN] }, clear: [] });
    assert.deepEqual(client.servers.get(S1).categories.map((c) => c.id), ["open"]);
    await client.events.emit("event", { type: "ServerUpdate", id: S1, data: { categories: [TEAM, OPEN] }, clear: [] });
    assert.deepEqual(client.servers.get(S1).categories.map((c) => c.id), ["team", "open"]);
  } finally {
    restore();
  }
});
