// The app's own reconnect (autoReconnect off, the app decides when) can ask
// the gateway to resume: the missed events come again and nothing is lost,
// instead of the whole first answer (Ready) once more. When the gateway can't
// resume (the window has passed, or the server restarted), it authenticates
// anew on the same socket and the app gets a full Ready.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Gateway } from "../../lib/index.js";
import { Client } from "../../lib/solid/index.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;

function sockets() {
  const all = [];
  class Socket {
    listeners = {};
    sent = [];
    readyState = 1;
    constructor(url) {
      this.url = url;
      all.push(this);
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    emit(type, event) {
      for (const fn of this.listeners[type] ?? []) fn(event);
    }
    push(...packets) {
      for (const packet of packets) this.emit("message", { data: JSON.stringify(packet) });
    }
    drop() {
      this.emit("close", { code: 1006, reason: "" });
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {}
  }
  return { Socket, all, last: () => all[all.length - 1] };
}

const ack = (seq) => ({ type: "ChannelAck", id: "C", user: "U", message_id: String(seq), seq });

function appGateway(Socket) {
  // as the app has it: no reconnect timer of its own, resumable sessions
  const gateway = new Gateway({ WebSocket: Socket, reconnect: false, resume: true });
  const seen = [];
  gateway.on("event", (event) => seen.push(event.seq ? `${event.type}#${event.seq}` : event.type));
  gateway.on("error", () => undefined);
  return { gateway, seen };
}

async function connectedOnce(gateway, last) {
  gateway.connect("wss://ws.example", "T");
  await tick();
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S1" }, ack(1), ack(2));
}

test("a reconnect within the window asks to resume and gets the missed events in order", async () => {
  const { Socket, last } = sockets();
  const { gateway, seen } = appGateway(Socket);
  await connectedOnce(gateway, last);
  last().drop();
  await tick(20);
  assert.equal(gateway.state, 3 /* Disconnected */, "no timer of its own");

  gateway.connect("wss://ws.example", "T", { resume: true });
  await tick();
  assert.deepEqual(last().sent[0], { type: "Resume", token: "T", session_id: "S1", seq: 2 });
  last().push(ack(3), ack(4), { type: "Resumed" }, ack(5));
  assert.equal(gateway.state, 2 /* Connected */);
  assert.deepEqual(seen, ["Ready", "ChannelAck#1", "ChannelAck#2", "ChannelAck#3", "ChannelAck#4", "Resumed", "ChannelAck#5"]);
  assert.equal(gateway.seq, 5);
  gateway.close();
});

test("a reconnect after the window is refused and falls back to a full Ready on the same socket", async () => {
  const { Socket, last, all } = sockets();
  const { gateway, seen } = appGateway(Socket);
  await connectedOnce(gateway, last);
  last().drop();
  await tick(20);
  gateway.connect("wss://ws.example", "T", { resume: true });
  await tick();
  const socket = last();
  assert.equal(socket.sent[0].type, "Resume");
  socket.push({ type: "InvalidSession", resumable: false });
  assert.deepEqual(socket.sent[1], { type: "Authenticate", token: "T", resumable: true });
  socket.push({ type: "Authenticated" }, { type: "Ready", session_id: "S2" }, ack(1));
  assert.equal(all.length, 2, "no third socket");
  assert.equal(gateway.state, 2);
  assert.equal(gateway.sessionId, "S2");
  assert.equal(gateway.seq, 1);
  assert.deepEqual(seen.slice(-3), ["InvalidSession", "Ready", "ChannelAck#1"]);
  gateway.close();
});

test("after a server restart (no session there) the reconnect authenticates anew", async () => {
  const { Socket, last } = sockets();
  const { gateway } = appGateway(Socket);
  await connectedOnce(gateway, last);
  last().drop();
  await tick(20);
  // the first try finds no server at all
  gateway.connect("wss://ws.example", "T", { resume: true });
  await tick();
  last().drop();
  await tick(20);
  assert.equal(gateway.sessionId, "S1", "a failed socket keeps the session to resume");
  // the restarted server knows no session
  gateway.connect("wss://ws.example", "T", { resume: true });
  await tick();
  assert.equal(last().sent[0].type, "Resume");
  last().push({ type: "InvalidSession", resumable: false });
  assert.equal(last().sent[1].type, "Authenticate");
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S3" });
  assert.equal(gateway.state, 2);
  assert.equal(gateway.sessionId, "S3");
  gateway.close();
});

test("without the resume option connect() starts fresh, as before", async () => {
  const { Socket, last } = sockets();
  const { gateway } = appGateway(Socket);
  await connectedOnce(gateway, last);
  last().drop();
  await tick(20);
  gateway.connect("wss://ws.example", "T");
  await tick();
  assert.equal(last().sent[0].type, "Authenticate");
  gateway.close();
});

test("the app client: a resume replays the missed message, is ready again and says so", async () => {
  const { Socket, last } = sockets();
  const client = new Client(
    { baseURL: "http://localhost:1", autoReconnect: false, resume: true, WebSocket: Socket },
    { ws: "wss://ws.example", features: {} },
  );
  client.useExistingSession({ _id: "s", token: "T", user_id: ID("AA") });
  client.on("error", () => undefined);
  let readies = 0, resumes = 0;
  client.on("ready", () => readies++);
  client.on("resumed", () => resumes++);
  client.connect();
  await tick();
  last().push(
    { type: "Authenticated" },
    {
      type: "Ready",
      session_id: "S1",
      users: [{ _id: ID("AA"), username: "me", discriminator: "0001", relationship: "User" }],
      servers: [],
      channels: [{ channel_type: "Group", _id: ID("C1"), name: "g", owner: ID("AA"), recipients: [ID("AA")] }],
      members: [],
      emojis: [],
    },
  );
  await tick();
  assert.equal(readies, 1);
  last().drop();
  await tick(20);

  client.connect({ resume: true });
  await tick();
  assert.equal(client.ready(), false, "not ready while resuming");
  assert.equal(last().sent[0].type, "Resume");
  last().push(
    { type: "Message", _id: ID("M1"), channel: ID("C1"), author: ID("AA"), content: "while away", seq: 1 },
    { type: "Resumed" },
  );
  await tick();
  assert.equal(client.messages.get(ID("M1"))?.content, "while away", "the missed message is in");
  assert.equal(resumes, 1);
  assert.equal(readies, 1, "no second Ready");
  assert.equal(client.ready(), true);
  client.events.close();
});
