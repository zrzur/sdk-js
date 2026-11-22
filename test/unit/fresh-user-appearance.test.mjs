// Bug #10 (2026-11-22): a new avatar took a long time to show for others.
// A user the client already knew kept the picture and names it first saw:
// a newer copy of the same user from the gateway (a message they send, a
// fresh Ready after a reconnect) was thrown away. That copy now brings the
// avatar and the names up to date. A copy from a REST answer may be older
// than the last UserUpdate and never undoes it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");

const avatar = (id) => ({
  _id: id,
  tag: "avatars",
  filename: "me.png",
  metadata: { type: "Image", width: 128, height: 128 },
  content_type: "image/png",
  size: 100,
});

const other = (extra = {}) => ({
  _id: OTHER,
  username: "layla",
  discriminator: "0002",
  relationship: "None",
  online: false,
  ...extra,
});

async function readyClient(users) {
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
      ...users,
    ],
    servers: [],
    channels: [],
    members: [],
    emojis: [],
  });
  return client;
}

test("a message from someone brings their new avatar", async () => {
  const client = await readyClient([other({ avatar: avatar("OLDAVATAR") })]);
  assert.equal(client.users.get(OTHER).avatar?.id, "OLDAVATAR");

  await client.events.emit("event", {
    type: "Message",
    _id: ID("M1"),
    channel: ID("C1"),
    author: OTHER,
    content: "hello",
    user: other({ avatar: avatar("NEWAVATAR"), display_name: "Layla A." }),
  });

  const user = client.users.get(OTHER);
  assert.equal(user.avatar?.id, "NEWAVATAR");
  assert.equal(user.displayName, "Layla A.");
});

test("a newer copy without an avatar or display name removes them", () => {
  return readyClient([
    other({ avatar: avatar("OLDAVATAR"), display_name: "Layla" }),
  ]).then((client) => {
    client.users.getOrCreate(OTHER, other(), true);
    const user = client.users.get(OTHER);
    assert.equal(user.avatar, undefined);
    // with no display name the username shows
    assert.equal(user.displayName, "layla");
  });
});

test("a fresh Ready after a reconnect brings the new avatar", async () => {
  const client = await readyClient([other({ avatar: avatar("OLDAVATAR") })]);
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
      other({ avatar: avatar("NEWAVATAR"), username: "layla2" }),
    ],
    servers: [],
    channels: [],
    members: [],
    emojis: [],
  });
  const user = client.users.get(OTHER);
  assert.equal(user.avatar?.id, "NEWAVATAR");
  assert.equal(user.username, "layla2");
});

test("the same picture again keeps the same object (no reload of the image)", async () => {
  const client = await readyClient([other({ avatar: avatar("SAMEAVATAR") })]);
  const before = client.users.get(OTHER).avatar;
  client.users.getOrCreate(OTHER, other({ avatar: avatar("SAMEAVATAR") }), true);
  assert.equal(client.users.get(OTHER).avatar, before);
});

test("a REST copy read before the last UserUpdate does not undo it", async () => {
  const client = await readyClient([other({ avatar: avatar("OLDAVATAR") })]);
  // the member list is asked for while the avatar still is the old one ...
  const staleCopy = other({ avatar: avatar("OLDAVATAR") });
  // ... the change arrives through the gateway ...
  await client.events.emit("event", {
    type: "UserUpdate",
    id: OTHER,
    data: { avatar: avatar("NEWAVATAR") },
    clear: [],
  });
  assert.equal(client.users.get(OTHER).avatar?.id, "NEWAVATAR");
  // ... and then the answer with the old copy comes in
  client.users.getOrCreate(OTHER, staleCopy);
  assert.equal(
    client.users.hydrateIfNotHas(OTHER, staleCopy),
    undefined,
    "a known user is not added twice",
  );
  assert.equal(client.users.get(OTHER).avatar?.id, "NEWAVATAR");
});

test("a refresh is announced as userUpdate with the values before it", async () => {
  const client = await readyClient([
    other({ avatar: avatar("OLDAVATAR"), display_name: "Layla" }),
  ]);
  const seen = [];
  client.on("userUpdate", (user, previousUser) =>
    seen.push([user.avatar?.id, user.displayName, previousUser.avatar?.id, previousUser.displayName]),
  );
  await client.events.emit("event", {
    type: "Message",
    _id: ID("M2"),
    channel: ID("C1"),
    author: OTHER,
    content: "hello",
    user: other({ avatar: avatar("NEWAVATAR"), display_name: "Layla A." }),
  });
  assert.deepEqual(seen, [["NEWAVATAR", "Layla A.", "OLDAVATAR", "Layla"]]);

  // the same look again changes nothing and announces nothing
  client.users.getOrCreate(
    OTHER,
    other({ avatar: avatar("NEWAVATAR"), display_name: "Layla A." }),
    true,
  );
  assert.equal(seen.length, 1);
});
