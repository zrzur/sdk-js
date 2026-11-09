// Unit tests for the SDK, run against the build: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  InteractionAlreadyRepliedError,
  ApiError,
  Intents,
  EmbedBuilder,
  commandMention,
  Client,
  toActionRows,
  toBlocks,
  toModal,
} from "../../lib/bot/index.js";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** fetch double that records requests and answers from a queue */
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

/** WebSocket double: lets a test push gateway packets */
class FakeSocket {
  static last;
  listeners = {};
  sent = [];
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

function interaction(extra) {
  return {
    _id: ID,
    version: 1,
    application_id: "BOT",
    token: "secret-token",
    user: { _id: "USER", username: "sami", discriminator: "0001" },
    channel_id: "CHANNEL",
    user_permissions: 0,
    app_permissions: 0,
    respond_by: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    ...extra,
  };
}

async function readyBot(responses) {
  const fetch = fakeFetch([{ body: { _id: "BOT", username: "bot", discriminator: "0001" } }, ...responses]);
  const bot = new Client({
    token: "bot-token",
    apiUrl: "http://127.0.0.1:1",
    wsUrl: "ws://127.0.0.1:2",
    fetch,
    WebSocket: FakeSocket,
    onError: (error) => {
      throw error;
    },
  });
  const login = bot.login();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(FakeSocket.last.sent[0], { type: "Authenticate", token: "bot-token" });
  assert.ok(!FakeSocket.last.url.includes("bot-token"), "token must not be in the URL");
  FakeSocket.last.push({ type: "Ready" });
  await login;
  return { bot, fetch };
}

test("friendly components become action rows", () => {
  const rows = toActionRows([
    { type: "button", style: "primary", label: "فتح تذكرة", customId: "ticket:open" },
    { type: "button", label: "Docs", url: "https://zrzur.cc" },
    { type: "select", customId: "pick", options: [{ label: "A", value: "a" }] },
    ...Array.from({ length: 6 }, (_, i) => ({ type: "button", label: `${i}`, customId: `b${i}` })),
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].components[0], {
    type: "Button",
    style: "Primary",
    label: "فتح تذكرة",
    emoji: undefined,
    custom_id: "ticket:open",
    url: undefined,
    disabled: undefined,
    restrict: undefined,
  });
  assert.equal(rows[0].components[1].style, "Link");
  assert.equal(rows[1].components[0].type, "StringSelect");
  assert.equal(rows[2].components.length, 5);
  assert.equal(rows[3].components.length, 1);
});

test("modals from friendly fields", () => {
  const modal = toModal({
    customId: "ticket:form",
    title: "تذكرة",
    fields: [{ type: "textInput", customId: "topic", label: "الموضوع", style: "paragraph" }],
  });
  assert.equal(modal.custom_id, "ticket:form");
  // friendly fields become labelled fields
  assert.equal(modal.components[0].type, "Field");
  assert.equal(modal.components[0].label, "الموضوع");
  assert.equal(modal.components[0].component.style, "Paragraph");
});

test("forms with every field kind and a paragraph", () => {
  const modal = toModal({
    customId: "survey",
    title: "استبيان",
    fields: [
      { type: "text", content: "تصل الإجابات إلى البوت فقط." },
      { type: "radio", customId: "class", label: "الفئة", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
      { type: "checkboxes", customId: "days", label: "الأيام", description: "اختر ما يناسبك", options: [{ label: "Mon", value: "mon" }] },
      { type: "checkbox", customId: "agree", label: "أوافق" },
      { type: "fileUpload", customId: "shot", label: "صورة", fileTypes: ["image"], maxValues: 3 },
      { type: "userSelect", customId: "who", label: "من؟" },
    ],
  });
  assert.deepEqual(
    modal.components.map((b) => (b.type === "Field" ? b.component.type : b.type)),
    ["Text", "RadioGroup", "CheckboxGroup", "Checkbox", "FileUpload", "UserSelect"],
  );
  assert.equal(modal.components[2].description, "اختر ما يناسبك");
  assert.deepEqual(modal.components[4].component.file_types, ["image"]);
});

test("layout blocks stand on their own; loose buttons still pack into rows", () => {
  const blocks = toBlocks([
    {
      type: "container",
      accent: "#9075FF",
      components: [
        { type: "text", content: "## مرحباً" },
        { type: "section", text: "اختر خطة", button: { type: "button", customId: "plan", label: "خطة" } },
        { type: "separator", spacing: "large" },
        { type: "gallery", items: ["https://zrzur.cc/a.png", { attachment: "x", spoiler: true }] },
        { type: "button", customId: "yes", label: "نعم" },
        { type: "button", customId: "no", label: "لا" },
      ],
    },
    { type: "button", customId: "top", label: "Top" },
  ]);
  assert.equal(blocks.length, 2);
  const card = blocks[0];
  assert.equal(card.type, "Container");
  assert.deepEqual(
    card.components.map((b) => b.type),
    ["Text", "Section", "Separator", "Gallery", "ActionRow"],
  );
  assert.deepEqual(card.components[1].text, ["اختر خطة"]);
  assert.equal(card.components[1].button.type, "Button");
  assert.equal(card.components[2].spacing, "Large");
  assert.deepEqual(card.components[3].items[0], { url: "https://zrzur.cc/a.png" });
  assert.equal(card.components[4].components.length, 2);
  assert.equal(blocks[1].type, "ActionRow");
});

test("commands are routed and answered once", async () => {
  const { bot, fetch } = await readyBot([{ status: 204 }]);
  let handled;
  bot.command("hello", async (i) => {
    handled = i;
    await i.reply("أهلاً بك في زرزور!");
    await assert.rejects(() => i.reply("again"), InteractionAlreadyRepliedError);
  });
  FakeSocket.last.push({
    type: "InteractionCreate",
    interaction: interaction({ type: "Command", command: { id: "C", name: "hello", type: "ChatInput", version: "v", options: [{ name: "name", type: "String", value: "Sami" }] } }),
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(handled.option("name"), "Sami");
  const call = fetch.calls.at(-1);
  assert.equal(call.url, `http://127.0.0.1:1/interactions/${ID}/secret-token/callback`);
  assert.deepEqual(call.body, {
    type: "Message",
    data: { content: "أهلاً بك في زرزور!", ephemeral: false },
  });
  bot.destroy();
});

test("components match by prefix, autocomplete answers automatically", async () => {
  const { bot, fetch } = await readyBot([{ status: 204 }, { status: 204 }]);
  let closed;
  bot.component("ticket:", async (i) => {
    closed = i.customId;
    await i.update({ content: "closed", components: [] });
  });
  bot.autocomplete("city", "name", (i) => [{ name: i.focused.value + "شق", value: "damascus" }]);

  FakeSocket.last.push({
    type: "InteractionCreate",
    interaction: interaction({ type: "Component", component: { custom_id: "ticket:close:7", component_type: "Button" } }),
  });
  FakeSocket.last.push({
    type: "InteractionCreate",
    interaction: interaction({
      type: "Autocomplete",
      command: { id: "C", name: "city", type: "ChatInput", version: "v", focused: "name", options: [{ name: "name", type: "String", value: "دم" }] },
    }),
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, "ticket:close:7");
  const bodies = fetch.calls.slice(-2).map((c) => c.body);
  assert.equal(bodies[0].type, "UpdateMessage");
  assert.deepEqual(bodies[0].data.components, []);
  assert.deepEqual(bodies[1], { type: "AutocompleteResult", choices: [{ name: "دمشق", value: "damascus" }] });
  bot.destroy();
});

test("API errors are typed and never contain the interaction token", async () => {
  const { bot } = await readyBot([{ status: 410, body: { type: "InteractionExpired" } }]);
  let failure;
  bot.command("slow", async (i) => {
    try {
      await i.reply("late");
    } catch (error) {
      failure = error;
    }
  });
  FakeSocket.last.push({
    type: "InteractionCreate",
    interaction: interaction({ type: "Command", command: { id: "C", name: "slow", type: "ChatInput", version: "v" } }),
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(failure instanceof ApiError);
  assert.equal(failure.type, "InteractionExpired");
  assert.equal(failure.status, 410);
  assert.ok(!failure.message.includes("secret-token"));
  bot.destroy();
});

test("rate limits are waited out", async () => {
  const { bot, fetch } = await readyBot([
    { status: 429, headers: { "x-ratelimit-reset-after": "20" }, body: { retry_after: 20 } },
    { body: [] },
  ]);
  const commands = await bot.syncCommands([{ name: "hello", description: "Hi" }]);
  assert.deepEqual(commands, []);
  assert.equal(fetch.calls.filter((c) => c.method === "PUT").length, 2);
  bot.destroy();
});

test("EmbedBuilder builds author, fields, footer and time", () => {
  const embed = new EmbedBuilder()
    .author("Zrzur", { iconUrl: "https://zrzur.cc/icon.png" })
    .title("Stats")
    .field("Members", "42", true)
    .fields({ name: "Online", value: "7", inline: true }, { name: "Note", value: "Hi" })
    .thumbnail("file1")
    .footer("Updated")
    .timestamp(0)
    .toJSON();
  assert.deepEqual(embed.author, { name: "Zrzur", icon_url: "https://zrzur.cc/icon.png" });
  assert.deepEqual(embed.fields, [
    { name: "Members", value: "42", inline: true },
    { name: "Online", value: "7", inline: true },
    { name: "Note", value: "Hi" },
  ]);
  assert.equal(embed.thumbnail, "file1");
  assert.deepEqual(embed.footer, { text: "Updated" });
  assert.equal(embed.timestamp, "1970-01-01T00:00:00.000Z");

  const full = new EmbedBuilder();
  for (let i = 0; i < 25; i++) full.field(`f${i}`, "v");
  assert.throws(() => full.field("one more", "v"), RangeError);
});

test("commandMention writes the clickable form", () => {
  assert.equal(commandMention("emoji add", "01HZZZZZZZZZZZZZZZZZZZZZZZ"), "</emoji add:01HZZZZZZZZZZZZZZZZZZZZZZZ>");
  assert.equal(commandMention("ping", { _id: "X" }), "</ping:X>");
});

test("follow-ups can be sent, edited and deleted by id", async () => {
  const { bot, fetch } = await readyBot([
    { status: 204 },
    { body: { _id: "F1", ephemeral: true } },
    { status: 204 },
    { status: 204 },
  ]);
  let done;
  bot.component("score", async (i) => {
    await i.deferUpdate();
    const followup = await i.followUp({ content: "1", ephemeral: true });
    await i.editFollowUp(followup._id, { embeds: [new EmbedBuilder().title("2")] });
    await i.deleteFollowUp(followup._id);
    done = followup;
  });
  FakeSocket.last.push({
    type: "InteractionCreate",
    interaction: interaction({ type: "Component", component: { custom_id: "score", component_type: "Button" } }),
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(done, { _id: "F1", ephemeral: true });
  const [edit, remove] = fetch.calls.slice(-2);
  assert.equal(edit.method, "PATCH");
  assert.equal(edit.url, `http://127.0.0.1:1/interactions/${ID}/secret-token/messages/F1`);
  assert.equal(edit.body.embeds[0].title, "2");
  assert.equal(edit.body.ephemeral, undefined);
  assert.equal(remove.method, "DELETE");
  assert.equal(remove.url, `http://127.0.0.1:1/interactions/${ID}/secret-token/messages/F1`);
  bot.destroy();
});

test("send and editMessage take embed builders", async () => {
  const { bot, fetch } = await readyBot([{ body: { _id: "M" } }, { body: { _id: "M" } }]);
  await bot.send("CHANNEL", { embeds: [new EmbedBuilder().title("نتيجة").colour("#E0195F")] });
  await bot.editMessage("CHANNEL", "M", { embeds: [new EmbedBuilder().title("تحديث")] });
  const [sent, edited] = fetch.calls.slice(-2);
  assert.equal(sent.body.embeds[0].title, "نتيجة");
  assert.equal(sent.body.embeds[0].colour, "#E0195F");
  assert.equal(edited.body.embeds[0].title, "تحديث");
  bot.destroy();
});

test("webhook overrides use the common field names; the token stays out of errors", async () => {
  const { bot, fetch } = await readyBot([
    { body: { _id: "M" } },
    { body: { _id: "M" } },
    { body: { id: "W", name: "hook", creator_id: "BOT", channel_id: "CH", permissions: 0, token: "new-secret", url: "http://a/webhooks/W/new-secret" } },
    { body: [] },
    { body: { _id: "M" } },
    { status: 404, body: { type: "NotFound" } },
  ]);
  const hook = { id: "W", token: "old-secret" };
  await bot.webhooks.send(hook, "hi", {
    username: "Release Bot",
    avatarUrl: "https://example.com/a.png",
    threadId: "T1",
    allowedMentions: { parse: [] },
  });
  const sent = fetch.calls.at(-1);
  assert.ok(sent.url.endsWith("/webhooks/W/old-secret?wait=true&thread_id=T1"), sent.url);
  assert.equal(sent.body.username, "Release Bot");
  assert.equal(sent.body.avatar_url, "https://example.com/a.png");
  assert.deepEqual(sent.body.allowed_mentions, { parse: [] });

  await bot.webhooks.send(hook, { content: "quiet", silent: true });
  assert.equal(fetch.calls.at(-1).body.flags, 4096);

  const fresh = await bot.webhooks.regenerateToken("W");
  assert.equal(fresh.token, "new-secret");
  assert.ok(fetch.calls.at(-1).url.endsWith("/webhooks/W/token"));

  await bot.webhooks.listForServer("SRV");
  assert.ok(fetch.calls.at(-1).url.endsWith("/servers/SRV/webhooks"));

  await bot.webhooks.fetchMessage(hook, "M1");
  assert.ok(fetch.calls.at(-1).url.endsWith("/webhooks/W/old-secret/messages/M1"));

  const error = await bot.webhooks.fetchMessage(hook, "M2").catch((e) => e);
  assert.ok(error instanceof ApiError);
  assert.ok(!error.message.includes("old-secret"), error.message);
  assert.throws(() => bot.webhooks.fetchMessage({ id: "W" }, "M"), TypeError);
  bot.destroy();
});

test("webhooks and single commands use the right routes; tokens stay out of errors", async () => {
  const { bot, fetch } = await readyBot([
    { body: { id: "W", name: "hook", creator_id: "BOT", channel_id: "CH", permissions: 0, token: "webhook-secret" } },
    { body: { _id: "M1" } },
    { body: { _id: "C1" } },
    { status: 204 },
    { status: 404, body: { type: "NotFound" } },
  ]);
  const hook = await bot.webhooks.create("CH", { name: "hook" });
  await bot.webhooks.send(hook, { content: "via hook" });
  await bot.createCommand({ name: "ping", description: "Pong" }, { serverId: "SRV" });
  await bot.deleteCommand("C1");
  const error = await bot.webhooks.deleteMessage(hook, "M1").catch((e) => e);
  const calls = fetch.calls.slice(-5).map((c) => `${c.method} ${c.url.replace("http://127.0.0.1:1", "")}`);
  assert.deepEqual(calls, [
    "POST /channels/CH/webhooks",
    "POST /webhooks/W/webhook-secret?wait=true",
    "POST /applications/BOT/servers/SRV/commands",
    "DELETE /applications/BOT/commands/C1",
    "DELETE /webhooks/W/webhook-secret/messages/M1",
  ]);
  assert.ok(error instanceof ApiError);
  assert.ok(!error.message.includes("webhook-secret"), error.message);
  assert.throws(() => bot.webhooks.send({ id: "W" }, "x"), TypeError);
  bot.destroy();
});

test("permission checks on an interaction", async () => {
  const { bot } = await readyBot([]);
  let checks;
  bot.on("interactionCreate", (i) => {
    checks = [i.memberPermissions, i.has(2 ** 20), i.has(2 ** 20 | 2 ** 6), i.has(2 ** 6, "app")];
  });
  FakeSocket.last.push({
    type: "InteractionCreate",
    interaction: interaction({ type: "Component", user_permissions: 2 ** 20, app_permissions: 2 ** 6, component: { custom_id: "x", component_type: "Button" } }),
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(checks, [2 ** 20, true, false, true]);
  bot.destroy();
});

test("new Client() with the token in login(), Zrzur's addresses by default", async () => {
  const fetch = fakeFetch([{ body: { _id: "BOT", username: "bot" } }]);
  const client = new Client({ fetch, WebSocket: FakeSocket });
  await assert.rejects(() => new Client({ fetch, WebSocket: FakeSocket }).login(), TypeError);
  const login = client.login("late-token");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fetch.calls[0].url, "https://api.zrzur.com/users/@me");
  assert.equal(fetch.calls[0].headers["x-bot-token"], "late-token");
  assert.equal(FakeSocket.last.url.startsWith("wss://events.zrzur.com"), true);
  assert.deepEqual(FakeSocket.last.sent[0], { type: "Authenticate", token: "late-token" });
  FakeSocket.last.push({ type: "Ready" });
  await login;
  assert.equal(client.user.id, "BOT");
  client.destroy();
});

test("tickets: a channel in a category, opened for one member", async () => {
  const { bot, fetch } = await readyBot([
    { body: { _id: "SRV", owner: "O", name: "s", channels: [], categories: [{ id: "OTHER", title: "Other", channels: [] }] } },
    { body: { _id: "SRV" } },
    { body: { _id: "CH", channel_type: "TextChannel" } },
    { body: { _id: "CH" } },
    { body: { _id: "CH" } },
    { body: { _id: "SRV", owner: "O", name: "s", channels: [], categories: [{ id: "T1", title: "Tickets", channels: [] }] } },
  ]);
  const category = await bot.servers.ensureCategory("SRV", "Tickets");
  await bot.channels.create("SRV", { name: "ticket-0001", category });
  await bot.channels.setMemberPermissions("CH", "U1", 2 ** 20 | 2 ** 22);
  await bot.channels.setMemberPermissions("CH", "U1", 0, 0);
  assert.equal(await bot.servers.ensureCategory("SRV", "tickets"), "T1");
  const calls = fetch.calls.slice(-6);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.replace("http://127.0.0.1:1", "")}`),
    [
      "GET /servers/SRV",
      "PATCH /servers/SRV",
      "POST /servers/SRV/channels",
      "PUT /channels/CH/permissions/members/U1",
      "PUT /channels/CH/permissions/members/U1",
      "GET /servers/SRV",
    ],
  );
  const added = calls[1].body.categories;
  assert.equal(added.length, 2);
  assert.equal(added[0].id, "OTHER");
  assert.equal(added[1].title, "Tickets");
  assert.equal(added[1].id, category);
  assert.match(category, /^[0-9A-Z]{26}$/);
  assert.equal(calls[2].body.category, category);
  assert.deepEqual(calls[3].body, { permissions: { allow: 2 ** 20 | 2 ** 22, deny: 0 } });
  bot.destroy();
});

test("a missing permission is named in the error", async () => {
  const { bot } = await readyBot([{ status: 403, body: { type: "MissingPermission", permission: "MentionRoles" } }]);
  const error = await bot.send("CH", "<%ROLE> hello").catch((e) => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.detail, "needs MentionRoles");
  assert.match(error.message, /403 MissingPermission: needs MentionRoles/);
  bot.destroy();
});

test("intents go in Authenticate; a refused one fails login without retrying", async () => {
  const fetch = fakeFetch([{ body: { _id: "BOT", username: "bot" } }]);
  const client = new Client({ fetch, WebSocket: FakeSocket, intents: [Intents.Default, Intents.MessageContent] });
  const login = client.login("t");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(FakeSocket.last.sent[0], { type: "Authenticate", token: "t", intents: 63 | 1024 });
  const socket = FakeSocket.last;
  socket.emit("close", { code: 4014, reason: "Disallowed intents: MESSAGE_CONTENT" });
  await assert.rejects(login, /MESSAGE_CONTENT.*developer portal/);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(FakeSocket.last, socket, "no reconnect after 4014");
  client.destroy();
});

test("without intents the server picks the free ones", async () => {
  const fetch = fakeFetch([{ body: { _id: "BOT", username: "bot" } }]);
  const client = new Client({ fetch, WebSocket: FakeSocket });
  const login = client.login("t");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(FakeSocket.last.sent[0].intents, undefined);
  assert.equal(Intents.Default, 63);
  FakeSocket.last.push({ type: "Ready" });
  await login;
  client.destroy();
});

test("a global limit pauses every request until it resets", async () => {
  const fetch = fakeFetch([
    { body: { _id: "BOT", username: "bot" } },
    { status: 429, headers: { "x-ratelimit-reset-after": "300", "x-ratelimit-global": "true" }, body: { retry_after: 300 } },
    { body: { _id: "A" } },
    { body: { _id: "B" } },
  ]);
  const bot = new Client({ fetch, WebSocket: FakeSocket, token: "t" });
  await bot.rest.req("get", "/users/@me");
  const started = Date.now();
  const first = bot.rest.req("get", "/one");
  await new Promise((r) => setTimeout(r, 30));
  // a second request made while the first waits also waits for the reset
  const second = bot.rest.req("get", "/two");
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a._id, "A");
  assert.equal(b._id, "B");
  const urls = fetch.calls.map((c) => new URL(c.url).pathname);
  assert.deepEqual(urls.slice(1), ["/one", "/one", "/two"]);
  assert.ok(Date.now() - started >= 300);
});
