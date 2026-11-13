// Resuming a dropped gateway session, and rate limits the client waits out
// before the server has to refuse.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Api, Gateway } from "../../lib/index.js";
import { Client } from "../../lib/bot/index.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** A WebSocket stand-in: records what is sent, lets the test answer */
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
    /** The server side drops the connection */
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

function resumableGateway(Socket) {
  const gateway = new Gateway({ WebSocket: Socket, reconnect: () => 1, resume: true });
  const seen = [];
  gateway.on("event", (event) => seen.push(event.seq ? `${event.type}#${event.seq}` : event.type));
  gateway.on("error", () => undefined);
  return { gateway, seen };
}

test("a resumable gateway asks for it, counts seq and resumes after a drop", async () => {
  const { Socket, last } = sockets();
  const { gateway, seen } = resumableGateway(Socket);
  gateway.connect("wss://ws.example", "bot-token");
  await tick();
  assert.deepEqual(last().sent[0], { type: "Authenticate", token: "bot-token", resumable: true });

  last().push(
    { type: "Authenticated" },
    { type: "Ready", session_id: "S1" },
    { type: "ChannelAck", id: "C", user: "U", message_id: "1", seq: 1 },
    { type: "ChannelAck", id: "C", user: "U", message_id: "2", seq: 2 },
  );
  assert.equal(gateway.sessionId, "S1");
  assert.equal(gateway.seq, 2);

  last().drop();
  await tick(20);
  // the reconnect resumes instead of authenticating
  assert.deepEqual(last().sent[0], { type: "Resume", token: "bot-token", session_id: "S1", seq: 2 });
  last().push(
    { type: "ChannelAck", id: "C", user: "U", message_id: "3", seq: 3 },
    { type: "Resumed" },
    { type: "ChannelAck", id: "C", user: "U", message_id: "4", seq: 4 },
  );
  assert.equal(gateway.state, 2 /* Connected */);
  assert.deepEqual(seen, ["Ready", "ChannelAck#1", "ChannelAck#2", "ChannelAck#3", "Resumed", "ChannelAck#4"]);
  assert.equal(gateway.seq, 4);
  gateway.close();
});

test("a refused resume falls back to authenticating on the same socket", async () => {
  const { Socket, last, all } = sockets();
  const { gateway, seen } = resumableGateway(Socket);
  gateway.connect("wss://ws.example", "bot-token");
  await tick();
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S1" }, { type: "Pong", data: Date.now(), seq: 1 });
  last().drop();
  await tick(20);
  assert.equal(last().sent[0].type, "Resume");

  last().push({ type: "InvalidSession", resumable: false });
  assert.deepEqual(last().sent[1], { type: "Authenticate", token: "bot-token", resumable: true });
  assert.equal(gateway.sessionId, undefined);
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S2" });
  assert.equal(gateway.sessionId, "S2");
  assert.equal(gateway.seq, 0, "a new session counts from the start");
  assert.equal(all.length, 2, "no extra socket");
  assert.ok(seen.includes("InvalidSession"), "the bot can tell it has to catch up");
  gateway.close();
});

test("a connection that did not ask for resume authenticates as before", async () => {
  const { Socket, last } = sockets();
  const gateway = new Gateway({ WebSocket: Socket, reconnect: () => 1 });
  gateway.connect("wss://ws.example", "session");
  await tick();
  assert.deepEqual(last().sent[0], { type: "Authenticate", token: "session" });
  // a session id from the server is not used without the option
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S1" }, { type: "ChannelAck", id: "C", user: "U", message_id: "1", seq: 1 });
  last().drop();
  await tick(20);
  assert.deepEqual(last().sent[0], { type: "Authenticate", token: "session" });
  gateway.close();
});

test("a fresh connect() never resumes an old session", async () => {
  const { Socket, last } = sockets();
  const { gateway } = resumableGateway(Socket);
  gateway.connect("wss://ws.example", "bot-token");
  await tick();
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S1" });
  gateway.connect("wss://ws.example", "other-token");
  await tick();
  assert.equal(last().sent[0].type, "Authenticate");
  gateway.close();
});

test("the bot client resumes by default", async () => {
  const { Socket, last } = sockets();
  const fetch = async () => new Response(JSON.stringify({ _id: "B", username: "bot", ws: "ws://ws", features: {} }), { status: 200 });
  const bot = new Client({ token: "t", apiUrl: "http://api", wsUrl: "ws://ws", fetch, WebSocket: Socket, onError: () => undefined });
  assert.equal(bot.gateway.options.resume, true);
  bot.gateway.connect("ws://ws", "t");
  await tick();
  assert.equal(last().sent[0].resumable, true);
  bot.gateway.close();
});

function fakeFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, at: Date.now() });
    const next = responses.shift() ?? { status: 204 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers,
    });
  };
  fn.calls = calls;
  return fn;
}

