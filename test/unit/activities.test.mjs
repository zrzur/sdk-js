// Rich presence: users carry what they are doing right now, a gateway
// update replaces it, going offline or invisible hides it, and the app
// sets its own with one gateway message. The desktop RPC client speaks the
// local presence protocol.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";

import { ZrzurRpc, encodeFrame, pipePath } from "../../lib/rpc/index.js";
import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");

const playing = {
  source: "Rpc",
  type: "Playing",
  name: "Star Kebab",
  details: "Level 3",
  started_at: "2026-11-22T10:00:00.000Z",
};
const steam = { source: "Steam", type: "Playing", name: "Portal 2" };

async function readyClient(other = {}) {
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [
      { _id: ME, username: "me", discriminator: "0001", relationship: "User", online: true, activities: [steam] },
      {
        _id: OTHER,
        username: "other",
        discriminator: "0002",
        relationship: "Friend",
        online: true,
        activities: [playing, steam],
        ...other,
      },
    ],
    servers: [],
    channels: [],
    members: [],
    emojis: [],
  });
  return client;
}

test("Ready brings the activities, the main one first", async () => {
  const client = await readyClient();
  const other = client.users.get(OTHER);
  assert.equal(other.activities.length, 2);
  assert.equal(other.activity.name, "Star Kebab");
  assert.equal(other.activity.source, "Rpc");
  assert.equal(client.users.get(ME).activity.name, "Portal 2");
});

test("a user without activities has an empty list", async () => {
  const client = await readyClient({ activities: undefined });
  assert.deepEqual(client.users.get(OTHER).activities, []);
  assert.equal(client.users.get(OTHER).activity, undefined);
});

test("a gateway update replaces the list, an empty one clears it", async () => {
  const client = await readyClient();
  await client.events.emit("event", {
    type: "UserUpdate",
    id: OTHER,
    data: { activities: [steam] },
    clear: [],
  });
  assert.equal(client.users.get(OTHER).activity.name, "Portal 2");
  await client.events.emit("event", { type: "UserUpdate", id: OTHER, data: { activities: [] }, clear: [] });
  assert.deepEqual(client.users.get(OTHER).activities, []);
});

test("offline or invisible hides what someone does; your own stay yours", async () => {
  const client = await readyClient();
  await client.events.emit("event", { type: "UserUpdate", id: OTHER, data: { online: false }, clear: [] });
  assert.deepEqual(client.users.get(OTHER).activities, []);

  const again = await readyClient({ status: { presence: "Invisible" } });
  assert.deepEqual(again.users.get(OTHER).activities, []);

  await again.events.emit("event", { type: "UserUpdate", id: ME, data: { online: false, status: { presence: "Invisible" } }, clear: [] });
  assert.equal(again.users.get(ME).activity.name, "Portal 2", "you still see your own");
});

test("setActivity sends one SetActivity message", async () => {
  const client = await readyClient();
  const sent = [];
  client.events.send = (message) => sent.push(message);
  client.setActivity("Desktop", { type: "Using", name: "Visual Studio Code" });
  client.setActivity("Rpc", null);
  assert.deepEqual(sent, [
    { type: "SetActivity", source: "Desktop", activity: { type: "Using", name: "Visual Studio Code" } },
    { type: "SetActivity", source: "Rpc", activity: null },
  ]);
});

test("the bot library has no way to set a person's activity", async () => {
  const bot = await import("../../lib/bot/index.js");
  for (const value of Object.values(bot)) {
    if (typeof value === "function" && value.prototype) {
      assert.equal(value.prototype.setActivity, undefined, value.name);
    }
  }
});

test("pipe paths and frames follow the protocol", () => {
  assert.equal(pipePath(3, "win32", {}), "\\\\?\\pipe\\zrzur-ipc-3");
  assert.match(pipePath(0, "linux", { XDG_RUNTIME_DIR: "/run/user/1000" }), /zrzur-ipc-0$/);
  const frame = encodeFrame(1, { a: 1 });
  assert.equal(frame.readUInt32LE(0), 1);
  assert.equal(frame.readUInt32LE(4), frame.length - 8);
  assert.throws(() => encodeFrame(1, { big: "x".repeat(70_000) }), RangeError);
  assert.throws(() => new ZrzurRpc({ clientId: "has spaces" }), TypeError);
});

test("the RPC client shakes hands and sets an activity on a desktop-like pipe", async (t) => {
  if (process.platform !== "win32") process.env.XDG_RUNTIME_DIR = (await import("node:os")).tmpdir();
  const frames = [];
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const length = buffer.readUInt32LE(4);
        if (buffer.length < 8 + length) return;
        const op = buffer.readUInt32LE(0);
        const data = JSON.parse(buffer.subarray(8, 8 + length).toString());
        buffer = buffer.subarray(8 + length);
        frames.push({ op, data });
        if (op === 0) socket.write(encodeFrame(1, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
        if (op === 1) socket.write(encodeFrame(1, { cmd: "SET_ACTIVITY", evt: null, nonce: data.nonce, data: data.args.activity }));
      }
    });
  });
  const path = pipePath(0);
  const listening = await new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(path, () => resolve(true));
  });
  if (!listening) {
    t.skip("pipe 0 is taken on this computer (a Zrzur desktop app runs)");
    return;
  }
  try {
    const rpc = new ZrzurRpc({ clientId: "test-game", timeout: 2000 });
    await rpc.connect();
    await rpc.setActivity({ details: "Ranked match", timestamps: { start: 1_700_000_000_000 } });
    rpc.close();
    assert.deepEqual(frames[0], { op: 0, data: { v: 1, client_id: "test-game" } });
    assert.equal(frames[1].data.cmd, "SET_ACTIVITY");
    assert.equal(frames[1].data.args.pid, process.pid);
    assert.equal(frames[1].data.args.activity.details, "Ranked match");
  } finally {
    server.close();
  }
});
