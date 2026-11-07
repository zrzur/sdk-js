// Component builders, enums, interaction helpers and collectors. `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  Events,
  InteractionAlreadyRepliedError,
  InteractionCollectorError,
  InteractionNotRepliedError,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  Client,
  toBlocks,
} from "../../lib/bot/index.js";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const MSG = "01ARZ3NDEKTSV4RRFFQ69G5MSG";

function fakeFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift() ?? { status: 204 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  fn.calls = calls;
  return fn;
}
class FakeSocket {
  static last;
  listeners = {};
  sent = [];
  constructor() {
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
async function readyBot(responses = []) {
  const fetch = fakeFetch([{ body: { _id: "BOT", username: "bot" } }, ...responses]);
  const errors = [];
  const bot = new Client({ token: "t", apiUrl: "http://api", wsUrl: "ws://ws", fetch, WebSocket: FakeSocket, onError: (e) => errors.push(e) });
  const login = bot.login();
  await new Promise((r) => setTimeout(r, 10));
  FakeSocket.last.push({ type: "Ready" });
  await login;
  return { bot, fetch, errors };
}
let n = 0;
const click = (extra = {}) => ({
  _id: `01ARZ3NDEKTSV4RRFFQ69G${String(n++).padStart(4, "0")}`,
  version: 1,
  application_id: "BOT",
  token: "tok",
  type: "Component",
  user: { _id: extra.userId ?? "USER", username: "sami" },
  channel_id: "CH",
  server_id: "SRV",
  message_id: MSG,
  user_permissions: 0,
  app_permissions: 0,
  respond_by: new Date().toISOString(),
  expires_at: new Date().toISOString(),
  component: { custom_id: extra.customId ?? "next", component_type: extra.componentType ?? "Button", values: extra.values },
  ...extra.raw,
});
const push = (raw) => FakeSocket.last.push({ type: "InteractionCreate", interaction: raw });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("enums have fixed numbers", () => {
  assert.deepEqual([ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Success, ButtonStyle.Danger, ButtonStyle.Link], [1, 2, 3, 4, 5]);
  assert.equal(ComponentType.ActionRow, 1);
  assert.equal(ComponentType.Button, 2);
  assert.equal(ComponentType.StringSelect, 3);
  assert.equal(ComponentType.TextInput, 4);
  assert.equal(ComponentType.ChannelSelect, 8);
  assert.equal(TextInputStyle.Paragraph, 2);
  assert.equal(MessageFlags.Ephemeral, 64);
  assert.equal(Events.InteractionCreate, "interactionCreate");
});

test("a built button row becomes the wire format", () => {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(),
    new ButtonBuilder().setCustomId("next").setLabel("Next").setStyle(ButtonStyle.Primary).setEmoji({ name: "▶️" }),
    new ButtonBuilder().setLabel("Docs").setURL("https://zrzur.com").setStyle(ButtonStyle.Link),
  );
  const wire = JSON.parse(JSON.stringify(toBlocks([row])));
  assert.deepEqual(wire[0].components.map((c) => [c.style, c.custom_id ?? c.url, c.disabled ?? false]), [
    ["Secondary", "prev", true],
    ["Primary", "next", false],
    ["Link", "https://zrzur.com", false],
  ]);
  assert.equal(wire[0].components[1].emoji, "▶️");
});

test("button mistakes are caught before sending", () => {
  assert.throws(() => new ButtonBuilder().setLabel("x").setStyle(ButtonStyle.Primary).toJSON(), TypeError);
  assert.throws(() => new ButtonBuilder().setCustomId("x").setLabel("x").setURL("https://a.b").setStyle(ButtonStyle.Link).toJSON(), TypeError);
  assert.throws(() => new ButtonBuilder().setCustomId("x").setStyle(ButtonStyle.Primary).toJSON(), TypeError, "no label or emoji");
  assert.throws(() => new ButtonBuilder().setStyle(6), RangeError, "unknown style");
  // a custom emoji in its text form keeps its id
  assert.equal(new ButtonBuilder().setEmoji("<:zrzur:01ARZ3NDEKTSV4RRFFQ69G5FAV>").data.emoji, ID);
});

test("disable every button at the end with ActionRowBuilder.from", () => {
  const message = {
    components: toBlocks([
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("a").setLabel("A").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("b").setLabel("B").setStyle(ButtonStyle.Danger),
      ),
    ]),
  };
  const disabled = message.components.map((row) => {
    const copy = ActionRowBuilder.from(row);
    copy.components.forEach((c) => c.setDisabled(true));
    return copy;
  });
  const wire = toBlocks(disabled);
  assert.ok(wire[0].components.every((c) => c.disabled === true));
  assert.deepEqual(wire[0].components.map((c) => c.style), ["Primary", "Danger"]);
  assert.equal(ButtonBuilder.from(message.components[0].components[1]).toJSON().custom_id, "b");
});

