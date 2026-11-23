// Bots in direct messages: `bot.on("start", …)` and the start payload.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { Client, Interaction } from "../../lib/bot/index.js";

/** A client whose requests are recorded */
function recording(onError) {
  const calls = [];
  const client = new Client({
    token: "t",
    apiUrl: "http://api.test",
    onError,
    fetch: async (url, init = {}) => {
      calls.push({
        method: (init.method ?? "GET").toUpperCase(),
        url: String(url).replace("http://api.test", ""),
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return Response.json({ _id: "x" });
    },
  });
  return { client, calls };
}

/** A request as Zrzur sends it */
function signed(body, delivery) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const mac = createHmac("sha256", "s3cret")
    .update(`v1:${timestamp}:${body}`)
    .digest("hex");
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

function start(extra = {}) {
  return {
    _id: "I1",
    type: "Start",
    version: 1,
    application_id: "B1",
    token: "T",
    channel_id: "D1",
    user: { _id: "U1", username: "sami" },
    user_permissions: 0,
    app_permissions: 0,
    respond_by: "2030-01-01T00:00:00Z",
    expires_at: "2030-01-01T00:00:00Z",
    ...extra,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a start interaction is a start, with or without a payload", () => {
  const rest = { req: async () => ({}) };
  const withPayload = new Interaction(start({ start: { payload: "ref-42" } }), rest);
  assert.equal(withPayload.isStart(), true);
  assert.equal(withPayload.isCommand(), false);
  assert.equal(withPayload.startPayload, "ref-42");
  assert.equal(withPayload.isRepliable(), true);

  const bare = new Interaction(start({ start: {} }), rest);
  assert.equal(bare.startPayload, null);
  const command = new Interaction(start({ type: "Command" }), rest);
  assert.equal(command.isStart(), false);
  assert.equal(command.startPayload, null);
});

test('bot.on("start") gets the interaction and answers it by REST', async () => {
  const { client, calls } = recording();
  const seen = [];
  client.on("start", async (interaction) => {
    seen.push(interaction.startPayload);
    await interaction.reply({ content: "Welcome" });
  });
  const handle = client.httpHandler({ secret: "s3cret" });
  const body = JSON.stringify(start({ start: { payload: "promo_7" } }));
  assert.equal((await handle(signed(body, "S1"))).status, 202);
  await settle();
  assert.deepEqual(seen, ["promo_7"]);
  assert.equal(calls[0].url, "/interactions/I1/T/callback");
  assert.equal(calls[0].body.type, "Message");
  assert.equal(calls[0].body.data.content, "Welcome");
});

test("every start listener runs, one failing goes to onError, off removes one", async () => {
  const errors = [];
  const { client } = recording((error) => errors.push(error.message));
  const order = [];
  const second = () => order.push("second");
  client.on("start", () => {
    throw new Error("first broke");
  });
  client.on("start", second);
  const handle = client.httpHandler({ secret: "s3cret" });

  await handle(signed(JSON.stringify(start()), "S1"));
  await settle();
  assert.deepEqual(order, ["second"]);
  assert.deepEqual(errors, ["first broke"]);

  client.off("start", second);
  await handle(signed(JSON.stringify(start({ _id: "I2" })), "S2"));
  await settle();
  assert.deepEqual(order, ["second"]);
});

test("a start never reaches command handlers, and commands never reach start", async () => {
  const { client } = recording();
  let starts = 0;
  let commands = 0;
  client.on("start", () => starts++);
  client.command("start", () => commands++);
  const handle = client.httpHandler({ secret: "s3cret" });

  await handle(signed(JSON.stringify(start()), "S1"));
  await handle(
    signed(
      JSON.stringify(
        start({
          _id: "I2",
          type: "Command",
          command: { id: "c", name: "start", type: "ChatInput", version: "1" },
        }),
      ),
      "S2",
    ),
  );
  await settle();
  assert.equal(starts, 1);
  assert.equal(commands, 1);
});
