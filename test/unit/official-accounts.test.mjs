import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "../../lib/solid/index.js";
import { ERROR_CODES } from "../../lib/api/error-codes.js";

const user = (fields = {}) => ({
  _id: "01ZZZZZZZZZZZZZZZZZZZZZZZZ",
  username: "ZrzurSafety",
  discriminator: "0001",
  display_name: "Zrzur Safety",
  relationship: "None",
  online: false,
  ...fields,
});

const official = {
  official: true,
  official_names: { ar: "أمان زرزور", en: "Zrzur Safety", de: "Zrzur-Sicherheit" },
};

const client = () => new Client({ baseURL: "https://api.example" });

test("the mark comes from the server, not from an id", () => {
  const c = client();
  assert.equal(c.users.getOrCreate("a", user({ _id: "a" })).official, false);
  assert.equal(c.users.getOrCreate("b", user({ _id: "b", ...official })).official, true);
});

test("the official bot mark is its own mark", () => {
  const c = client();
  const bot = c.users.getOrCreate("c", user({ _id: "c", official_bot: true, bot: { owner: "o" } }));
  assert.equal(bot.officialBot, true);
  assert.equal(bot.official, false);
  // the picture stays the ordinary address: the seed picture is for accounts
  assert.equal(bot.defaultAvatarURL, "https://api.example/users/c/default_avatar");
});

test("an official name follows the language of the app", () => {
  const c = client();
  const account = c.users.getOrCreate("b", user({ _id: "b", ...official }));
  assert.equal(account.displayName, "Zrzur Safety");
  c.setLanguage("ar");
  assert.equal(account.displayName, "أمان زرزور");
  c.setLanguage("de");
  assert.equal(account.displayName, "Zrzur-Sicherheit");
  // a language without a name falls back
  c.setLanguage("fr");
  assert.equal(account.displayName, "Zrzur Safety");
});

test("ordinary people keep their name whatever the language", () => {
  const c = client();
  const person = c.users.getOrCreate("a", user({ _id: "a", display_name: "Sami" }));
  c.setLanguage("ar");
  assert.equal(person.displayName, "Sami");
});

test("an official picture has an address browsers don't hold yet", () => {
  const c = client();
  const person = c.users.getOrCreate("a", user({ _id: "a" }));
  const account = c.users.getOrCreate("b", user({ _id: "b", ...official }));
  assert.equal(person.defaultAvatarURL, "https://api.example/users/a/default_avatar");
  assert.equal(account.defaultAvatarURL, "https://api.example/users/b/default_avatar?v=2");
  assert.equal(account.avatarURL, account.defaultAvatarURL);
});

test("the error code is in the list", () => {
  assert.ok(ERROR_CODES.includes("OfficialAccount"));
});
