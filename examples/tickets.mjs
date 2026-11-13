// A ticket bot: members open a private room with the staff, from a button.
//
//   /tickets-panel  posts the panel with the "Open ticket" button (staff only)
//   Open ticket     a short form, then a room "ticket-0001" in the "Tickets"
//                   category that only the member, the staff and the bot see
//   Claim           a staff member takes the ticket; the embed shows who
//   Add someone     lets another member into the room
//   Close           asks first, sends the member a transcript, deletes the room
//
// The bot needs Manage Channels, Manage Permissions and Manage Messages, and a
// role above the staff role. Set ZRZUR_STAFF_ROLE_ID to the staff role
// (optional: without it only the bot and the member are in the room); to ping
// the staff in new tickets the bot also needs Mention Roles. The transcript
// reads the room's messages, so switch on the Message Content intent for the
// bot in the developer portal (without it they come back without text).
//
// Run:  ZRZUR_BOT_TOKEN=... ZRZUR_SERVER_ID=... node examples/tickets.mjs
// (a local or self-hosted server also sets ZRZUR_API_URL and ZRZUR_WS_URL).
// In your own project, import from "@zrzur/sdk/bot".
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Intents,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  Permissions,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "@zrzur/sdk/bot";

const client = new Client({
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
  intents: [Intents.Default, Intents.MessageContent],
});
const STAFF_ROLE = process.env.ZRZUR_STAFF_ROLE_ID;
const TOPICS = ["Account", "Payments", "Report a member", "Something else"];

/** What a person in a ticket may do */
const IN_TICKET =
  Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessage | Permissions.UploadFiles | Permissions.React;

// open tickets: channel id → { owner, topic, number, claimedBy, message }
const tickets = new Map();
let counter = 0;

const isStaff = (i) => i.has(Permissions.ManageMessages) || (STAFF_ROLE && i.member?.roles?.includes(STAFF_ROLE));

// ---- the panel --------------------------------------------------------------
client.command("tickets-panel", async (i) => {
  await client.send(i.channelId, {
    embeds: [
      new EmbedBuilder()
        .title("Need help?")
        .description("Open a ticket and talk to the team in a private room. Only you and the staff can see it.")
        .colour("#E0195F"),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket:open").setLabel("Open ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary),
      ),
    ],
  });
  await i.reply({ content: "Panel posted.", flags: MessageFlags.Ephemeral });
});

// ---- opening ----------------------------------------------------------------
client.component("ticket:open", async (i) => {
  const open = [...tickets.entries()].find(([, t]) => t.owner === i.user.id);
  if (open) return i.reply({ content: `You already have a ticket: <#${open[0]}>`, flags: MessageFlags.Ephemeral });
  await i.showModal(
    new ModalBuilder()
      .setCustomId("ticket:form")
      .setTitle("Open a ticket")
      .addLabelComponents(
        new LabelBuilder().setLabel("Topic").setStringSelectMenuComponent(
          new StringSelectMenuBuilder().setCustomId("topic").addOptions(TOPICS.map((t) => ({ label: t, value: t }))),
        ),
        new LabelBuilder().setLabel("What do you need?").setTextInputComponent((t) =>
          t.setCustomId("details").setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(1000),
        ),
      ),
  );
});

client.modal("ticket:form", async (i) => {
  // a second click while the first form was open
  const open = [...tickets.entries()].find(([, t]) => t.owner === i.user.id);
  if (open) return i.reply({ content: `You already have a ticket: <#${open[0]}>`, flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const serverId = i.serverId;
  const number = String(++counter).padStart(4, "0");
  const category = await client.servers.ensureCategory(serverId, "Tickets");
  const channel = await client.channels.create(serverId, {
    name: `ticket-${number}`,
    description: `Ticket of ${i.user.username}`,
    category,
  });
  const id = channel._id;
  // the bot keeps itself in, then the room is hidden from everyone else
  await client.channels.setMemberPermissions(id, client.user.id, IN_TICKET | Permissions.ManageChannel | Permissions.ManagePermissions);
  await client.channels.setPermissions(id, "default", 0, Permissions.ViewChannel);
  await client.channels.setMemberPermissions(id, i.user.id, IN_TICKET);
  if (STAFF_ROLE) await client.channels.setPermissions(id, STAFF_ROLE, IN_TICKET | Permissions.ManageMessages);

  const ticket = {
    owner: i.user.id,
    topic: i.fields.getStringSelectValues("topic")[0],
    details: i.fields.getTextInputValue("details"),
    number,
    claimedBy: null,
  };
  const message = await client.send(id, {
    content: `<@${i.user.id}>${STAFF_ROLE ? ` <%${STAFF_ROLE}>` : ""}`,
    embeds: [ticketEmbed(ticket)],
    components: [ticketButtons(ticket)],
  });
  tickets.set(id, { ...ticket, message: message.id });
  await i.editReply({ content: `Your ticket is open: <#${id}>` });
});

function ticketEmbed(t) {
  return new EmbedBuilder()
    .title(`Ticket ${t.number} · ${t.topic}`)
    .description(t.details)
    .field("Opened by", `<@${t.owner}>`, true)
    .field("Claimed by", t.claimedBy ? `<@${t.claimedBy}>` : "Nobody yet", true)
    .footer("The staff will answer here. Press Close when you're done.")
    .colour(t.claimedBy ? "#55DCC8" : "#E0195F")
    .timestamp();
}

function ticketButtons(t) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:claim").setLabel(t.claimedBy ? "Claimed" : "Claim").setStyle(ButtonStyle.Success).setDisabled(!!t.claimedBy),
    new ButtonBuilder().setCustomId("ticket:add").setLabel("Add someone").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger),
  );
}

