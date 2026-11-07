// Bot platform: command builders, interaction answers, permissions as strings.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Interaction,
  InteractionAlreadyRepliedError,
  InteractionNotRepliedError,
  SlashCommandBuilder,
  contextCommand,
} from "../../lib/bot/index.js";

/** A fake REST client that records every request */
function fakeRest() {
  const calls = [];
  return {
    calls,
    async req(method, path, body) {
      calls.push({ method, path, body });
      return { _id: "M1", ephemeral: false };
    },
  };
}

function raw(extra = {}) {
  return {
    _id: "I1",
    version: 1,
    application_id: "B1",
    type: "Command",
    token: "T1",
    user: { _id: "U1", username: "sami" },
    channel_id: "C1",
    user_permissions: 8,
    app_permissions: 8,
    ...extra,
  };
}

test("slash commands carry ar/en/de names and descriptions", () => {
  const json = new SlashCommandBuilder("hello", "Say hello")
    .names({ ar: "مرحبا", de: "hallo" })
    .describe({ ar: "قل مرحبا", de: "Sag hallo" })
    .string("name", "Who", {
      names: { ar: "الاسم" },
      descriptions: { ar: "من" },
    })
    .toJSON();
  assert.equal(json.name_localizations.ar, "مرحبا");
  assert.equal(json.description_localizations.de, "Sag hallo");
  assert.equal(json.options[0].name_localizations.ar, "الاسم");
});

test("required options move before optional ones", () => {
  const json = new SlashCommandBuilder("x", "x")
    .string("a", "a")
    .string("b", "b", { required: true })
    .toJSON();
  assert.deepEqual(
    json.options.map((o) => o.name),
    ["b", "a"],
  );
});

test("sub-commands and groups nest the way the server expects", () => {
  const json = new SlashCommandBuilder("config", "Settings")
    .subcommandGroup("roles", "Roles", (g) =>
      g.subcommand("add", "Add", (s) => s.role("role", "Which", { required: true })),
    )
    .subcommand("show", "Show")
    .toJSON();
  const group = json.options.find((o) => o.type === "SubCommandGroup");
  assert.equal(group.options[0].type, "SubCommand");
  assert.equal(group.options[0].options[0].type, "Role");
  assert.equal(json.options.find((o) => o.name === "show").type, "SubCommand");
});

test("autocomplete option and context menu commands", () => {
  const json = new SlashCommandBuilder("play", "Play")
    .string("song", "Song", { autocomplete: true })
    .toJSON();
  assert.equal(json.options[0].autocomplete, true);
  const menu = contextCommand("Message", "Translate", { ar: "ترجم" });
  assert.deepEqual(menu, {
    type: "Message",
    name: "Translate",
    name_localizations: { ar: "ترجم" },
  });
});

test("reply, defer, follow-ups and edits hit the right routes", async () => {
  const rest = fakeRest();
  const i = new Interaction(raw(), rest);
  await assert.rejects(() => i.editReply({ content: "x" }), InteractionNotRepliedError);
  await i.defer({ ephemeral: true });
  assert.equal(rest.calls[0].path, "/interactions/I1/T1/callback");
  assert.equal(rest.calls[0].body.type, "DeferredMessage");
  assert.equal(rest.calls[0].body.data.ephemeral, true);
  assert.equal(i.deferred, true);
  assert.equal(i.ephemeral, true);
  await assert.rejects(() => i.reply({ content: "again" }), InteractionAlreadyRepliedError);
  await i.editReply({ content: "done" });
  assert.equal(rest.calls[1].method, "patch");
  assert.equal(rest.calls[1].path, "/interactions/I1/T1/original");
  await i.followUp({ content: "more", ephemeral: true });
  assert.equal(rest.calls[2].path, "/interactions/I1/T1/followups");
  assert.equal(rest.calls[2].body.ephemeral, true);
  await i.editFollowUp("M1", { content: "edited" });
  assert.equal(rest.calls[3].path, "/interactions/I1/T1/messages/M1");
  await i.deleteFollowUp("M1");
  assert.equal(rest.calls[4].method, "delete");
});

test("a failed callback can be tried again", async () => {
  let fail = true;
  const rest = {
    async req() {
      if (fail) throw new Error("network");
      return {};
    },
  };
  const i = new Interaction(raw(), rest);
  await assert.rejects(() => i.reply({ content: "x" }), /network/);
  fail = false;
  await i.reply({ content: "x" });
  assert.equal(i.replied, true);
});

test("autocomplete answers at most 25 suggestions", async () => {
  const rest = fakeRest();
  const i = new Interaction(
    raw({ type: "Autocomplete", command: { id: "c", name: "play", type: "ChatInput", version: "1", focused: "song", options: [{ name: "song", type: "String", value: "ba" }] } }),
    rest,
  );
  assert.deepEqual(i.focused, { name: "song", value: "ba" });
  await i.respond(Array.from({ length: 40 }, (_, n) => ({ name: `s${n}`, value: `s${n}` })));
  assert.equal(rest.calls[0].body.type, "AutocompleteResult");
  assert.equal(rest.calls[0].body.choices.length, 25);
  assert.equal(i.isRepliable(), false);
});

test("modal round trip: showModal sends the form, submit fields are read", async () => {
  const rest = fakeRest();
  const i = new Interaction(raw({ type: "Component", component: { custom_id: "b", component_type: "Button" } }), rest);
  await i.showModal({
    customId: "feedback",
    title: "Feedback",
    fields: [{ type: "textInput", customId: "text", label: "Text" }],
  });
  assert.equal(rest.calls[0].body.type, "Modal");
  assert.equal(rest.calls[0].body.modal.custom_id, "feedback");
  const submit = new Interaction(
    raw({ type: "ModalSubmit", modal: { custom_id: "feedback", fields: [{ custom_id: "text", value: "hi" }] } }),
    rest,
  );
  assert.equal(submit.field("text"), "hi");
  assert.equal(submit.fields.getTextInputValue("text"), "hi");
  assert.throws(() => submit.fields.getTextInputValue("missing"), TypeError);
});

test("context menu target is exposed", () => {
  const i = new Interaction(
    raw({ command: { id: "c", name: "Translate", type: "Message", version: "1", target_id: "MSG1" } }),
    fakeRest(),
  );
  assert.equal(i.targetId, "MSG1");
});

test("permissions: strings keep bits above 2^53", () => {
  const big = (1n << 60n) | 8n;
  const i = new Interaction(
    raw({ user_permissions: Number(big), user_permissions_string: big.toString(), app_permissions_string: "8" }),
    fakeRest(),
  );
  assert.equal(i.memberPermissionsString, big.toString());
  assert.equal(i.appPermissionsString, "8");
  assert.equal(i.has(1n << 60n), true);
  assert.equal(i.has((1n << 60n) + 1n), false);
  assert.equal(i.has(8, "app"), true);
});

test("permissions: older servers without strings still work", () => {
  const i = new Interaction(raw(), fakeRest());
  assert.equal(i.memberPermissionsString, "8");
  assert.equal(i.has(8), true);
});