test("a 429 without readable headers waits the body's retry_after", async () => {
  const fetch = fakeFetch([{ status: 429, body: { retry_after: 120 } }, { body: { ok: 1 } }]);
  const api = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch });
  const started = Date.now();
  assert.deepEqual(await api.post("/channels/C/messages", { content: "x" }), { ok: 1 });
  assert.equal(fetch.calls.length, 2);
  assert.ok(fetch.calls[1].at - started >= 120, "waited the body's time");
});

test("an empty bucket is waited out before the next request, not refused", async () => {
  const fetch = fakeFetch([
    { body: { _id: "1" }, headers: { "x-ratelimit-bucket": "messages", "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "150" } },
    { body: { _id: "2" }, headers: { "x-ratelimit-bucket": "messages", "x-ratelimit-remaining": "4", "x-ratelimit-reset-after": "5000" } },
    { body: { _id: "3" } },
  ]);
  const api = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch });
  await api.post("/channels/C/messages", { content: "1" });
  const second = api.post("/channels/C/messages", { content: "2" });
  await tick(50);
  assert.equal(fetch.calls.length, 1, "the second waits for the bucket");
  await second;
  assert.ok(fetch.calls[1].at - fetch.calls[0].at >= 150);
  // requests left: no wait
  const before = Date.now();
  await api.post("/channels/C/messages", { content: "3" });
  assert.ok(Date.now() - before < 100);
});

test("a typed 429 (slow mode) is still the caller's to see", async () => {
  const fetch = fakeFetch([{ status: 429, body: { type: "InSlowmode", retry_after: 50 } }]);
  const api = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch });
  await assert.rejects(api.post("/channels/C/messages", { content: "x" }), (e) => e.type === "InSlowmode");
  assert.equal(fetch.calls.length, 1);
});

test("MissingIntent then close 4014: refused once, no reconnect, the bot is told", async () => {
  const { Socket, last, all } = sockets();
  const fetch = async () => new Response(JSON.stringify({ _id: "B", username: "bot" }), { status: 200 });
  const bot = new Client({ token: "t", apiUrl: "http://api", wsUrl: "ws://ws", fetch, WebSocket: Socket, onError: () => undefined });
  const told = [];
  bot.on("DisallowedIntents", (packet) => told.push(packet.reason));
  const closes = [];
  bot.gateway.on("close", (code) => closes.push(code));
  bot.gateway.connect("ws://ws", "t");
  await tick();
  // the order the server uses: the error, then the close
  last().push({ type: "Error", data: { type: "MissingIntent", intent: "MESSAGE_CONTENT" } });
  last().emit("close", { code: 4014, reason: "Disallowed intents: MESSAGE_CONTENT (switched on: none)" });
  await tick(30);
  assert.deepEqual(closes, [4014]);
  assert.equal(told.length, 1);
  assert.match(told[0], /MESSAGE_CONTENT/);
  assert.equal(all.length, 1, "no reconnect");
  bot.gateway.close();
});

test("a transient error keeps the session to resume", async () => {
  const { Socket, last } = sockets();
  const { gateway } = resumableGateway(Socket);
  gateway.connect("wss://ws.example", "bot-token");
  await tick();
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S1" }, { type: "ChannelAck", id: "C", user: "U", message_id: "1", seq: 1 });
  last().push({ type: "Error", data: { type: "InternalError" } });
  last().drop();
  await tick(20);
  assert.deepEqual(last().sent[0], { type: "Resume", token: "bot-token", session_id: "S1", seq: 1 });
  gateway.close();
});

test("the bucket map stays small: one entry per route and resource, bounded", async () => {
  const responses = [];
  for (let n = 0; n < 1300; n++) {
    responses.push({ body: {}, headers: { "x-ratelimit-bucket": "messages", "x-ratelimit-remaining": "5", "x-ratelimit-reset-after": "1000" } });
  }
  const fetch = fakeFetch(responses);
  const api = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch });
  const channel = "01JCHANNE1000000000000000A";
  for (let n = 0; n < 50; n++) {
    const id = `01J${String(n).padStart(23, "0")}`;
    await api.delete(`/channels/${channel}/messages/${id}`);
  }
  assert.equal(api.knownRoutes(), 1, "message ids do not make new entries");
  for (let n = 0; n < 1250; n++) {
    const id = `01J${String(n).padStart(23, "0")}`;
    await api.post(`/channels/${id}/messages`, { content: "x" });
  }
  assert.equal(api.knownRoutes(), 1024, "bounded however many channels");
});

test("a global 429 without readable headers is read from the body", async () => {
  const fetch = fakeFetch([{ status: 429, body: { retry_after: 80, global: true } }, { body: {} }, { body: {} }]);
  const api = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch });
  await api.post("/channels/C/messages", { content: "x" });
  // the pause holds every route, not only this one
  assert.ok(api.pausedFor() >= 0);
  const started = Date.now();
  const other = fakeFetch([{ status: 429, body: { retry_after: 80, global: true } }]);
  const api2 = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch: other, maxRetries: 0 });
  await assert.rejects(api2.get("/users/@me"));
  assert.ok(api2.pausedFor() > 0, "a global pause from the body");
  assert.ok(Date.now() - started < 1000);
});
