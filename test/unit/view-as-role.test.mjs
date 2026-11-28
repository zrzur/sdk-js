// "View server as role": the owner sees one server as members with the
// chosen roles see it, and goes back to their own view.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Client,
  Permission,
  stopViewingAs,
  viewServerAs,
  viewingAs,
} from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const S1 = ID("S1");
const S2 = ID("S2");
const STAFF_ONLY = ID("C1");
const GENERAL = ID("C2");
const RULES = ID("C3");
const MOD = "mod";
const ADMIN = "admin";

const VIEW = Number(Permission.ViewChannel);
const SEND = Number(Permission.SendMessage);
const READ = Number(Permission.ReadMessageHistory);
const KICK = Number(Permission.KickMembers);

async function readyClient() {
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  const server = (id) => ({
    _id: id,
    owner: ME,
    name: "A",
    channels: id === S1 ? [STAFF_ONLY, GENERAL, RULES] : [],
    default_permissions: VIEW | SEND | READ,
    roles: {
      [MOD]: { name: "Moderator", rank: 2, permissions: { a: KICK, d: 0 } },
      [ADMIN]: { name: "Admin", rank: 1, permissions: { a: Number(Permission.Administrator), d: 0 } },
    },
  });
  const text = (id, extra) => ({ _id: id, channel_type: "TextChannel", server: S1, name: id, ...extra });
  await client.events.emit("event", {
    type: "Ready",
    users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
    servers: [server(S1), server(S2)],
    channels: [
      // hidden from @everyone, open to moderators
      text(STAFF_ONLY, { default_permissions: { a: 0, d: VIEW }, role_permissions: { [MOD]: { a: VIEW, d: 0 } } }),
      text(GENERAL),
      // nobody but the staff writes here
      text(RULES, { default_permissions: { a: 0, d: SEND } }),
    ],
    members: [{ _id: { server: S1, user: ME }, roles: [], joined_at: new Date().toISOString() }],
    emojis: [],
  });
  return client;
}

const can = (channel, permission) => channel.havePermission(permission);

test("the owner sees every channel until they view the server as a role", async () => {
  const client = await readyClient();
  try {
    const staff = client.channels.get(STAFF_ONLY);
    assert.equal(can(staff, "ViewChannel"), true);

    // as @everyone: no staff channel, no writing in the rules, no kicking
    viewServerAs(S1, []);
    assert.equal(can(staff, "ViewChannel"), false);
    assert.equal(can(client.channels.get(GENERAL), "SendMessage"), true);
    assert.equal(can(client.channels.get(RULES), "SendMessage"), false);
    assert.equal(client.servers.get(S1).havePermission("KickMembers"), false);

    // as a moderator: the staff channel opens and kicking is allowed
    viewServerAs(S1, [MOD]);
    assert.equal(can(staff, "ViewChannel"), true);
    assert.equal(client.servers.get(S1).havePermission("KickMembers"), true);
    assert.equal(can(client.channels.get(RULES), "SendMessage"), false);

    // an administrator role has every right
    viewServerAs(S1, [ADMIN]);
    assert.equal(can(client.channels.get(RULES), "SendMessage"), true);
  } finally {
    stopViewingAs();
  }
});

test("only the viewed server changes, and stopping brings your own view back", async () => {
  const client = await readyClient();
  try {
    viewServerAs(S1, []);
    assert.deepEqual(viewingAs(S1), { serverId: S1, roleIds: [] });
    assert.equal(viewingAs(S2), undefined);
    // the other server is still yours: the owner can kick there
    assert.equal(client.servers.get(S2).havePermission("KickMembers"), true);

    stopViewingAs();
    assert.equal(viewingAs(), undefined);
    assert.equal(can(client.channels.get(STAFF_ONLY), "ViewChannel"), true);
  } finally {
    stopViewingAs();
  }
});
