// Poll bot: `/poll question options` posts buttons; one vote per member
// (voting again moves the vote), results update live on the message.
//
// Votes are kept in memory for the demo; a real bot would store them.

import { Client } from "@zrzur/sdk/bot";

const bot = new Client({
  token: process.env.ZRZUR_BOT_TOKEN,
  apiUrl: process.env.ZRZUR_API_URL,
  wsUrl: process.env.ZRZUR_WS_URL,
});

/** poll id -> { question, options, votes: Map<userId, index> } */
const polls = new Map();

function render(id) {
  const poll = polls.get(id);
  const counts = poll.options.map((_, index) =>
    [...poll.votes.values()].filter((vote) => vote === index).length,
  );
  const total = counts.reduce((a, b) => a + b, 0);
  const lines = poll.options.map((option, index) => {
    const share = total ? Math.round((counts[index] / total) * 100) : 0;
    return `${option}: ${counts[index]} (${share}%)`;
  });
  return {
    content: `**${poll.question}**\n${lines.join("\n")}\n${total} صوت`,
    components: poll.options.map((option, index) => ({
      type: "button",
      style: "secondary",
      label: option.slice(0, 80),
      customId: `poll:${id}:${index}`,
    })),
  };
}

bot.command("poll", async (i) => {
  const options = String(i.option("options"))
    .split(/[,،]/)
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (options.length < 2) {
    return i.reply({ content: "اكتب خيارين على الأقل، مفصولة بفواصل.", ephemeral: true });
  }
  const id = i.id;
  polls.set(id, { question: String(i.option("question")), options, votes: new Map() });
  await i.reply(render(id));
});

bot.component(/^poll:[0-9A-Z]{26}:\d$/, async (i) => {
  const [, id, index] = i.customId.split(":");
  const poll = polls.get(id);
  if (!poll) {
    return i.reply({ content: "انتهى هذا الاستطلاع.", ephemeral: true });
  }
  // one vote per member: a second click moves it
  poll.votes.set(i.user._id, Number(index));
  await i.update(render(id));
});

await bot.login();
await bot.syncCommands([
  {
    name: "poll",
    description: "Start a poll",
    description_localizations: { ar: "بدء استطلاع" },
    options: [
      { type: "String", name: "question", description: "Question", required: true, max_length: 200 },
      { type: "String", name: "options", description: "Options, comma separated", required: true, max_length: 400 },
    ],
  },
]);
console.log("ready");
