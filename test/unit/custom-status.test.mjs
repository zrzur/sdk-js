// Custom status with emoji and expiry: the emoji and the expiry travel with
// the text, clearing the text clears them, and a status past its expiry is
// never shown even before the server's clear reaches this client.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");

const inMinutes = (minutes) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

async function readyClient(otherStatus) {
  const client = new Client({
    baseURL: "http://localhost:1",
    autoReconnect: false,
  });
  await client.events.emit("event", {
    type: "Ready",
    users: [
      {
        _id: ME,
        username: "me",
        discriminator: "0001",
        relationship: "User",
        online: true,
      },
      {
        _id: OTHER,
        username: "other",
        discriminator: "0002",
        relationship: "Friend",
        online: true,
        status: otherStatus,
      },
    ],
    servers: [],
    channels: [],
    members: [],
    emojis: [],
  });
  return client;
}

test("a status keeps its emoji and expiry and shows the emoji", async () => {
  const client = await readyClient({
    text: "At lunch",
    emoji: "🍕",
    expires_at: inMinutes(30),
  });
  const other = client.users.get(OTHER);
  assert.equal(other.statusMessage(), "At lunch");
  assert.equal(other.statusEmoji, "🍕");
  assert.ok(other.statusExpiresAt instanceof Date);
});

test("a gateway update brings the emoji and expiry", async () => {
  const client = await readyClient(undefined);
  await client.events.emit("event", {
    type: "UserUpdate",
    id: OTHER,
    data: { status: { text: "Away", emoji: "🌙", expires_at: inMinutes(60) } },
    clear: [],
  });
  const other = client.users.get(OTHER);
  assert.equal(other.statusMessage(), "Away");
  assert.equal(other.statusEmoji, "🌙");
});

test("clearing the status text clears its emoji and expiry too", async () => {
  const client = await readyClient({
    text: "Away",
    emoji: "🌙",
    expires_at: inMinutes(60),
    presence: "Idle",
  });
  await client.events.emit("event", {
    type: "UserUpdate",
    id: OTHER,
    data: {},
    clear: ["StatusText"],
  });
  const other = client.users.get(OTHER);
  assert.equal(other.status?.text, undefined);
  assert.equal(other.statusEmoji, undefined);
  assert.equal(other.statusExpiresAt, undefined);
  assert.equal(other.status?.presence, "Idle");
});

test("a status past its expiry is not shown", async () => {
  const client = await readyClient({
    text: "Old news",
    emoji: "📰",
    expires_at: inMinutes(-1),
  });
  const other = client.users.get(OTHER);
  assert.equal(other.statusMessage(), undefined);
  assert.equal(other.statusEmoji, undefined);
  assert.equal(other.statusExpiresAt, undefined);
});

test("an emoji-only status shows the emoji with no text", async () => {
  const client = await readyClient({ emoji: "🎧" });
  const other = client.users.get(OTHER);
  assert.equal(other.statusEmoji, "🎧");
  assert.equal(other.statusMessage(), undefined);
});

test("an emoji-only status (new emoji and StatusText clear in one event) keeps the emoji", async () => {
  const client = await readyClient({
    text: "Old text",
    emoji: "🌙",
    presence: "Idle",
  });
  await client.events.emit("event", {
    type: "UserUpdate",
    id: OTHER,
    data: { status: { emoji: "🎧", presence: "Idle" } },
    clear: ["StatusText"],
  });
  const other = client.users.get(OTHER);
  assert.equal(other.status?.text, undefined);
  assert.equal(other.statusEmoji, "🎧");
  assert.equal(other.status?.presence, "Idle");
});

for (const clear of [
  ["StatusText", "StatusPresence"],
  ["StatusPresence", "StatusText"],
]) {
  test(`both clears (${clear.join(", ")}) and a new emoji in one event`, async () => {
    const client = await readyClient({
      text: "Old",
      emoji: "🌙",
      expires_at: inMinutes(30),
      presence: "Busy",
    });
    await client.events.emit("event", {
      type: "UserUpdate",
      id: OTHER,
      data: { status: { emoji: "🎧" } },
      clear,
    });
    const other = client.users.get(OTHER);
    assert.equal(other.status?.text, undefined);
    assert.equal(other.status?.expires_at, undefined);
    assert.equal(other.status?.presence, undefined);
    assert.equal(other.statusEmoji, "🎧");
  });
}

test("a clear with no new data keeps what was not cleared", async () => {
  const client = await readyClient({
    text: "Old",
    emoji: "🌙",
    presence: "Busy",
  });
  await client.events.emit("event", {
    type: "UserUpdate",
    id: OTHER,
    data: {},
    clear: ["StatusPresence"],
  });
  const other = client.users.get(OTHER);
  assert.equal(other.status?.text, "Old");
  assert.equal(other.statusEmoji, "🌙");
  assert.equal(other.status?.presence, undefined);
});
