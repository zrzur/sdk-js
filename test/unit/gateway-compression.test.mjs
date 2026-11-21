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
