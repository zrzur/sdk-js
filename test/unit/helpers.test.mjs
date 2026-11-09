// Builders and REST helpers, run against the build: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { EmbedBuilder, Permissions, SlashCommandBuilder, Client, contextCommand } from "../../lib/bot/index.js";

function fakeFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method, body });
    const next = responses.shift() ?? { status: 204 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  };
  fn.calls = calls;
  return fn;
}

const bot = (fetch) => new Client({ token: "t", apiUrl: "http://api", wsUrl: "ws://ws", fetch });

test("SlashCommandBuilder builds the wire format, required options first", () => {
  const json = new SlashCommandBuilder("ban", "Ban a member")
    .describe({ ar: "حظر عضو" })
    .string("reason", "Why")
    .user("member", "Who", { required: true })
    .integer("days", "Delete messages", { min: 0, max: 7 })
    .permissions(Permissions.BanMembers)
    .toJSON();
  assert.equal(json.type, "ChatInput");
  assert.deepEqual(
    json.options.map((o) => [o.name, o.type, !!o.required]),
    [
      ["member", "User", true],
      ["reason", "String", false],
      ["days", "Integer", false],
    ],
  );
  assert.equal(json.options[2].max_value, 7);
  assert.equal(json.default_member_permissions, Permissions.BanMembers);
  assert.equal(json.description_localizations.ar, "حظر عضو");
});

test("sub-commands carry their own options", () => {
  const json = new SlashCommandBuilder("tag", "Tags")
    .subcommand("add", "Add a tag", (s) => s.string("name", "Name", { required: true }))
    .subcommand("list", "List tags")
    .toJSON();
  assert.equal(json.options[0].type, "SubCommand");
  assert.equal(json.options[0].options[0].name, "name");
  assert.deepEqual(json.options[1].options, []);
});

test("syncCommands accepts builders and context commands", async () => {
  const fetch = fakeFetch([{ body: [] }]);
  const b = bot(fetch);
  b.user = { _id: "BOT" };
  await b.syncCommands([new SlashCommandBuilder("hello", "Say hello"), contextCommand("Message", "quote")]);
  assert.equal(fetch.calls[0].method, "PUT");
  assert.equal(fetch.calls[0].body[0].name, "hello");
  assert.equal(fetch.calls[0].body[1].type, "Message");
});

test("messages.send: replies, silent flag and embed builders", async () => {
  const fetch = fakeFetch([{ body: { _id: "M" } }]);
  await bot(fetch).messages.send("C", {
    content: "hi",
    replyTo: "R",
    silent: true,
    embeds: [new EmbedBuilder().title("T").colour("#9075FF")],
  });
  const call = fetch.calls[0];
  assert.equal(call.url, "http://api/channels/C/messages");
  assert.deepEqual(call.body.replies, [{ id: "R", mention: false }]);
  // the server reads bit positions: silent is 1 << 1
  assert.equal(call.body.flags, 2);
  assert.deepEqual(call.body.embeds, [{ title: "T", colour: "#9075FF" }]);
});

test("reactions encode the emoji", async () => {
  const fetch = fakeFetch();
  await bot(fetch).messages.react("C", "M", "👍");
  assert.equal(fetch.calls[0].url, "http://api/channels/C/messages/M/reactions/%F0%9F%91%8D");
  assert.equal(fetch.calls[0].method, "PUT");
});

test("members: timeout, clearing nickname, ban with reason", async () => {
  const fetch = fakeFetch([{ body: {} }, { body: {} }, { body: {} }]);
  const b = bot(fetch);
  const before = Date.now();
  await b.members.timeout("S", "U", 60);
  await b.members.edit("S", "U", { nickname: null });
  await b.members.ban("S", "U", { reason: "spam" });
  const timeout = Date.parse(fetch.calls[0].body.timeout);
  assert.ok(timeout >= before + 59_000 && timeout <= Date.now() + 61_000);
  assert.deepEqual(fetch.calls[1].body, { remove: ["Nickname"] });
  assert.equal(fetch.calls[2].url, "http://api/servers/S/bans/U");
  assert.equal(fetch.calls[2].body.reason, "spam");
});

test("addRole keeps the member's other roles", async () => {
  const fetch = fakeFetch([{ body: { roles: ["A"] } }, { body: {} }]);
  await bot(fetch).members.addRole("S", "U", "B");
  assert.deepEqual(fetch.calls[1].body.roles, ["A", "B"]);
});

test("users.sendDM opens the DM channel first", async () => {
  const fetch = fakeFetch([{ body: { _id: "DM" } }, { body: { _id: "M" } }]);
  await bot(fetch).users.sendDM("U", "hello");
  assert.equal(fetch.calls[0].url, "http://api/users/U/dm");
  assert.equal(fetch.calls[1].url, "http://api/channels/DM/messages");
});

test("setStatus sends text and presence", async () => {
  const fetch = fakeFetch([{ body: {} }]);
  await bot(fetch).setStatus("Playing chess", "Busy");
  assert.deepEqual(fetch.calls[0].body, { status: { text: "Playing chess", presence: "Busy" } });
});

test("emojis.create uploads to the file service, then names the emoji", async () => {
  const fetch = fakeFetch([
    { body: { features: { autumn: { url: "http://files/" } } } },
    { body: { id: "E1" } },
    { body: { _id: "E1", name: "zrzur" } },
  ]);
  const created = await bot(fetch).emojis.create("S", "zrzur", new Uint8Array([1, 2, 3]));
  assert.equal(fetch.calls[0].url, "http://api/");
  assert.equal(fetch.calls[1].url, "http://files/emojis");
  assert.equal(fetch.calls[1].method, "POST");
  assert.equal(fetch.calls[2].url, "http://api/custom/emoji/E1");
  assert.deepEqual(fetch.calls[2].body, { name: "zrzur", parent: { type: "Server", id: "S" }, nsfw: false });
  assert.equal(created._id, "E1");
});

test("emoji() writes the text form", async () => {
  const { emoji } = await import("../../lib/bot/index.js");
  assert.equal(emoji("01ARZ3NDEKTSV4RRFFQ69G5FAV"), ":01ARZ3NDEKTSV4RRFFQ69G5FAV:");
  assert.equal(emoji({ _id: "X" }), ":X:");
});

test("messages.send uploads files first and attaches their ids", async () => {
  const fetch = fakeFetch([
    { body: { features: { autumn: { url: "http://files" } } } },
    { body: { id: "F1" } },
    { body: { _id: "M" } },
  ]);
  await bot(fetch).messages.send("C", { content: "backup", files: [{ name: "b.json", data: new TextEncoder().encode("{}"), type: "application/json" }] });
  assert.equal(fetch.calls[1].url, "http://files/attachments");
  assert.deepEqual(fetch.calls[2].body.attachments, ["F1"]);
});
