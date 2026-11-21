// One test per bug of the bot platform audit (internal report 2026-11-21,
// section A and the SDK part of B). Each failed before its fix.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client, InteractionCollector } from "../../lib/bot/index.js";
import { Api, Gateway } from "../../lib/index.js";
import { Client as WebClient } from "../../lib/solid/index.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const BOT = "01HBOT00000000000000000000";
const USER = "01HUSER0000000000000000000";

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
      for (const packet of packets)
        this.emit("message", { data: JSON.stringify(packet) });
    }
    drop(code = 1006) {
      this.readyState = 3;
      this.emit("close", { code, reason: "" });
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
  }
  return { Socket, all, last: () => all[all.length - 1] };
}

/** Answers every request with `{ _id: BOT }` (the bot's own user), recording them */
function recordingFetch(answer = () => ({ _id: BOT, username: "bot" })) {
  const calls = [];
  const fetch = async (url, init) => {
    const call = {
      url: new URL(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const result = await answer(call);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result ?? {}), { status: 200 });
  };
  return { fetch, calls };
}

async function readyBot(extra = {}) {
  const { Socket, last, all } = sockets();
  const errors = [];
  const { fetch, calls } = recordingFetch(extra.answer);
  const bot = new Client({
    token: "placeholder",
    apiUrl: "http://api.test",
    wsUrl: "ws://ws.test",
    WebSocket: Socket,
    fetch,
    onError: (error) => errors.push(error),
    ...extra.options,
  });
  const login = bot.login();
  await tick();
  last().push({ type: "Authenticated" }, { type: "Ready", session_id: "S" });
  await login;
  return { bot, last, all, errors, calls };
}

// A1
test("A1: a failing async event handler goes to onError instead of crashing the bot", async () => {
  const { bot, last, errors } = await readyBot();
  const crashes = [];
  const onCrash = (error) => crashes.push(error);
  process.on("unhandledRejection", onCrash);
  try {
    bot.on("ServerMemberJoin", async () => {
      throw new Error("handler failed (on)");
    });
    bot.onMessage(async () => {
      throw new Error("handler failed (onMessage)");
    });
    bot.onMemberJoin(async () => {
      throw new Error("handler failed (onMemberJoin)");
    });
    last().push(
      {
        type: "ServerMemberJoin",
        id: "S",
        user: USER,
        member: { _id: { server: "S", user: USER } },
      },
      { type: "Message", _id: "M", channel: "C", author: USER, content: "hi" },
    );
    await tick(20);
    assert.deepEqual(crashes, [], "no unhandled rejection");
    assert.deepEqual(errors.map((e) => e.message).sort(), [
      "handler failed (on)",
      "handler failed (onMemberJoin)",
      "handler failed (onMessage)",
    ]);
  } finally {
    process.off("unhandledRejection", onCrash);
    bot.destroy();
  }
});

// A3
test("A3: failing collect and end handlers of a collector go to onError", async () => {
  const { bot, errors } = await readyBot();
  const crashes = [];
  const onCrash = (error) => crashes.push(error);
  process.on("unhandledRejection", onCrash);
  process.on("uncaughtException", onCrash);
  try {
    const collector = bot.createMessageComponentCollector({ time: 15 });
    collector.on("end", async () => {
      throw new Error("end failed (async)");
    });
    collector.on("end", () => {
      throw new Error("end failed (sync)");
    });
    await tick(40);
    assert.ok(collector.ended);
    assert.deepEqual(crashes, [], "nothing crashed");
    assert.deepEqual(errors.map((e) => e.message).sort(), [
      "end failed (async)",
      "end failed (sync)",
    ]);
  } finally {
    process.off("unhandledRejection", onCrash);
    process.off("uncaughtException", onCrash);
    bot.destroy();
  }
});