test("menus from builders, with Zrzur's limits checked", () => {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("map")
    .setPlaceholder("Pick a map")
    .setMinValues(1)
    .setMaxValues(2)
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Dust").setValue("dust").setDescription("Long corridors").setEmoji("🏜️"),
      { label: "Harbor", value: "harbor", default: true, emoji: { name: "⚓" } },
    );
  const [row] = toBlocks([new ActionRowBuilder().addComponents(menu)]);
  const wire = row.components[0];
  assert.equal(wire.type, "StringSelect");
  assert.deepEqual(wire.options.map((o) => [o.value, o.emoji, o.default ?? false]), [
    ["dust", "🏜️", false],
    ["harbor", "⚓", true],
  ]);
  assert.throws(() => toBlocks([new StringSelectMenuBuilder().setCustomId("x").addOptions(Array.from({ length: 26 }, (_, i) => ({ label: `${i}`, value: `${i}` })))]), RangeError);

  const channels = new ChannelSelectMenuBuilder().setCustomId("c").setChannelTypes(ChannelType.GuildVoice).toJSON();
  assert.deepEqual(channels.channel_types, ["Voice"]);
  assert.throws(() => new ChannelSelectMenuBuilder().setChannelTypes(15), RangeError, "forums don't exist");
  assert.deepEqual(new UserSelectMenuBuilder().setCustomId("u").setDefaultUsers([ID]).setMaxValues(2).toJSON().default_values, [ID]);
  assert.deepEqual(new RoleSelectMenuBuilder().setCustomId("r").addDefaultRoles(ID).toJSON().default_values, [ID]);
});

test("modals from builders, old rows and new labels", () => {
  const old = new ModalBuilder()
    .setCustomId("report")
    .setTitle("Report")
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("why").setLabel("Why?").setStyle(TextInputStyle.Paragraph).setRequired(true)))
    .toJSON();
  assert.equal(old.components[0].type, "ActionRow");
  assert.equal(old.components[0].components[0].style, "Paragraph");
  assert.equal(old.components[0].components[0].label, "Why?");

  const labelled = new ModalBuilder()
    .setCustomId("signup")
    .setTitle("Sign up")
    .addLabelComponents(new LabelBuilder().setLabel("Nickname").setDescription("2-20 letters").setTextInputComponent((t) => t.setCustomId("nick").setStyle(TextInputStyle.Short)))
    .toJSON();
  assert.deepEqual(labelled.components[0], {
    type: "Field",
    label: "Nickname",
    description: "2-20 letters",
    component: { type: "TextInput", custom_id: "nick", style: "Short" },
  });
});

