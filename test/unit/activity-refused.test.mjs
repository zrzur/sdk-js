// A refused SetActivity must never cost the connection (security review,
// blocker 1): the server sends ActivityRefused, the Gateway passes it on as
// an ordinary event without disconnecting, and the client tells the app
// which source was refused. Your own privacy changes arrive the same way.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Gateway } from "../../lib/index.js";
import { Client } from "../../lib/solid/index.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function sockets() {
  const all = [];
  class Socket {
    listeners = {};
    sent = [];
    readyState = 1;
    closed = false;
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
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.closed = true;
    }
  }
  return { Socket, all };
}

test("an ActivityRefused event keeps the connection and is passed on", async () => {
  const { Socket, all } = sockets();
  const gateway = new Gateway({ WebSocket: Socket, reconnect: () => 1 });
  const seen = [];
  const errors = [];
  gateway.on("event", (event) => seen.push(event.type));
  gateway.on("error", (error) => errors.push(error));
  gateway.connect("wss://ws.example", "token");
  await tick();
  all[0].push({ type: "Authenticated" }, { type: "Ready" });
  all[0].push({ type: "ActivityRefused", source: "Rpc", error: { type: "FailedValidation", error: "x" } });
  await tick(20);
  assert.equal(all.length, 1, "no reconnect");
  assert.equal(all[0].closed, false, "the socket stays open");
  assert.deepEqual(errors, [], "not an error of the connection");
  assert.ok(seen.includes("ActivityRefused"));
  gateway.disconnect();
});

test("the client says which source was refused, and passes privacy changes on", async () => {
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  const refused = [];
  const privacy = [];
  client.on("activityRefused", (source, error) => refused.push([source, error.type]));
  client.on("privacyUpdate", (value) => privacy.push(value));
  await client.events.emit("event", { type: "Ready", users: [], servers: [], channels: [], members: [], emojis: [] });
  await client.events.emit("event", { type: "ActivityRefused", source: "Desktop", error: { type: "RateLimited", retry_after: 1000 } });
  await client.events.emit("event", { type: "PrivacyUpdate", privacy: { share_activity: false } });
  assert.deepEqual(refused, [["Desktop", "RateLimited"]]);
  assert.deepEqual(privacy, [{ share_activity: false }]);
});