// A8
test("A8: fetchMany({ after }) pages forward, oldest first, so nothing is skipped", async () => {
  const { bot, calls } = await readyBot({
    answer: (call) =>
      call.method === "GET" && call.url.pathname.endsWith("/messages")
        ? []
        : { _id: BOT },
  });
  await bot.messages.fetchMany("C", { after: "01HAFTER00000000000000000A" });
  await bot.messages.fetchMany("C", { before: "01HBEFORE0000000000000000B" });
  await bot.messages.fetchMany("C", {
    after: "01HAFTER00000000000000000A",
    sort: "Latest",
  });
  const query = calls
    .filter((c) => c.url.pathname === "/channels/C/messages")
    .map((c) => c.url.searchParams.get("sort"));
  assert.deepEqual(query, ["Oldest", null, "Latest"]);
  bot.destroy();
});

// A13
test("A13: login() rejects when the gateway gives up, and when the bot is destroyed", async () => {
  {
    const { Socket, last } = sockets();
    const { fetch } = recordingFetch();
    const bot = new Client({
      token: "t",
      apiUrl: "http://api.test",
      wsUrl: "ws://ws.test",
      WebSocket: Socket,
      fetch,
      onError: () => {},
    });
    const login = bot.login();
    await tick();
    bot.destroy();
    await assert.rejects(login, /destroy/i);
  }
  {
    const { Socket, last } = sockets();
    const { fetch } = recordingFetch();
    const bot = new Client({
      token: "t",
      apiUrl: "http://api.test",
      wsUrl: "ws://ws.test",
      WebSocket: Socket,
      fetch,
      onError: () => {},
    });
    bot.gateway.options.reconnect = () => 1;
    const login = bot.login();
    const rejected = assert.rejects(login, /InvalidSession|refused/i);
    for (let i = 0; i < 3; i++) {
      await tick(10);
      last().push({ type: "Error", data: { type: "InvalidSession" } });
      last().drop();
    }
    await rejected;
    bot.destroy();
  }
});

test("A13: Authenticated without Ready does not hang: the gateway drops and tries again", async () => {
  const { Socket, all, last } = sockets();
  const gateway = new Gateway({
    WebSocket: Socket,
    reconnect: () => 1,
    readyTimeout: 0.03,
  });
  gateway.on("error", () => {});
  gateway.connect("ws://ws.test", "t");
  await tick();
  last().push({ type: "Authenticated" });
  await tick(80);
  assert.ok(all.length >= 2, "a new connection was opened");
  gateway.close();
});

// A16
test("A16: collector.next() leaves no listener behind", async () => {
  const collector = new InteractionCollector({}, () => {});
  const before =
    collector.listenerCount("end") + collector.listenerCount("collect");
  for (let i = 0; i < 20; i++) {
    const next = collector.next();
    collector.emit("collect", { id: String(i) });
    await next;
  }
  assert.equal(
    collector.listenerCount("end") + collector.listenerCount("collect"),
    before,
  );
  collector.stop();
});

// A18
test("A18: addRole and removeRole of the same member do not overwrite each other", async () => {
  let roles = ["R0"];
  const { bot } = await readyBot({
    answer: async (call) => {
      if (
        call.url.pathname === "/servers/S/members/U" &&
        call.method === "GET"
      ) {
        await tick(5);
        return { _id: { server: "S", user: "U" }, roles: [...roles] };
      }
      if (
        call.url.pathname === "/servers/S/members/U" &&
        call.method === "PATCH"
      ) {
        await tick(5);
        roles = call.body.roles;
        return { _id: { server: "S", user: "U" }, roles };
      }
      return { _id: BOT };
    },
  });
  await Promise.all([
    bot.members.addRole("S", "U", "R1"),
    bot.members.addRole("S", "U", "R2"),
    bot.members.removeRole("S", "U", "R0"),
  ]);
  assert.deepEqual([...roles].sort(), ["R1", "R2"]);
  bot.destroy();
});