test("interaction helpers and type guards", async () => {
  const { bot } = await readyBot([{ status: 204 }]);
  let seen;
  bot.on(Events.InteractionCreate, async (i) => {
    seen = {
      button: i.isButton(),
      menu: i.isAnySelectMenu(),
      component: i.isMessageComponent(),
      chat: i.isChatInputCommand(),
      repliable: i.isRepliable(),
      inGuild: i.inGuild(),
      type: i.componentType,
      guildId: i.guildId,
      created: i.createdAt instanceof Date,
    };
    assert.equal(i.deferred, false);
    await assert.rejects(() => i.editReply("too early"), InteractionNotRepliedError);
    assert.throws(() => i.followUp("too early"), InteractionNotRepliedError);
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    seen.after = { deferred: i.deferred, replied: i.replied, ephemeral: i.ephemeral };
    await assert.rejects(() => i.reply("again"), InteractionAlreadyRepliedError);
  });
  push(click());
  await tick();
  assert.deepEqual(seen, {
    button: true, menu: false, component: true, chat: false, repliable: true, inGuild: true,
    type: ComponentType.Button, guildId: "SRV", created: true,
    after: { deferred: true, replied: false, ephemeral: true },
  });
  bot.destroy();
});

test("menu interactions expose values and resolved collections", async () => {
  const { bot } = await readyBot();
  let seen;
  bot.on("interactionCreate", (i) => {
    seen = { menu: i.isUserSelectMenu(), any: i.isAnySelectMenu(), values: i.values, user: i.users.get(ID)?.username, member: i.members.has(ID) };
  });
  push(click({ customId: "who", componentType: "UserSelect", values: [ID], raw: {} }));
  // resolved arrives with the component
  push({ ...click({ customId: "who", componentType: "UserSelect", values: [ID] }), component: { custom_id: "who", component_type: "UserSelect", values: [ID], resolved: { users: { [ID]: { _id: ID, username: "falcon" } }, members: { [ID]: { _id: { user: ID } } } } } });
  await tick();
  assert.deepEqual(seen, { menu: true, any: true, values: [ID], user: "falcon", member: true });
  bot.destroy();
});

test("form fields: getTextInputValue and a missing field throws", async () => {
  const { bot } = await readyBot();
  let value, error;
  bot.on("interactionCreate", (i) => {
    if (!i.isModalSubmit()) return;
    value = i.fields.getTextInputValue("why");
    try {
      i.fields.getTextInputValue("nope");
    } catch (e) {
      error = e;
    }
  });
  push({ ...click(), type: "ModalSubmit", component: undefined, modal: { custom_id: "report", fields: [{ custom_id: "why", value: "spam" }] } });
  await tick();
  assert.equal(value, "spam");
  assert.ok(error instanceof TypeError);
  bot.destroy();
});

test("collectors: collect, ignore and end reasons", async () => {
  const { bot } = await readyBot([{ body: { _id: MSG, channel: "CH", components: [] } }]);
  const message = await bot.send("CH", { components: [new ButtonBuilder().setCustomId("next").setLabel("Next").setStyle(ButtonStyle.Primary)] });
  assert.equal(message.id, MSG);
  assert.ok(!Object.keys(message).includes("createMessageComponentCollector"), "helpers stay out of the JSON");

  const collected = [], ignored = [];
  let ended;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, filter: (i) => i.user._id === "USER", max: 2 });
  collector.on("collect", (i) => collected.push(i.customId));
  collector.on("ignore", (i) => ignored.push(i.user._id));
  collector.on("end", (all, reason) => (ended = { size: all.size, reason }));
  push(click({ userId: "OTHER" }));
  push(click({ raw: { message_id: "ELSEWHERE" } }));
  push(click({ componentType: "StringSelect", customId: "map", values: ["a"] }));
  push(click());
  push(click({ customId: "prev" }));
  push(click());
  await tick();
  assert.deepEqual(collected, ["next", "prev"]);
  assert.deepEqual(ignored, ["OTHER"]);
  assert.deepEqual(ended, { size: 2, reason: "limit" });

  const timed = bot.createMessageComponentCollector({ message: MSG, time: 30 });
  const timedEnd = new Promise((r) => timed.on("end", (_, reason) => r(reason)));
  assert.equal(await timedEnd, "time");

  const idle = bot.createMessageComponentCollector({ message: MSG, idle: 40 });
  const idleEnd = new Promise((r) => idle.on("end", (c, reason) => r([c.size, reason])));
  await tick(20);
  push(click());
  assert.deepEqual(await idleEnd, [1, "idle"]);

  const users = bot.createMessageComponentCollector({ message: MSG, maxUsers: 2 });
  const usersEnd = new Promise((r) => users.on("end", (c, reason) => r([c.size, reason])));
  push(click({ userId: "A" }));
  push(click({ userId: "A" }));
  push(click({ userId: "B" }));
  assert.deepEqual(await usersEnd, [3, "userLimit"]);

  const deleted = bot.createMessageComponentCollector({ message: MSG });
  const deletedEnd = new Promise((r) => deleted.on("end", (_, reason) => r(reason)));
  FakeSocket.last.push({ type: "MessageDelete", id: MSG, channel: "CH" });
  assert.equal(await deletedEnd, "messageDelete");

  const stopped = bot.createMessageComponentCollector({ message: MSG });
  const stoppedEnd = new Promise((r) => stopped.on("end", (_, reason) => r(reason)));
  stopped.stop();
  assert.equal(await stoppedEnd, "user");
  bot.destroy();
});

