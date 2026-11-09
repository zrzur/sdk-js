import assert from "node:assert/strict";
import test from "node:test";

import { Client, PublicBot } from "../../lib/solid/index.js";

const client = () => new Client({ baseURL: "https://api.example" });

test("a public bot carries what the add dialog and its page need", () => {
  const bot = new PublicBot(client(), {
    _id: "b",
    username: "helper",
    default_permissions: 2 ** 22 + 2 ** 23,
    privacy_policy_url: "https://helper.example/privacy",
    terms_of_service_url: "https://helper.example/terms",
    verified: true,
    creator: { _id: "o", username: "maker", display_name: "Maker" },
    server_count: 12,
  });
  assert.equal(bot.defaultPermissions, 2 ** 22 + 2 ** 23);
  assert.equal(bot.privacyPolicyUrl, "https://helper.example/privacy");
  assert.equal(bot.termsOfServiceUrl, "https://helper.example/terms");
  assert.equal(bot.verified, true);
  assert.deepEqual(bot.creator, { id: "o", username: "maker", displayName: "Maker" });
  assert.equal(bot.serverCount, 12);
});

test("missing fields stay empty, and a bot is not verified by default", () => {
  const bot = new PublicBot(client(), { _id: "b", username: "helper" });
  assert.equal(bot.defaultPermissions, undefined);
  assert.equal(bot.privacyPolicyUrl, undefined);
  assert.equal(bot.verified, false);
  assert.equal(bot.creator, undefined);
  assert.equal(bot.serverCount, undefined);
});

test("a verified bot user says so; other users and plain bots do not", () => {
  const c = client();
  const base = { discriminator: "0001", relationship: "None", online: false };
  const verified = c.users.getOrCreate("v", {
    _id: "v",
    username: "v",
    ...base,
    bot: { owner: "o", verified: true },
  });
  const plain = c.users.getOrCreate("p", { _id: "p", username: "p", ...base, bot: { owner: "o" } });
  const person = c.users.getOrCreate("h", { _id: "h", username: "h", ...base });
  assert.equal(verified.verifiedBot, true);
  assert.equal(plain.verifiedBot, false);
  assert.equal(person.verifiedBot, false);
});
