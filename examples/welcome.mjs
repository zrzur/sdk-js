// Welcome bot: greets new members in the server's join-message channel, if
// the server set one and the bot may write there.

import { ApiError, Client, Intents } from "@zrzur/sdk/bot";

const bot = new Client({
  token: process.env.ZRZUR_BOT_TOKEN,
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
  // member joins need the privileged Server Members intent: switch it on for
  // the bot in the developer portal first
  intents: [Intents.Default, Intents.ServerMembers],
});

bot.on("ServerMemberJoin", async (event) => {
  if (event.user === bot.user._id) return;
  const server = await bot.rest.get(`/servers/${event.id}`);
  const channel = server.system_messages?.user_joined;
  if (!channel) return;
  try {
    await bot.send(channel, `أهلاً وسهلاً <@${event.user}> في ${server.name}! 👋`);
  } catch (error) {
    // no permission to write there: stay quiet instead of failing loudly
    if (!(error instanceof ApiError && error.type === "MissingPermission")) throw error;
  }
});

await bot.login();
console.log("ready");
