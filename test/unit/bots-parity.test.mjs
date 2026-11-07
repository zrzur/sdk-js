// Threads, forums, invites, typing, HTTP interactions and the published contract.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  Client,
  DeliveryLog,
  InteractionCollectorError,
  ERROR_CODES,
  Intents,
  verifySignature,
} from "../../lib/bot/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** A client whose requests are recorded */
function recording() {
  const calls = [];
  const client = new Client({
    token: "t",
    apiUrl: "http://api.test",
    fetch: async (url, init = {}) => {
      calls.push({
        method: (init.method ?? "GET").toUpperCase(),
        url: String(url).replace("http://api.test", ""),
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return Response.json({ _id: "x", messages: [{ _id: "m" }] });
    },
  });
  return { client, calls };
}

// The same values are in the backend's `signing_matches_the_published_example`
const SECRET = "zrzur_sign_f27c5773e21ddeceaeb5e956dc45c16451f737addd5c0e4472f61060bca9b030";
const PING = '{"type":"Ping"}';
const NOW = 1700000000;
const SIGNATURE = "v1=928e5ffdc88564103b59f5485a6bfa7e1a633dca64f397396606a314f572c4d3";

const check = (extra = {}) =>
  verifySignature({
    secret: SECRET,
    timestamp: String(NOW),
    signature: SIGNATURE,
    body: PING,
    now: NOW,
    ...extra,
  });

test("the signature of the backend's published example verifies", async () => {
  assert.equal(await check(), true);
  assert.equal(await check({ body: new TextEncoder().encode(PING) }), true);
});

test("anything else does not", async () => {
  assert.equal(await check({ secret: "other" }), false);
  assert.equal(await check({ body: '{"type":"Pong"}' }), false);
  assert.equal(await check({ timestamp: String(NOW + 1), now: NOW }), false);
  assert.equal(await check({ signature: null }), false);
  assert.equal(await check({ timestamp: null }), false);
  assert.equal(await check({ signature: "v1=zz" }), false);
  assert.equal(await check({ signature: "v2=" + SIGNATURE.slice(3) }), false);
  assert.equal(await check({ signature: SIGNATURE.slice(0, -2) }), false);
  assert.equal(await check({ timestamp: "1e9" }), false);
});

test("an old or future request is refused", async () => {
  assert.equal(await check({ now: NOW + 300 }), true);
  assert.equal(await check({ now: NOW + 301 }), false);
  assert.equal(await check({ now: NOW - 301 }), false);
});

test("a delivery counts once, and is forgotten after the window", () => {
  const log = new DeliveryLog();
  assert.equal(log.first("a", 0), true);
  assert.equal(log.first("a", 1000), false);
  assert.equal(log.first("a", 601_000), true);
});

/** A request as Zrzur sends it */
function signed(body, secret = "s3cret", delivery = "D1") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const mac = createHmac("sha256", secret).update(`v1:${timestamp}:${body}`).digest("hex");
  return new Request("http://bot.test/interactions", {
    method: "POST",
    headers: {
      "X-Zrzur-Timestamp": timestamp,
      "X-Zrzur-Signature": `v1=${mac}`,
      "X-Zrzur-Delivery": delivery,
    },
    body,
  });
}

const interaction = JSON.stringify({
  _id: "I1",
  type: "Command",
  version: 1,
  application_id: "B1",
  token: "T",
  channel_id: "C1",
  user: { _id: "U1", username: "user" },
  command: { id: "c", name: "hello", type: "ChatInput", version: "1", options: [] },
  user_permissions: 0,
  app_permissions: 0,
  respond_by: "2030-01-01T00:00:00Z",
  expires_at: "2030-01-01T00:00:00Z",
});

test("the handler answers a Ping and refuses a wrong signature", async () => {
  const { client } = recording();
  const handle = client.httpHandler({ secret: "s3cret" });
  const pong = await handle(signed(PING));
  assert.equal(pong.status, 200);
  assert.deepEqual(await pong.json(), { type: "Pong" });
  assert.equal((await handle(signed(PING, "wrong"))).status, 401);
});

test("an interaction reaches the command once and is answered by REST", async () => {
  const { client, calls } = recording();
  let used = 0;
  client.command("hello", async (i) => {
    used++;
    await i.reply("hi");
  });
  const handle = client.httpHandler({ secret: "s3cret" });

  assert.equal((await handle(signed(interaction))).status, 202);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(used, 1);
  assert.equal(calls[0].url, "/interactions/I1/T/callback");

  // the same request again is a replay
  assert.equal((await handle(signed(interaction))).status, 409);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(used, 1);
});

test("a replay stays a replay when the unsigned header is changed", async () => {
  const { client } = recording();
  let used = 0;
  client.command("hello", () => used++);
  const handle = client.httpHandler({ secret: "s3cret" });
  assert.equal((await handle(signed(interaction, "s3cret", "first"))).status, 202);
  assert.equal((await handle(signed(interaction, "s3cret", "changed"))).status, 409);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(used, 1);
});

test("a forged interaction reaches nothing", async () => {
  const { client } = recording();
  let used = 0;
  client.command("hello", () => used++);
  const handle = client.httpHandler({ secret: "s3cret" });
  assert.equal((await handle(signed(interaction, "forged", "D2"))).status, 401);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(used, 0);
});

test("the Node server serves the handler end to end", async () => {
  const { client } = recording();
  const server = await client.listen({ secret: "s3cret", port: 0, hostname: "127.0.0.1" });
  const { port } = server.address();
  try {
    const request = signed(PING);
    const response = await fetch(`http://127.0.0.1:${port}/interactions`, {
      method: "POST",
      headers: request.headers,
      body: PING,
    });
    assert.deepEqual(await response.json(), { type: "Pong" });
    const wrongPath = await fetch(`http://127.0.0.1:${port}/other`, { method: "POST" });
    assert.equal(wrongPath.status, 404);
  } finally {
    server.close();
  }
});

test("threads use their routes", async () => {
  const { client, calls } = recording();
  await client.threads.create("C", { name: "Notes", content: "first" });
  await client.threads.list("C", { archived: true });
  await client.threads.archive("T");
  await client.threads.reopen("T");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      "POST /channels/C/threads",
      "GET /channels/C/threads?archived=true",
      "PATCH /channels/T/thread",
      "PATCH /channels/T/thread",
    ],
  );
  assert.deepEqual(calls[2].body, { archived: true });
});

