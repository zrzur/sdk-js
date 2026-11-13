// A complete bot: everything a community bot usually needs, in one file.
//
//   /match  a lobby with a rich embed and buttons; people join and leave,
//           the embed follows, and the buttons switch off when it starts
//   /poll   a vote with a menu, counted by a collector, closed by its author
//   /profile private settings: role and voice-channel menus, and a form
//   /scout  a slow answer: "thinking…" first, then the result
//   /announce posts for moderators only, with a private confirmation
//
// Run:  ZRZUR_BOT_TOKEN=... ZRZUR_SERVER_ID=... node examples/game-night.mjs
// (a local or self-hosted server also sets ZRZUR_API_URL and ZRZUR_WS_URL).
// In your own project, import from "@zrzur/sdk/bot".
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  Permissions,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "@zrzur/sdk/bot";

const client = new Client({ apiUrl: process.env.ZRZUR_API_URL, wsUrl: process.env.ZRZUR_WS_URL });
const MAPS = ["Dust", "Harbor", "Summit", "Foundry", "Skyline"];

// ---- /match: an embed that follows the buttons ---------------------------
const lobbies = new Map(); // message id → { host, map, size, players }

function lobbyEmbed(lobby) {
  const started = lobby.started;
  return new EmbedBuilder()
    .title(started ? `${lobby.map} · match started` : `${lobby.map} · ${lobby.players.length}/${lobby.size} players`)
    .description(
      lobby.players.length ? lobby.players.map((p, n) => `${n + 1}. <@${p}>`).join("\n") : "Nobody yet. Press Join.",
    )
    .colour(started ? "#55DCC8" : "#E0195F")
    .field("Map", lobby.map, true)
    .field("Host", `<@${lobby.host}>`, true)
    .field("Spots left", String(lobby.size - lobby.players.length), true)
    .footer(started ? "Good luck, have fun" : "The host starts the match")
    .timestamp();
}

function lobbyButtons(lobby) {
  const off = lobby.started;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("match:join").setLabel("Join").setEmoji("🎮").setStyle(ButtonStyle.Primary).setDisabled(off || lobby.players.length >= lobby.size),
    new ButtonBuilder().setCustomId("match:leave").setLabel("Leave").setStyle(ButtonStyle.Danger).setDisabled(off),
    new ButtonBuilder().setCustomId("match:start").setLabel("Start").setStyle(ButtonStyle.Success).setDisabled(off),
    new ButtonBuilder().setLabel("Rules").setURL("https://zrzur.com").setStyle(ButtonStyle.Link),
  );
}

client.command("match", async (i) => {
  const lobby = { host: i.user.id, map: i.option("map") ?? MAPS[0], size: i.option("size") ?? 5, players: [i.user.id], started: false };
  // the lobby is a message of its own, so its id is known
  const message = await client.send(i.channelId, { embeds: [lobbyEmbed(lobby)], components: [lobbyButtons(lobby)] });
  lobbies.set(message.id, lobby);
  await i.reply({ content: "Lobby open.", flags: MessageFlags.Ephemeral });
});
client.autocomplete("match", "map", (i) =>
  MAPS.filter((m) => m.toLowerCase().includes(i.focused.value.toLowerCase())).map((m) => ({ name: m, value: m })),
);

client.component("match:", async (i) => {
  const lobby = lobbies.get(i.messageId);
  if (!lobby) return i.reply({ content: "This lobby has closed.", flags: MessageFlags.Ephemeral });
  const me = i.user.id;
  if (i.customId === "match:join" && !lobby.players.includes(me)) lobby.players.push(me);
  if (i.customId === "match:leave") lobby.players = lobby.players.filter((p) => p !== me);
  if (i.customId === "match:start") {
    if (me !== lobby.host) return i.reply({ content: "Only the host can start the match.", flags: MessageFlags.Ephemeral });
    lobby.started = true;
  }
  await i.update({ embeds: [lobbyEmbed(lobby)], components: [lobbyButtons(lobby)] });
});

