import assert from "node:assert/strict";
import test from "node:test";

import { Client, PublicBot } from "../../lib/solid/index.js";

/** A client whose API answers from `routes` and counts each call */
function client(routes) {
  const c = new Client({ baseURL: "https://api.example" });
  const calls = [];
  c.api.get = async (path) => {
    calls.push(path);
    const answer = routes[path];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error(`no route ${path}`);
    return typeof answer === "function" ? answer() : answer;
  };
  return { c, calls };
}

const bot = { _id: "b", username: "helper", verified: true, server_count: 3 };
const commands = [{ _id: "c1", name: "ping", application_id: "b", type: "ChatInput" }];

test("a bot card asking three times at once sends one request", async () => {
  const { c, calls } = client({ "/bots/b/invite": bot });
  const [one, two, three] = await Promise.all([
    c.bots.fetchPublic("b"),
    c.bots.fetchPublic("b"),
    c.bots.fetchPublic("b"),
  ]);
  assert.equal(calls.length, 1);
  assert.ok(one instanceof PublicBot);
  assert.equal(one, two);
  assert.equal(two, three);
});

test("opening the card again answers from memory, also synchronously", async () => {
  const { c, calls } = client({ "/bots/b/invite": bot });
  assert.equal(c.bots.getPublic("b"), undefined);
  const first = await c.bots.fetchPublic("b");
  assert.equal(c.bots.getPublic("b"), first);
  assert.equal(await c.bots.fetchPublic("b"), first);
  assert.equal(calls.length, 1);
});

test("a kept answer expires, and forgetPublic drops it at once", async () => {
  const { c, calls } = client({ "/bots/b/invite": bot, "/bots/b/commands": commands });
  let now = 1_000;
  c.bots.now = () => now;
  await c.bots.fetchPublic("b");
  await c.bots.fetchPublicCommands("b");
  now += 5 * 60 * 1000 + 1;
  assert.equal(c.bots.getPublic("b"), undefined);
  await c.bots.fetchPublic("b");
  await c.bots.fetchPublicCommands("b");
  assert.equal(calls.length, 4);

  c.bots.forgetPublic("b");
  await c.bots.fetchPublic("b");
  await c.bots.fetchPublicCommands("b");
  assert.equal(calls.length, 6);
});

test("a failed request is not kept: the next open asks again", async () => {
  let fail = true;
  const { c, calls } = client({
    "/bots/b/invite": () => {
      if (fail) throw new Error("offline");
      return bot;
    },
  });
  await assert.rejects(c.bots.fetchPublic("b"));
  fail = false;
  const answer = await c.bots.fetchPublic("b");
  assert.equal(answer.username, "helper");
  assert.equal(calls.length, 2);
});

test("a bot's global commands are fetched once and kept", async () => {
  const { c, calls } = client({ "/bots/b/commands": commands });
  const [one, two] = await Promise.all([
    c.bots.fetchPublicCommands("b"),
    c.bots.fetchPublicCommands("b"),
  ]);
  assert.deepEqual(one, commands);
  assert.equal(one, two);
  assert.equal(await c.bots.fetchPublicCommands("b"), one);
  assert.equal(calls.length, 1);
});

test("the cache is bounded: the oldest bot is dropped first", async () => {
  const routes = {};
  for (let i = 0; i < 300; i++) routes[`/bots/b${i}/invite`] = { _id: `b${i}`, username: `b${i}` };
  const { c } = client(routes);
  for (let i = 0; i < 300; i++) await c.bots.fetchPublic(`b${i}`);
  assert.equal(c.bots.getPublic("b0"), undefined);
  assert.ok(c.bots.getPublic("b299"));
});

test("the owner editing the bot drops its kept public page", async () => {
  const { c, calls } = client({ "/bots/b/invite": bot });
  const owned = c.bots.getOrCreate("b", { _id: "b", owner: "o", token: "", public: true });
  c.api.patch = async () => ({ _id: "b", owner: "o", token: "", public: false });
  await c.bots.fetchPublic("b");
  await owned.edit({ public: false });
  assert.equal(c.bots.getPublic("b"), undefined);
  await c.bots.fetchPublic("b");
  assert.equal(calls.length, 2);
});

test("editing a bot user's profile drops its kept public page", async () => {
  const { c, calls } = client({ "/bots/b/invite": bot });
  const base = { discriminator: "0001", relationship: "None", online: false };
  const botUser = c.users.getOrCreate("b", { _id: "b", username: "helper", ...base, bot: { owner: "o" } });
  c.api.patch = async () => ({ _id: "b", username: "helper", ...base, bot: { owner: "o" } });
  await c.bots.fetchPublic("b");
  await botUser.edit({ profile: { content: "New description" } });
  assert.equal(c.bots.getPublic("b"), undefined);
  await c.bots.fetchPublic("b");
  assert.equal(calls.length, 2);
});

test("an update without the owner id keeps the owner this client knew", async () => {
  const c = new Client({ baseURL: "https://api.example", autoReconnect: false });
  const base = { discriminator: "0001", relationship: "None", online: false };
  c.users.getOrCreate("b", { _id: "b", username: "helper", ...base, bot: { owner: "o" } });
  // the server sends the owner id only to the owner and staff; a
  // verification update reaches everyone without it
  await c.events.emit("event", { type: "UserUpdate", id: "b", data: { bot: { verified: true } }, clear: [] });
  assert.deepEqual(c.users.get("b").bot, { owner: "o", verified: true });
  assert.equal(c.users.get("b").verifiedBot, true);
});
