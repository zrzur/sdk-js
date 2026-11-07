// A bot without a gateway connection: `/hello` answered over HTTP.
//
//   ZRZUR_API_URL=... ZRZUR_BOT_TOKEN=... ZRZUR_SIGNING_SECRET=... PORT=8787 node examples/http-interactions.mjs

import { Client } from "../lib/bot/index.js";

const bot = new Client({ apiUrl: process.env.ZRZUR_API_URL });

bot.command("hello", (i) => i.reply(`Hello ${i.user.username}, over HTTP!`));

await bot.loginHttp(process.env.ZRZUR_BOT_TOKEN);
await bot.listen({
  secret: process.env.ZRZUR_SIGNING_SECRET,
  port: Number(process.env.PORT ?? 8787),
});
console.log(`listening as ${bot.user.username}`);