test("awaitMessageComponent resolves once, or rejects with the reason", async () => {
  const { bot } = await readyBot();
  const first = bot.awaitMessageComponent({ message: MSG, time: 500 });
  push(click({ customId: "yes" }));
  assert.equal((await first).customId, "yes");
  await assert.rejects(bot.awaitMessageComponent({ message: MSG, time: 20 }), (error) => error instanceof InteractionCollectorError && error.reason === "time" && /reason: time/.test(error.message));
  bot.destroy();
});

test("awaitModalSubmit needs a time and gets the form", async () => {
  const { bot } = await readyBot([{ status: 204 }]);
  let form;
  bot.on("interactionCreate", async (i) => {
    if (!i.isButton()) return;
    assert.throws(() => i.awaitModalSubmit({}), TypeError);
    await i.showModal(new ModalBuilder().setCustomId("m").setTitle("T").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("x").setLabel("X"))));
    form = await i.awaitModalSubmit({ time: 500, filter: (m) => m.customId === "m" });
  });
  push(click());
  await tick();
  push({ ...click(), type: "ModalSubmit", component: undefined, modal: { custom_id: "m", fields: [{ custom_id: "x", value: "ok" }] } });
  await tick();
  assert.equal(form.fields.getTextInputValue("x"), "ok");
  bot.destroy();
});

test("interaction.message.components follow the bot's own changes", async () => {
  const { bot } = await readyBot([{ body: { _id: MSG, channel: "CH" } }, { status: 204 }]);
  await bot.send("CH", { components: [new ButtonBuilder().setCustomId("next").setLabel("1").setStyle(ButtonStyle.Primary)] });
  let before, after;
  bot.on("interactionCreate", async (i) => {
    before = i.message.components[0]?.components[0]?.label;
    await i.update({ components: [new ButtonBuilder().setCustomId("next").setLabel("2").setStyle(ButtonStyle.Primary)] });
    after = i.message.components[0]?.components[0]?.label;
  });
  push(click());
  await tick();
  assert.equal(before, "1", "what the bot sent");
  assert.equal(after, "2", "what the bot changed it to");
  bot.destroy();
});

test("user.id reads the id without changing the JSON", async () => {
  const { bot } = await readyBot();
  let id, json;
  bot.on("interactionCreate", (i) => {
    id = i.user.id;
    json = JSON.stringify(i.user);
  });
  push(click({ userId: "PERSON" }));
  await tick();
  assert.equal(id, "PERSON");
  assert.ok(!json.includes('"id"'));
  bot.destroy();
});
