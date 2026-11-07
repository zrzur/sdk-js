// Role bot: `/roles-setup` posts a menu of self-assignable roles; members pick
// roles and get a private confirmation. Needs Assign Roles, and its own role
// above the roles it hands out.

import { Permissions, ApiError, Client } from "../lib/bot/index.js";

const bot = new Client({
  token: process.env.ZRZUR_BOT_TOKEN,
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
});

const roleOptions = [1, 2, 3, 4, 5].map((n) => ({
  type: "Role",
  name: `role${n}`,
  description: `Role ${n}`,
  description_localizations: { ar: `الدور ${n}` },
  required: n === 1,
}));

bot.command("roles-setup", async (i) => {
  const roles = roleOptions
    .map((o) => i.option(o.name))
    .filter(Boolean)
    .map((id) => ({ id, name: i.resolved.roles?.[id]?.name ?? id }));
  await i.reply({
    content: "اختر أدوارك:",
    components: [
      {
        type: "select",
        customId: "roles:pick",
        placeholder: "اختر دوراً أو أكثر",
        minValues: 0,
        maxValues: roles.length,
        options: roles.map((role) => ({ label: role.name, value: role.id })),
      },
    ],
  });
});

bot.component("roles:pick", async (i) => {
  if (!(i.raw.app_permissions & Permissions.AssignRoles)) {
    return i.reply({ content: "البوت لا يملك صلاحية منح الأدوار هنا.", ephemeral: true });
  }
  await i.defer({ ephemeral: true });

  // The menu's roles: only these are added or removed
  const message = await bot.rest.get(`/channels/${i.channelId}/messages/${i.messageId}`);
  const offered = message.components?.[0]?.components?.[0]?.options?.map((o) => o.value) ?? [];
  const chosen = i.values.filter((value) => offered.includes(value));

  const member = await bot.rest.get(`/servers/${i.serverId}/members/${i.user._id}`);
  const kept = (member.roles ?? []).filter((role) => !offered.includes(role));
  try {
    await bot.rest.patch(`/servers/${i.serverId}/members/${i.user._id}`, {
      roles: [...kept, ...chosen],
    });
    await i.editReply(chosen.length ? "تم تحديث أدوارك." : "أُزيلت أدوار القائمة.");
  } catch (error) {
    const reason =
      error instanceof ApiError && error.type === "NotElevated"
        ? "دور البوت أدنى من الدور المطلوب."
        : "تعذّر تعديل الأدوار.";
    await i.editReply(reason);
  }
});

await bot.login();
await bot.syncCommands([
  {
    name: "roles-setup",
    description: "Post a menu of self-assignable roles",
    description_localizations: { ar: "نشر قائمة أدوار يختارها الأعضاء" },
    default_member_permissions: Permissions.AssignRoles,
    options: roleOptions,
  },
]);
console.log("ready");
