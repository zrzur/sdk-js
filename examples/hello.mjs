// Hello bot with the SDK: `/hello [name] [private]`.
//
//   ZRZUR_API_URL=... ZRZUR_WS_URL=... ZRZUR_BOT_TOKEN=... node examples/hello.mjs

import { Client } from "../lib/bot/index.js";

const bot = new Client({
  token: process.env.ZRZUR_BOT_TOKEN,
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
});

bot.command("hello", async (i) => {
  const name = i.option("name") ?? i.user.display_name ?? i.user.username;
  await i.reply({ content: `أهلاً بك في زرزور يا ${name}!`, ephemeral: i.option("private") === true });
});

await bot.login();
await bot.syncCommands([
  {
    name: "hello",
    description: "Say hello",
    description_localizations: { ar: "قل مرحباً", de: "Hallo sagen" },
    options: [
      { type: "String", name: "name", description: "Who to greet", max_length: 32 },
      { type: "Boolean", name: "private", description: "Only you see the answer" },
    ],
  },
]);
console.log(`ready as ${bot.user.username}`);
