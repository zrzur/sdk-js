// Ticket bot: button -> form -> private channel -> private confirmation -> close.
//
// Needs, in the server: Manage Channels, Manage Permissions, Manage Roles and
// Assign Roles (invite it with ?permissions=525) and a role above the roles it
// creates. Runs as its own process with the token from the environment:
//
//   ZRZUR_API_URL=... ZRZUR_WS_URL=... ZRZUR_BOT_TOKEN=... node examples/ticket-raw.mjs

import { Permissions, connectBot } from "./lib/raw.mjs";

const bot = connectBot({
  async onReady() {
    const me = await bot.api("GET", "/users/@me");
    bot.me = me;
    await bot.api("PUT", `/applications/${me._id}/commands`, [
      {
        name: "ticket-setup",
        description: "Post the ticket button in this channel",
        description_localizations: { ar: "نشر زر التذاكر في هذه القناة" },
        // only members who can manage channels see and use it
        default_member_permissions: Permissions.ManageChannel,
      },
    ]);
    console.log("ready");
  },
  onInteraction,
});

async function onInteraction(interaction) {
  if (interaction.type === "Command" && interaction.command.name === "ticket-setup") {
    return bot.respond(interaction, {
      type: "Message",
      data: {
        content: "تحتاج مساعدة؟ افتح تذكرة وسيتواصل معك الفريق.",
        components: [
          {
            type: "ActionRow",
            components: [
              { type: "Button", style: "Primary", label: "فتح تذكرة", emoji: "🎫", custom_id: "ticket:open" },
            ],
          },
        ],
      },
    });
  }

  if (interaction.type === "Component" && interaction.component.custom_id === "ticket:open") {
    return bot.respond(interaction, {
      type: "Modal",
      modal: {
        custom_id: "ticket:form",
        title: "تذكرة جديدة",
        components: [
          {
            type: "ActionRow",
            components: [
              {
                type: "TextInput",
                custom_id: "topic",
                style: "Paragraph",
                label: "ما المشكلة؟",
                placeholder: "اكتب التفاصيل هنا",
                min_length: 5,
                max_length: 500,
              },
            ],
          },
        ],
      },
    });
  }

  if (interaction.type === "ModalSubmit" && interaction.modal.custom_id === "ticket:form") {
    // Opening a channel takes a few requests: acknowledge privately first
    await bot.respond(interaction, { type: "DeferredMessage", data: { ephemeral: true } });
    const topic = interaction.modal.fields.find((f) => f.custom_id === "topic")?.value ?? "";
    const channel = await openTicket(interaction, topic);
    return bot.editOriginal(interaction, {
      content: `تم فتح تذكرتك في <#${channel._id}>. سيظهر الرد هناك.`,
    });
  }

  if (interaction.type === "Component" && interaction.component.custom_id.startsWith("ticket:close:")) {
    const roleId = interaction.component.custom_id.split(":")[2];
    await bot.respond(interaction, {
      type: "UpdateMessage",
      data: { content: "جاري إغلاق التذكرة…", components: [] },
    });
    await bot.api("DELETE", `/channels/${interaction.channel_id}`);
    await bot.api("DELETE", `/servers/${interaction.server_id}/roles/${roleId}`).catch(() => {});
  }
}

/** Private channel only the member, the bot and server admins can see */
async function openTicket(interaction, topic) {
  const server = interaction.server_id;
  const user = interaction.user;

  const channel = await bot.api("POST", `/servers/${server}/channels`, {
    type: "Text",
    name: `ticket-${user.username}`.slice(0, 32),
    description: topic.slice(0, 1024),
  });
  // Nobody sees it by default
  await bot.api("PUT", `/channels/${channel._id}/permissions/default`, {
    permissions: { allow: 0, deny: Permissions.ViewChannel },
  });

  // A role for this ticket, given to the member and the bot
  const { id: roleId } = await bot.api("POST", `/servers/${server}/roles`, {
    name: `ticket-${user.username}`.slice(0, 32),
  });
  const visible =
    Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessage;
  await bot.api("PUT", `/channels/${channel._id}/permissions/${roleId}`, {
    permissions: { allow: visible, deny: 0 },
  });
  for (const memberId of [user._id, bot.me._id]) {
    const member = await bot.api("GET", `/servers/${server}/members/${memberId}`);
    await bot.api("PATCH", `/servers/${server}/members/${memberId}`, {
      roles: [...(member.roles ?? []), roleId],
    });
  }

  await bot.api("POST", `/channels/${channel._id}/messages`, {
    content: `أهلاً <@${user._id}>، هذه تذكرتك.\n> ${topic.replace(/\n/g, "\n> ")}`,
    components: [
      {
        type: "ActionRow",
        components: [
          {
            type: "Button",
            style: "Danger",
            label: "إغلاق التذكرة",
            custom_id: `ticket:close:${roleId}`,
            // the member or the team, not everyone who might later see the channel
            restrict: { users: [user._id], roles: [] },
          },
        ],
      },
    ],
  });
  return channel;
}