// ---- /poll: a menu counted by a collector -------------------------------
client.command("poll", async (i) => {
  const question = i.option("question");
  const choices = String(i.option("choices") ?? "Yes, No")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 25);
  const votes = new Map(); // user → choice
  const view = (closed = false) => {
    const counts = choices.map((c) => [c, [...votes.values()].filter((v) => v === c).length]);
    return {
      embeds: [
        new EmbedBuilder()
          .title(closed ? `Results: ${question}` : question)
          .description(counts.map(([c, n]) => `**${c}**: ${n}`).join("\n"))
          .colour(closed ? "#55DCC8" : "#64A9FF")
          .footer(`${votes.size} vote${votes.size === 1 ? "" : "s"}${closed ? " · closed" : ""}`),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("poll:vote")
            .setPlaceholder("Your vote")
            .setDisabled(closed)
            .addOptions(choices.map((c) => ({ label: c, value: c }))),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("poll:end").setLabel("End poll").setStyle(ButtonStyle.Secondary).setDisabled(closed),
        ),
      ],
    };
  };
  const message = await client.send(i.channelId, view());
  await i.reply({ content: "Poll started. It closes after 10 minutes.", flags: MessageFlags.Ephemeral });
  // everything clicked on this message, for 10 minutes
  const collector = message.createMessageComponentCollector({ time: 10 * 60_000 });
  collector.on("collect", async (c) => {
    if (c.customId === "poll:end") {
      if (c.user.id !== i.user.id) return c.reply({ content: "Only who started the poll can end it.", flags: MessageFlags.Ephemeral });
      collector.stop("ended");
      return c.update(view(true));
    }
    votes.set(c.user.id, c.values[0]);
    await c.update(view());
  });
  // time ran out: show the results and switch the menu off
  collector.on("end", async (_, reason) => {
    if (reason !== "ended") await client.editMessage(i.channelId, message.id, view(true)).catch(() => {});
  });
});

// ---- /profile: private menus and a form ----------------------------------
client.command("profile", (i) =>
  i.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [new EmbedBuilder().title("Your game profile").description("Pick what you play and where.").colour("#9C8CFF")],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId("profile:roles").setPlaceholder("Teams you play for").setMinValues(0).setMaxValues(3),
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId("profile:voice").setPlaceholder("Your usual voice channel").setChannelTypes(ChannelType.GuildVoice),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("profile:edit").setLabel("Edit gamer tag").setStyle(ButtonStyle.Primary),
      ),
    ],
  }),
);
client.component("profile:roles", (i) =>
  i.update({ content: `Teams saved: ${i.values.map((r) => i.roles.get(r)?.name ?? r).join(", ") || "none"}` }),
);
client.component("profile:voice", (i) => i.update({ content: `Voice channel saved: <#${i.values[0]}>` }));
client.component("profile:edit", (i) =>
  i.showModal(
    new ModalBuilder()
      .setCustomId("profile:form")
      .setTitle("Gamer tag")
      .addLabelComponents(
        new LabelBuilder().setLabel("Tag").setDescription("2 to 20 characters").setTextInputComponent((t) =>
          t.setCustomId("tag").setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(20),
        ),
        new LabelBuilder().setLabel("About you").setTextInputComponent(
          new TextInputBuilder().setCustomId("about").setStyle(TextInputStyle.Paragraph).setRequired(false),
        ),
      ),
  ),
);
client.modal("profile:form", (i) =>
  i.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [
      new EmbedBuilder()
        .title(`Tag saved: ${i.fields.getTextInputValue("tag")}`)
        .description(i.fields.getTextInputValue("about") || "No description.")
        .colour("#55DCC8"),
    ],
  }),
);

// ---- /scout: a slow answer ------------------------------------------------
client.command("scout", async (i) => {
  await i.deferReply(); // people see "Game Night is thinking…"
  await new Promise((r) => setTimeout(r, 2000));
  await i.editReply({
    embeds: [
      new EmbedBuilder()
        .title(`Scouting report: ${i.option("map") ?? "Dust"}`)
        .field("Strongest side", "Attack", true)
        .field("Average round", "1:42", true)
        .colour("#F3B96B"),
    ],
  });
});

// ---- /announce: moderators only -------------------------------------------
client.command("announce", async (i) => {
  if (!i.has(Permissions.ManageMessages)) {
    return i.reply({ content: "You need Manage Messages for this.", flags: MessageFlags.Ephemeral });
  }
  await i.reply({ content: "Posted.", flags: MessageFlags.Ephemeral });
  await i.followUp({ embeds: [new EmbedBuilder().title("📣 Announcement").description(i.option("text")).colour("#E0195F")] });
});

// ---- start --------------------------------------------------------------
await client.login(process.env.ZRZUR_BOT_TOKEN);
const commands = [
  new SlashCommandBuilder("match", "Open a match lobby")
    .string("map", "Which map", { autocomplete: true })
    .integer("size", "How many players", { min: 2, max: 10 }),
  new SlashCommandBuilder("poll", "Start a vote")
    .string("question", "What to vote on", { required: true, maxLength: 100 })
    .string("choices", "Choices, separated by commas", { required: true }),
  new SlashCommandBuilder("profile", "Your game profile"),
  new SlashCommandBuilder("scout", "A scouting report").string("map", "Which map", { choices: MAPS.map((m) => ({ name: m, value: m })) }),
  new SlashCommandBuilder("announce", "Post an announcement").string("text", "What to announce", { required: true }).permissions(Permissions.ManageMessages),
];
await client.syncCommands(commands, { serverId: process.env.ZRZUR_SERVER_ID });
console.log(`Ready as ${client.user?.username}`);