test("forums use their routes", async () => {
  const { client, calls } = recording();
  await client.forums.create("S", { name: "questions" });
  await client.forums.post("F", { title: "Hi", content: "text", tags: ["help"] });
  await client.forums.setTags("F", [{ id: "help", name: "Help" }], { required: true });
  assert.equal(calls[0].url, "/servers/S/channels");
  assert.equal(calls[0].body.type, "Forum");
  assert.deepEqual(calls[1].body, { name: "Hi", content: "text", tags: ["help"] });
  assert.equal(calls[2].body.require_tag, true);
});

test("invites use their routes", async () => {
  const { client, calls } = recording();
  await client.invites.create("C", { max_uses: 3 });
  await client.invites.fetch("abc");
  await client.invites.list("S");
  await client.invites.delete("abc");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    ["POST /channels/C/invites", "GET /invites/abc", "GET /servers/S/invites", "DELETE /invites/abc"],
  );
});

test("typing goes over HTTP without a gateway connection", async () => {
  const { client, calls } = recording();
  await client.typing("C");
  assert.equal(calls[0].url, "/channels/C/typing");
});

test("a failed typing goes to onError and never rejects", async () => {
  const errors = [];
  const client = new Client({
    token: "t",
    apiUrl: "http://api.test",
    onError: (error) => errors.push(error),
    fetch: async () => Response.json({ type: "MissingPermission" }, { status: 403 }),
  });
  await client.typing("C");
  assert.equal(errors.length, 1);
});

test("the collector error is in our own words", () => {
  assert.equal(new InteractionCollectorError("time").message, "Nothing was collected before the wait ended, reason: time");
});

test("pins come back as a list either way", async () => {
  const { client, calls } = recording();
  assert.deepEqual(await client.messages.pins("C"), [{ _id: "m" }]);
  assert.deepEqual(calls[0].body, { pinned: true });
});

const schema = JSON.parse(readFileSync(join(root, "api/gateway.schema.json"), "utf8"));

test("every published gateway event has a type in the SDK", () => {
  const protocol = readFileSync(join(root, "src/core/protocol.ts"), "utf8");
  const events = schema.server.oneOf.map((event) => event.properties.type.enum[0]);
  assert.ok(events.length > 50);
  // the webhooks-audit stream owns the webhook events
  const webhooks = ["WebhookCreate", "WebhookUpdate", "WebhookDelete"];
  const missing = events.filter(
    (name) => !webhooks.includes(name) && !protocol.includes(`type: "${name}"`),
  );
  assert.deepEqual(missing, []);
});

test("the SDK's intents are the published ones", () => {
  const names = {
    SERVERS: "Servers",
    SERVER_MESSAGES: "ServerMessages",
    DIRECT_MESSAGES: "DirectMessages",
    REACTIONS: "Reactions",
    VOICE_STATES: "VoiceStates",
    INTERACTIONS: "Interactions",
    MESSAGE_CONTENT: "MessageContent",
    SERVER_MEMBERS: "ServerMembers",
    PRESENCE: "Presence",
  };
  for (const [wire, sdk] of Object.entries(names)) {
    assert.equal(Intents[sdk], schema.intents[wire], wire);
  }
  assert.equal(Intents.Default, schema.default_intents);
});

test("the error codes are the backend's", () => {
  assert.ok(ERROR_CODES.includes("MissingIntent"));
  assert.ok(ERROR_CODES.includes("SignedDeliveryRejected"));
  assert.ok(ERROR_CODES.length > 100);
});