// ---- inside the room ----------------------------------------------------------
client.component("ticket:claim", async (i) => {
  const t = tickets.get(i.channelId);
  if (!t) return i.reply({ content: "This ticket is closed.", flags: MessageFlags.Ephemeral });
  if (!isStaff(i)) return i.reply({ content: "Only the staff can claim a ticket.", flags: MessageFlags.Ephemeral });
  t.claimedBy = i.user.id;
  await i.update({ embeds: [ticketEmbed(t)], components: [ticketButtons(t)] });
  await client.send(i.channelId, `<@${i.user.id}> is looking after this ticket.`);
});

client.component("ticket:add", async (i) => {
  const t = tickets.get(i.channelId);
  if (!t) return i.reply({ content: "This ticket is closed.", flags: MessageFlags.Ephemeral });
  await i.reply({
    flags: MessageFlags.Ephemeral,
    content: "Who should join this ticket?",
    components: [
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("ticket:add-pick").setPlaceholder("Pick a member")),
    ],
  });
});

client.component("ticket:add-pick", async (i) => {
  const userId = i.values[0];
  const added = await client.channels.setMemberPermissions(i.channelId, userId, IN_TICKET).then(
    () => true,
    () => false,
  );
  await i.update({ content: added ? `Added <@${userId}>.` : "That member can't be added.", components: [] });
  if (added) await client.send(i.channelId, `<@${i.user.id}> added <@${userId}> to the ticket.`);
});

client.component("ticket:close", async (i) => {
  if (!tickets.has(i.channelId)) return i.reply({ content: "This ticket is closed.", flags: MessageFlags.Ephemeral });
  await i.reply({
    flags: MessageFlags.Ephemeral,
    content: "Close this ticket? The room is deleted and the member gets a transcript.",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket:close-yes").setLabel("Close ticket").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket:close-no").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
});

client.component("ticket:close-no", (i) => i.update({ content: "Still open.", components: [] }));

client.component("ticket:close-yes", async (i) => {
  const t = tickets.get(i.channelId);
  if (!t) return i.update({ content: "This ticket is closed.", components: [] });
  tickets.delete(i.channelId);
  await i.update({ content: "Closing…", components: [] });
  await client.send(i.channelId, {
    embeds: [new EmbedBuilder().title("Ticket closed").description(`Closed by <@${i.user.id}>. This room is deleted in a few seconds.`).colour("#F27488")],
  });

  // the transcript: the room's messages, oldest first
  const messages = (await client.messages.fetchMany(i.channelId, { limit: 100 })).reverse();
  const lines = messages.map((m) => {
    const embeds = (m.embeds ?? []).map((e) => `[embed] ${e.title ?? ""} ${e.description ?? ""}`.trim());
    return `[${new Date(decodeTime(m._id)).toISOString()}] ${m.author}: ${[m.content, ...embeds].filter(Boolean).join(" ")}`;
  });
  const transcript = `Ticket ${t.number} · ${t.topic}\nOpened by ${t.owner}${t.claimedBy ? `, claimed by ${t.claimedBy}` : ""}\n\n${lines.join("\n")}\n`;
  await client.users
    .sendDM(t.owner, {
      content: `Your ticket ${t.number} was closed. Here is a copy of the conversation.`,
      files: [{ name: `ticket-${t.number}.txt`, data: new TextEncoder().encode(transcript), type: "text/plain" }],
    })
    .catch(() => {}); // the member may not accept direct messages

  await new Promise((r) => setTimeout(r, 3000));
  await client.channels.delete(i.channelId);
});

/** Message ids are ULIDs: the first 10 characters are the time */
function decodeTime(id) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return [...id.slice(0, 10)].reduce((time, c) => time * 32 + alphabet.indexOf(c), 0);
}

// a room deleted by hand is no longer an open ticket
client.on("ChannelDelete", (packet) => tickets.delete(packet.id));

// ---- start ----------------------------------------------------------------------
await client.login(process.env.ZRZUR_BOT_TOKEN);
await client.syncCommands(
  [new SlashCommandBuilder("tickets-panel", "Post the panel with the Open ticket button").permissions(Permissions.ManageChannel)],
  { serverId: process.env.ZRZUR_SERVER_ID },
);
console.log(`Ready as ${client.user?.username}`);
