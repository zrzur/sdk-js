// The one HTTP client shared by apps and bots.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Api, ApiError, getPathName } from "../../lib/index.js";
import { routeList } from "../../lib/api/params.js";

function fakeFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift() ?? { status: 204 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers,
    });
  };
  fn.calls = calls;
  return fn;
}

test("there is no default host", () => {
  assert.throws(() => new Api({ baseURL: "" }), /baseURL/);
});

test("parameters go to the query or the body, as the route says", async () => {
  const fetch = fakeFetch([{ body: [] }, { body: { _id: "M" } }]);
  const api = new Api({ baseURL: "https://api.example/", authentication: { session: "s" }, fetch });
  await api.get("/channels/C/messages", { limit: 5, include_users: true });
  await api.post("/channels/C/messages", { content: "hi" });
  assert.equal(fetch.calls[0].url, "https://api.example/channels/C/messages?limit=5&include_users=true");
  assert.equal(fetch.calls[0].headers["x-session-token"], "s");
  assert.equal(fetch.calls[1].body.content, "hi");
});

// Moved from the web app's apiRequests.test.ts: the old client sent `{}` for
// routes missing from its table (threads, forum posts, ...).
test("sends the body of a route the client doesn't know", async () => {
  const fetch = fakeFetch([{ body: {} }]);
  const api = new Api({ baseURL: "http://api.test", fetch });
  await api.post("/channels/01ABC/no-such-route", { name: "Release plan", content: "first", tags: [] });
  assert.deepEqual(fetch.calls[0].body, { name: "Release plan", content: "first", tags: [] });
});

test("sends the parameters of an unknown read as the query", async () => {
  const fetch = fakeFetch([{ body: {} }]);
  const api = new Api({ baseURL: "http://api.test", fetch });
  await api.get("/channels/01ABC/no-such-route", { archived: true });
  assert.equal(fetch.calls[0].url, "http://api.test/channels/01ABC/no-such-route?archived=true");
  assert.equal(fetch.calls[0].body, undefined);
});

test("keeps a query already in the path", async () => {
  const fetch = fakeFetch([{ body: {} }]);
  const api = new Api({ baseURL: "http://api.test", fetch });
  await api.get("/servers/01ABC/members_experimental_query?query=a");
  assert.equal(fetch.calls[0].url, "http://api.test/servers/01ABC/members_experimental_query?query=a");
});

test("still splits query and body for a known route", async () => {
  const fetch = fakeFetch([{ body: {} }]);
  const api = new Api({ baseURL: "http://api.test", fetch });
  await api.post("/channels/01ABC/messages", { content: "hi" });
  assert.deepEqual(fetch.calls[0].body, { content: "hi" });
});

test("a list body is sent as is", async () => {
  const fetch = fakeFetch([{ body: [] }]);
  const api = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch });
  await api.put("/applications/A/commands", [{ name: "hello", description: "Hi" }]);
  assert.deepEqual(fetch.calls[0].body, [{ name: "hello", description: "Hi" }]);
  assert.equal(fetch.calls[0].headers["x-bot-token"], "b");
});

test("errors carry the server's fields and keep tokens out of the message", async () => {
  const fetch = fakeFetch([{ status: 403, body: { type: "MissingPermission", permission: "ManageMessages" } }]);
  const api = new Api({ baseURL: "https://api.example", fetch });
  const error = await api.delete("/interactions/I/secret/original").catch((e) => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 403);
  assert.equal(error.type, "MissingPermission");
  assert.equal(error.permission, "ManageMessages");
  assert.ok(!error.message.includes("secret"));
});

test("paths resolve to their templates, literal segments first", () => {
  assert.equal(getPathName("/users/@me"), "/users/@me");
  assert.equal(getPathName("/users/01ARZ3NDEKTSV4RRFFQ69G5FAV"), "/users/{target}");
  assert.equal(getPathName("/servers/S/ack"), "/servers/{target}/ack");
  assert.equal(getPathName("/no/such/route/here/at/all"), undefined);
});

test("the route table covers the server's document", () => {
  assert.ok(routeList.length > 300);
  for (const route of ["GET /users/@me/mentions", "PATCH /auth/account/age", "POST /webhooks/{webhook_id}/{token}"]) {
    assert.ok(routeList.includes(route), route);
  }
});