test("A18: ensureCategory called twice at once makes one category", async () => {
  let categories = [];
  const { bot, calls } = await readyBot({
    answer: async (call) => {
      if (call.url.pathname === "/servers/S" && call.method === "GET") {
        await tick(5);
        return { _id: "S", categories: [...categories] };
      }
      if (call.url.pathname === "/servers/S" && call.method === "PATCH") {
        await tick(5);
        categories = call.body.categories;
        return { _id: "S", categories };
      }
      return { _id: BOT };
    },
  });
  const [a, b] = await Promise.all([
    bot.servers.ensureCategory("S", "Tickets"),
    bot.servers.ensureCategory("S", "tickets"),
  ]);
  assert.equal(a, b);
  assert.equal(categories.length, 1);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
  bot.destroy();
});

// A19
test("A19: onReaction skips the bot's own reactions unless includeSelf", async () => {
  const { bot, last } = await readyBot();
  const seen = [];
  const all = [];
  bot.onReaction((event) => seen.push(event.userId));
  bot.onReaction((event) => all.push(event.userId), { includeSelf: true });
  last().push(
    {
      type: "MessageReact",
      id: "M",
      channel_id: "C",
      user_id: BOT,
      emoji_id: "👍",
    },
    {
      type: "MessageReact",
      id: "M",
      channel_id: "C",
      user_id: USER,
      emoji_id: "👍",
    },
  );
  await tick();
  assert.deepEqual(seen, [USER]);
  assert.deepEqual(all, [BOT, USER]);
  bot.destroy();
});

// A20
test("A20: destroy() stops collectors, so their timers no longer keep the process alive", async () => {
  const { bot } = await readyBot();
  const collector = bot.createMessageComponentCollector({
    time: 60_000,
    idle: 60_000,
  });
  const ended = new Promise((resolve) =>
    collector.once("end", (_, reason) => resolve(reason)),
  );
  bot.destroy();
  assert.equal(await ended, "clientDestroy");
});

// B: off()
test("B: off() removes a listener added with on()", async () => {
  const { bot, last } = await readyBot();
  const seen = [];
  const listener = (packet) => seen.push(packet.id);
  const interactions = () => seen.push("interaction");
  bot.on("MessageDelete", listener);
  bot.on("interactionCreate", interactions);
  last().push({ type: "MessageDelete", id: "1", channel: "C" });
  bot.off("MessageDelete", listener);
  bot.off("interactionCreate", interactions);
  last().push({ type: "MessageDelete", id: "2", channel: "C" });
  await tick();
  assert.deepEqual(seen, ["1"]);
  bot.destroy();
});

// B: prefix
test("B: the default error log names @zrzur/sdk", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const { Socket, last } = sockets();
    const { fetch } = recordingFetch();
    const bot = new Client({
      token: "t",
      apiUrl: "http://api.test",
      wsUrl: "ws://ws.test",
      WebSocket: Socket,
      fetch,
    });
    const login = bot.login();
    await tick();
    last().push({ type: "Authenticated" }, { type: "Ready" });
    await login;
    bot.on("MessageDelete", () => {
      throw new Error("x");
    });
    last().push({ type: "MessageDelete", id: "1", channel: "C" });
    bot.destroy();
  } finally {
    console.error = original;
  }
  assert.equal(logged[0][0], "[@zrzur/sdk]");
});

// B: late callbacks
test("B: an interaction answer never waits past its deadline on a 429", async () => {
  let posts = 0;
  const { bot, last } = await readyBot({
    answer: (call) => {
      if (call.url.pathname.endsWith("/callback")) {
        posts += 1;
        return new Response(JSON.stringify({ retry_after: 5000 }), {
          status: 429,
          headers: { "x-ratelimit-reset-after": "5000" },
        });
      }
      return { _id: BOT };
    },
  });
  let failed;
  bot.command("slow", async (i) => {
    const started = Date.now();
    try {
      await i.reply("hi");
    } catch (error) {
      failed = { error, ms: Date.now() - started };
    }
  });
  last().push({
    type: "InteractionCreate",
    interaction: {
      _id: "01HINTERACTION000000000000",
      token: "tok",
      version: 1,
      application_id: BOT,
      type: "Command",
      user: { _id: USER, username: "u" },
      channel_id: "C",
      user_permissions: 0,
      app_permissions: 0,
      command: { id: "X", name: "slow", type: "ChatInput", version: "1" },
      respond_by: new Date(Date.now() + 3000).toISOString(),
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    },
  });
  await tick(200);
  assert.ok(failed, "the answer failed instead of waiting 5 s");
  assert.equal(failed.error.status, 429);
  assert.ok(failed.ms < 1000, `${failed.ms} ms`);
  assert.equal(posts, 1);
  bot.destroy();
});

