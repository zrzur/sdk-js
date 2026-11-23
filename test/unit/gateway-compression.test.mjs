// Compressed gateway frames (`compression: true`): the server sends large
// frames as raw DEFLATE in a binary frame. They must inflate to the same
// packets, in the order they arrived, and nothing changes for clients that
// do not ask or servers that do not compress.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { Gateway, canInflate } from "../../lib/index.js";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function sockets() {
  const all = [];
  class Socket {
    listeners = {};
    sent = [];
    readyState = 1;
    binaryType = "blob";
    constructor(url) {
      this.url = new URL(url);
      all.push(this);
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    emit(type, event) {
      for (const fn of this.listeners[type] ?? []) fn(event);
    }
    text(packet) {
      this.emit("message", { data: JSON.stringify(packet) });
    }
    deflated(packet) {
      const bytes = deflateRawSync(Buffer.from(JSON.stringify(packet)));
      this.emit("message", { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {}
  }
  return { Socket, last: () => all[all.length - 1] };
}

function gateway(Socket, compression) {
  const g = new Gateway({ WebSocket: Socket, compression });
  const seen = [];
  const errors = [];
  g.on("event", (event) => seen.push(event.type === "Message" ? `Message:${event.content}` : event.type));
  g.on("error", (error) => errors.push(error));
  return { g, seen, errors };
}

const ready = {
  type: "Ready",
  users: [],
  servers: [],
  channels: Array.from({ length: 300 }, (_, i) => ({ _id: `C${i}`, channel_type: "TextChannel", name: `channel ${i}` })),
  members: [],
  emojis: [],
};
const message = (content) => ({ type: "Message", _id: `M${content}`, channel: "C1", author: "U1", content });

test("this runtime can inflate raw DEFLATE", () => {
  assert.equal(canInflate(), true);
});

test("asking for compression adds the connect parameter and takes binary as ArrayBuffer", async () => {
  const { Socket, last } = sockets();
  gateway(Socket, true).g.connect("wss://ws.example", "token");
  await tick();
  assert.equal(last().url.searchParams.get("compression"), "deflate");
  assert.equal(last().url.searchParams.get("format"), "json");
  assert.equal(last().binaryType, "arraybuffer");
});

test("by default nothing is asked for and binary frames are ignored, as before", async () => {
  const { Socket, last } = sockets();
  const { g, seen } = gateway(Socket, undefined);
  g.connect("wss://ws.example", "token");
  await tick();
  assert.equal(last().url.searchParams.has("compression"), false);
  last().text({ type: "Authenticated" });
  last().deflated(ready);
  await tick();
  assert.deepEqual(seen, []);
});

test("a compressed Ready inflates to the same packet, and later text frames wait for it", async () => {
  const { Socket, last } = sockets();
  const { g, seen, errors } = gateway(Socket, true);
  let readyChannels = 0;
  g.on("event", (event) => {
    if (event.type === "Ready") readyChannels = event.channels.length;
  });
  g.connect("wss://ws.example", "token");
  await tick();
  last().text({ type: "Authenticated" });
  last().deflated(ready);
  // these arrive while Ready is still being inflated
  last().text(message("one"));
  last().deflated({ ...message("two"), padding: "x".repeat(5000) });
  last().text(message("three"));
  await tick(60);
  assert.deepEqual(errors, []);
  assert.deepEqual(seen, ["Ready", "Message:one", "Message:two", "Message:three"]);
  assert.equal(readyChannels, 300);
  assert.equal(g.state, 2 /* Connected */);
});

test("a server that does not compress is read as before", async () => {
  const { Socket, last } = sockets();
  const { g, seen } = gateway(Socket, true);
  g.connect("wss://ws.example", "token");
  await tick();
  last().text({ type: "Authenticated" });
  last().text(ready);
  last().text(message("one"));
  await tick();
  assert.deepEqual(seen, ["Ready", "Message:one"]);
});

test("a frame that does not inflate is a protocol error, and the connection is dropped", async () => {
  const { Socket, last } = sockets();
  const { g, errors } = gateway(Socket, true);
  g.connect("wss://ws.example", "token");
  await tick();
  last().text({ type: "Authenticated" });
  last().emit("message", { data: new Uint8Array([1, 2, 3, 4, 5]).buffer });
  await tick(60);
  assert.equal(errors.length, 1);
  assert.notEqual(g.state, 2 /* Connected */);
});

test("a reconnect while a frame is still inflating keeps the order on the new socket", async () => {
  const { Socket, last } = sockets();
  const { g, seen, errors } = gateway(Socket, true);
  g.connect("wss://ws.example", "token");
  await tick();
  const first = last();
  first.text({ type: "Authenticated" });
  // a large Ready still inflating, text queued behind it, then the socket is replaced
  first.deflated(ready);
  first.text(message("old"));
  g.connect("wss://ws.example", "token");
  await tick();
  const second = last();
  assert.notEqual(first, second);
  second.text({ type: "Authenticated" });
  second.deflated(ready);
  second.text(message("one"));
  second.deflated({ ...message("two"), padding: "x".repeat(5000) });
  second.text(message("three"));
  await tick(80);
  assert.deepEqual(errors, []);
  // nothing from the replaced socket, and the new one in its own order
  assert.deepEqual(seen, ["Ready", "Message:one", "Message:two", "Message:three"]);
});

test("a resumed session takes compressed missed events in order before Resumed", async () => {
  const { Socket, last } = sockets();
  const g = new Gateway({ WebSocket: Socket, compression: true, resume: true, reconnect: () => 1 });
  const seen = [];
  g.on("event", (event) => seen.push(event.type === "Message" ? `Message:${event.content}` : event.type));
  g.on("error", () => undefined);
  g.connect("wss://ws.example", "token");
  await tick();
  last().text({ type: "Authenticated" });
  last().deflated({ ...ready, session_id: "S1" });
  last().text({ ...message("a"), seq: 1 });
  await tick(40);
  last().emit("close", { code: 1006, reason: "" });
  await tick(40);
  assert.equal(last().sent[0].type, "Resume");
  last().deflated({ ...message("b"), seq: 2, padding: "x".repeat(5000) });
  last().text({ ...message("c"), seq: 3 });
  last().text({ type: "Resumed" });
  await tick(80);
  assert.deepEqual(seen, ["Ready", "Message:a", "Message:b", "Message:c", "Resumed"]);
  assert.equal(g.state, 2 /* Connected */);
});
