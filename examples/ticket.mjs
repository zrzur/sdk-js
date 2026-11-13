// Ticket bot with the SDK: button -> form -> private channel -> private confirmation -> close.
//
// Invite it with ?permissions=525 (Manage Channels, Manage Permissions,
// Manage Roles, Assign Roles); its role must sit above the roles it creates.

import { Permissions, Client } from "@zrzur/sdk/bot";

const bot = new Client({
  token: process.env.ZRZUR_BOT_TOKEN,
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
});

bot.command("ticket-setup", (i) =>
  i.reply({
    content: "تحتاج مساعدة؟ افتح تذكرة وسيتواصل معك الفريق.",
    components: [
      { type: "button", style: "primary", label: "فتح تذكرة", emoji: "🎫", customId: "ticket:open" },
    ],
  }),
);

bot.component("ticket:open", (i) =>
  i.showModal({
    customId: "ticket:form",
    title: "تذكرة جديدة",
    fields: [
      {
        type: "textInput",
        customId: "topic",
        label: "ما المشكلة؟",
        style: "paragraph",
        placeholder: "اكتب التفاصيل هنا",
        minLength: 5,
        maxLength: 500,
      },
    ],
  }),
);

bot.modal("ticket:form", async (i) => {
  // Opening a channel takes a few requests: acknowledge privately first
  await i.defer({ ephemeral: true });
  try {
    const channel = await openTicket(i.serverId, i.user, i.field("topic") ?? "");
    await i.editReply(`تم فتح تذكرتك في <#${channel._id}>. سيظهر الرد هناك.`);
  } catch (error) {
    console.error("could not open a ticket:", error.message);
    await i.editReply("تعذّر فتح التذكرة. تحقّق من صلاحيات البوت ورتبة دوره.");
  }
});

bot.component("ticket:close:", async (i) => {
  const roleId = i.customId.split(":")[2];
  await i.update({ content: "جاري إغلاق التذكرة…", components: [] });
  await bot.rest.delete(`/channels/${i.channelId}`);
  await bot.rest.delete(`/servers/${i.serverId}/roles/${roleId}`).catch(() => {});
});

/** Private channel only the member, the bot and server admins can see */
async function openTicket(serverId, user, topic) {
  const channel = await bot.rest.post(`/servers/${serverId}/channels`, {
    type: "Text",
    name: `ticket-${user.username}`.slice(0, 32),
    description: topic.slice(0, 1024),
  });
  // The ticket role (member + bot) gets access first; only then is the
  // channel hidden from everyone else, so the bot never locks itself out
  const { id: roleId } = await bot.rest.post(`/servers/${serverId}/roles`, {
    name: `ticket-${user.username}`.slice(0, 32),
  });
  await bot.rest.put(`/channels/${channel._id}/permissions/${roleId}`, {
    permissions: {
      allow: Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessage,
      deny: 0,
    },
  });
  for (const memberId of [user._id, bot.user._id]) {
    const member = await bot.rest.get(`/servers/${serverId}/members/${memberId}`);
    await bot.rest.patch(`/servers/${serverId}/members/${memberId}`, {
      roles: [...(member.roles ?? []), roleId],
    });
  }
  await bot.rest.put(`/channels/${channel._id}/permissions/default`, {
    permissions: { allow: 0, deny: Permissions.ViewChannel },
  });

  await bot.send(channel._id, {
    content: `أهلاً <@${user._id}>، هذه تذكرتك.\n> ${topic.replace(/\n/g, "\n> ")}`,
    components: [
      {
        type: "button",
        style: "danger",
        label: "إغلاق التذكرة",
        customId: `ticket:close:${roleId}`,
        restrict: { users: [user._id] },
      },
    ],
  });
  return channel;
}

await bot.login();
await bot.syncCommands([
  {
    name: "ticket-setup",
    description: "Post the ticket button in this channel",
    description_localizations: { ar: "نشر زر التذاكر في هذه القناة" },
    default_member_permissions: Permissions.ManageChannel,
  },
]);
console.log("ready");