// B: heartbeat numbers match the developer docs
test("B: heartbeat every 20 s, the connection is given up after 60 s without a Pong", () => {
  const gateway = new Gateway();
  assert.equal(gateway.options.heartbeatInterval, 20);
  assert.equal(gateway.options.pongTimeout, 60);
});

test("B: a missing Pong drops the connection once pongTimeout has passed since the last answer", async () => {
  const { Socket, all, last } = sockets();
  const gateway = new Gateway({
    WebSocket: Socket,
    reconnect: () => 1,
    // wide margins: a loaded test machine delays timers by tens of ms
    heartbeatInterval: 0.02,
    pongTimeout: 0.3,
  });
  gateway.on("error", () => {});
  const answer = setInterval(() => {
    const ping = last()?.sent.findLast((p) => p.type === "Ping");
    if (ping && all.length === 1) last().push({ type: "Pong", data: ping.data });
  }, 10);
  try {
    gateway.connect("ws://ws.test", "t");
    await tick();
    last().push({ type: "Authenticated" }, { type: "Ready" });
    // answered for longer than pongTimeout: stays
    await tick(450);
    assert.equal(all.length, 1, "answered pings keep the connection");
    clearInterval(answer);
    await tick(700);
    assert.ok(all.length >= 2, "unanswered pings end it");
  } finally {
    clearInterval(answer);
    gateway.close();
  }
});

// B: channels.create({ private })
test("B: channels.create passes private", async () => {
  const { bot, calls } = await readyBot();
  await bot.channels.create("S", { name: "staff", private: true });
  const call = calls.find((c) => c.url.pathname === "/servers/S/channels");
  assert.equal(call.body.private, true);
  bot.destroy();
});

// keep Api imported for the type of the 429 path
void Api;

// second review: a large Ready over a slow phone link is not a dead server
test("B: the web client waits for a slow Ready instead of reconnecting", async () => {
  const { Socket, all, last } = sockets();
  const client = new WebClient({
    baseURL: "http://localhost:1",
    autoReconnect: true,
    retryDelayFunction: () => 0.001,
    WebSocket: Socket,
    // the first message must come fast; Ready may take its time
    connectTimeout: 0.03,
  });
  client.events.on("error", () => {});
  assert.equal(client.events.options.readyTimeout, 60);
  client.events.connect("ws://ws.test", "t");
  await tick();
  last().push({ type: "Authenticated" });
  await tick(120);
  assert.equal(all.length, 1, "still the first connection, waiting for Ready");
  client.events.close();
});

test("B: pongTimeout is never shorter than two heartbeats", () => {
  const gateway = new Gateway({ heartbeatInterval: 30, pongTimeout: 10 });
  assert.equal(gateway.options.pongTimeout, 60);
  assert.equal(new Gateway({ pongTimeout: 90 }).options.pongTimeout, 90);
});

test("collector: off() takes back the once-listener of that event only", () => {
  const collector = new InteractionCollector({}, () => {});
  const listener = () => {};
  collector.once("collect", listener);
  collector.once("end", listener);
  collector.off("collect", listener);
  assert.equal(collector.listenerCount("collect"), 0);
  assert.equal(collector.listenerCount("end"), 1, "the end listener stays");
  collector.off("end", listener);
  assert.equal(collector.listenerCount("end"), 0);
});
