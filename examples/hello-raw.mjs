// Minimal Zrzur bot using nothing but HTTP and WebSocket (Node 22+).
// It registers `/hello [name]` and answers it publicly, or privately with `private:true`.
//
//   ZRZUR_API_URL=http://127.0.0.1:14702 ZRZUR_WS_URL=ws://127.0.0.1:14703 \
//   ZRZUR_BOT_TOKEN=... node examples/hello-raw.mjs
//
// The token comes from the environment only. Never commit it or print it.

const API = process.env.ZRZUR_API_URL;
const WS = process.env.ZRZUR_WS_URL;
const TOKEN = process.env.ZRZUR_BOT_TOKEN;
if (!API || !WS || !TOKEN) {
  console.error("Set ZRZUR_API_URL, ZRZUR_WS_URL and ZRZUR_BOT_TOKEN");
  process.exit(1);
}

async function api(method, path, body) {
  const response = await fetch(API + path, {
    method,
    headers: { "x-bot-token": TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

const me = await api("GET", "/users/@me");

// Replaces the bot's global commands with exactly this list
await api("PUT", `/applications/${me._id}/commands`, [
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

function option(command, name) {
  return command.options?.find((o) => o.name === name)?.value;
}

async function onInteraction(interaction) {
  const command = interaction.command;
  if (command?.name !== "hello") return;

  const name = option(command, "name") ?? interaction.user.display_name ?? interaction.user.username;
  await api("POST", `/interactions/${interaction._id}/${interaction.token}/callback`, {
    type: "Message",
    data: { content: `أهلاً بك في زرزور يا ${name}!`, ephemeral: option(command, "private") === true },
  });
}

function connect() {
  const socket = new WebSocket(`${WS}?version=1&format=json`);
  let heartbeat;

  socket.addEventListener("open", () => {
    // Authenticate with a message so the token never appears in a URL
    // intents: 63 = every free intent; add 1024 for message content once
    // it is switched on for the bot in the developer portal
    socket.send(JSON.stringify({ type: "Authenticate", token: TOKEN, intents: 63 }));
  });

  socket.addEventListener("message", (event) => {
    const packet = JSON.parse(event.data);
    switch (packet.type) {
      case "Ready":
        console.log(`ready as ${me.username}`);
        heartbeat = setInterval(() => socket.send(JSON.stringify({ type: "Ping", data: Date.now() })), 20_000);
        break;
      case "InteractionCreate":
        onInteraction(packet.interaction).catch((error) => console.error("answer failed:", error.message));
        break;
      case "Error":
        console.error("gateway error:", packet.error);
        break;
    }
  });

  socket.addEventListener("close", () => {
    clearInterval(heartbeat);
    // Reconnect with a delay; interactions missed while offline expire on their own
    setTimeout(connect, 3_000);
  });
}

connect();
