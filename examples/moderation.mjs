// Moderation bot: `/ban`, `/timeout` and a "Timeout 10 min" user context menu.
//
// Members only see the commands with the matching permission, the server
// checks it again on use, and the bot's own permission and role rank decide
// whether the action itself is allowed. Actions go into the server audit log
// with the moderator in the reason.

import { Permissions, ApiError, Client } from "@zrzur/sdk/bot";

const bot = new Client({
  token: process.env.ZRZUR_BOT_TOKEN,
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
});

function explain(error) {
  if (!(error instanceof ApiError)) return "حدث خطأ غير متوقع.";
  switch (error.type) {
    case "MissingPermission":
      return "البوت لا يملك الصلاحية المطلوبة.";
    case "NotElevated":
      return "رتبة البوت أدنى من رتبة هذا العضو.";
    case "CannotTimeoutYourself":
    case "CannotRemoveYourself":
      return "لا يمكن تطبيق هذا الإجراء على نفسك.";
    default:
      return `تعذّر التنفيذ (${error.type}).`;
  }
}

async function timeout(i, userId, minutes) {
  await i.defer({ ephemeral: true });
  try {
    await bot.rest.patch(`/servers/${i.serverId}/members/${userId}`, {
      timeout: new Date(Date.now() + minutes * 60_000).toISOString(),
    });
    await i.editReply(`تم إيقاف <@${userId}> لمدة ${minutes} دقيقة.`);
  } catch (error) {
    await i.editReply(explain(error));
  }
}

bot.command("ban", async (i) => {
  const userId = i.option("user");
  const reason = i.option("reason") ?? "";
  if (userId === i.user._id) {
    return i.reply({ content: "لا يمكنك حظر نفسك.", ephemeral: true });
  }
  await i.defer({ ephemeral: true });
  try {
    await bot.rest.put(`/servers/${i.serverId}/bans/${userId}`, {
      reason: `${reason} (by ${i.user.username} via /ban)`.trim().slice(0, 1024),
    });
    await i.editReply(`تم حظر <@${userId}>.`);
  } catch (error) {
    await i.editReply(explain(error));
  }
});

bot.command("timeout", (i) => timeout(i, i.option("user"), i.option("minutes")));
bot.command("Timeout 10 min", (i) => timeout(i, i.targetId, 10));

await bot.login();
await bot.syncCommands([
  {
    name: "ban",
    description: "Ban a member",
    description_localizations: { ar: "حظر عضو" },
    default_member_permissions: Permissions.BanMembers,
    options: [
      { type: "User", name: "user", description: "Member to ban", required: true },
      { type: "String", name: "reason", description: "Why", max_length: 200 },
    ],
  },
  {
    name: "timeout",
    description: "Time a member out",
    description_localizations: { ar: "إيقاف عضو مؤقتاً" },
    default_member_permissions: Permissions.TimeoutMembers,
    options: [
      { type: "User", name: "user", description: "Member", required: true },
      { type: "Integer", name: "minutes", description: "Minutes", required: true, min_value: 1, max_value: 10080 },
    ],
  },
  {
    type: "User",
    name: "Timeout 10 min",
    default_member_permissions: Permissions.TimeoutMembers,
  },
]);
console.log("ready");