test("the gateway authenticates by message and unpacks Bulk packets", async () => {
  const { Gateway } = await import("../../lib/index.js");
  class FakeSocket {
    static last;
    listeners = {};
    sent = [];
    readyState = 1;
    constructor(url) {
      this.url = url;
      FakeSocket.last = this;
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    emit(type, event) {
      for (const fn of this.listeners[type] ?? []) fn(event);
    }
    push(packet) {
      this.emit("message", { data: JSON.stringify(packet) });
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {}
  }
  const gateway = new Gateway({ WebSocket: FakeSocket });
  const seen = [];
  gateway.on("event", (event) => seen.push(event.type));
  gateway.connect("wss://ws.example", "session-token");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(!FakeSocket.last.url.includes("session-token"), "token stays out of the URL");
  assert.deepEqual(FakeSocket.last.sent[0], { type: "Authenticate", token: "session-token" });
  FakeSocket.last.push({ type: "Ready" });
  FakeSocket.last.push({
    type: "Bulk",
    v: [
      { type: "ChannelStartTyping", id: "C", user: "U" },
      { type: "ChannelStopTyping", id: "C", user: "U" },
    ],
  });
  assert.deepEqual(seen, ["Ready", "ChannelStartTyping", "ChannelStopTyping"]);
  gateway.close();
});

test("a request without parameters still sends {} on non-GET (Rocket Json needs a body)", async () => {
  const fetch = fakeFetch([{}, {}, {}]);
  const api = new Api({ baseURL: "https://api.example", authentication: { session: "s" }, fetch });
  await api.put("/servers/S/bans/U");
  await api.post("/servers/S/bans/U");
  await api.get("/users/@me");
  assert.deepEqual(fetch.calls[0].body, {});
  assert.equal(fetch.calls[0].headers["content-type"], "application/json");
  assert.deepEqual(fetch.calls[1].body, {});
  assert.equal(fetch.calls[2].body, undefined);
});

test("a 429 with a typed body (slowmode) is thrown at once, a plain rate limit is retried", async () => {
  const slow = fakeFetch([
    { status: 429, headers: { "x-ratelimit-reset-after": "50" }, body: { type: "InSlowmode", retry_after: 50 } },
    { body: { ok: 1 } },
  ]);
  const api = new Api({ baseURL: "https://api.example", authentication: { session: "s" }, fetch: slow });
  await assert.rejects(api.post("/channels/C/messages", { content: "x" }), (e) => e.type === "InSlowmode" && e.status === 429);
  assert.equal(slow.calls.length, 1);

  const plain = fakeFetch([
    { status: 429, headers: { "x-ratelimit-reset-after": "10" }, body: { retry_after: 10 } },
    { body: { ok: 1 } },
  ]);
  const api2 = new Api({ baseURL: "https://api.example", authentication: { session: "s" }, fetch: plain });
  await api2.post("/channels/C/messages", { content: "x" });
  assert.equal(plain.calls.length, 2);
});

test("a failed file-service lookup is not cached", async () => {
  const fetch = fakeFetch([{ status: 500, body: { type: "InternalError" } }, { body: { features: { autumn: { url: "https://files.example/" } } } }]);
  const api = new Api({ baseURL: "https://api.example", authentication: { session: "s" }, fetch, maxRetries: 0 });
  await assert.rejects(api.filesUrl());
  assert.equal(await api.filesUrl(), "https://files.example");
});

test("a global pause is capped", async () => {
  const fetch = fakeFetch([
    { status: 429, headers: { "x-ratelimit-global": "true", "x-ratelimit-reset-after": "900000" }, body: { retry_after: 900000 } },
    { body: {} },
  ]);
  const api = new Api({ baseURL: "https://api.example", authentication: { bot: "b" }, fetch });
  await assert.rejects(api.get("/users/@me"));
  const started = Date.now();
  // the pause is at most 30 s; the second request must be queued, not hang for 15 minutes
  assert.ok(api.pausedFor() <= 30_100, `pause ${api.pausedFor()}`);
  assert.ok(Date.now() - started < 1000);
});

test("the gateway gives up only after 3 consecutive InvalidSession, with backoff", async () => {
  const { Gateway } = await import("../../lib/index.js");
  let sockets = 0;
  class Socket {
    listeners = {};
    readyState = 1;
    constructor() {
      sockets++;
      Socket.last = this;
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    send() {}
    close() {}
  }
  const refuse = () => {
    for (const fn of Socket.last.listeners.message) {
      fn({ data: JSON.stringify({ type: "Error", data: { type: "InvalidSession" } }) });
    }
  };
  const delays = [];
  const gateway = new Gateway({
    WebSocket: Socket,
    reconnect: (n) => (delays.push(n), 5),
  });
  gateway.on("error", () => undefined);
  gateway.connect("wss://ws.example", "bad");
  refuse();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(sockets, 2, "one refusal is retried (a restarting server answers like this)");
  refuse();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(sockets, 3);
  refuse();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sockets, 3, "the third refusal in a row is final");
  assert.deepEqual(delays, [0, 1], "retries back off");
  gateway.close();
});

test("a Ready resets the InvalidSession count", async () => {
  const { Gateway } = await import("../../lib/index.js");
  let sockets = 0;
  class Socket {
    listeners = {};
    readyState = 1;
    constructor() {
      sockets++;
      Socket.last = this;
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    send() {}
    close() {}
  }
  const say = (packet) => {
    for (const fn of Socket.last.listeners.message) fn({ data: JSON.stringify(packet) });
  };
  const gateway = new Gateway({ WebSocket: Socket, reconnect: () => 5 });
  gateway.on("error", () => undefined);
  gateway.connect("wss://ws.example", "tok");
  for (let round = 0; round < 3; round++) {
    say({ type: "Error", data: { type: "InvalidSession" } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    say({ type: "Authenticated" });
    say({ type: "Ready", users: [], servers: [], channels: [], members: [], emojis: [] });
  }
  assert.equal(sockets, 4, "three refusals that each recovered still reconnect");
  gateway.close();
});
