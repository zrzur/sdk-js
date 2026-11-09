<!-- zrzur-publication -->
# Quick start

```bash
git clone https://github.com/zrzur/sdk-js.git
cd sdk-js
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

Needs Git and Node.js 22 or newer.

Zrzur is an independent, Arabic-first chat platform based on the open-source Stoat software (formerly Revolt), whose server and apps are licensed under AGPL-3.0 or later; this library is MIT-licensed. Zrzur is not affiliated with Stoat, stoat.chat or Revolt Platforms Ltd. Please do not report Zrzur issues to the Stoat team.

Licence and origin: [LICENSE](./LICENSE), [NOTICE](./NOTICE), [MODIFICATIONS.md](./MODIFICATIONS.md). Security: [SECURITY.md](./SECURITY.md). Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md).

# @zrzur/sdk

The official Zrzur library for apps and bots.

One package for everything that talks to a [Zrzur](https://zrzur.com) server:
the HTTP API, the gateway (WebSocket), the API types and events, a bot
toolkit, and the reactive client the Zrzur app is built on.

- ESM only; Node.js 22+, Deno 2.2+ or a browser.
- Not published to npm yet: build it with `pnpm install && pnpm build`. Once published: `npm install @zrzur/sdk`.
- Zrzur ships no ready-made bots; `examples/` holds short examples to learn from.

## Entry points

| Import | What | SolidJS |
|---|---|---|
| `@zrzur/sdk` | Core: `Api` (HTTP client), `Gateway` (WebSocket), `ApiError`, the `API` types namespace, protocol events, permissions, `Intents` | no |
| `@zrzur/sdk/bot` | Bots: commands, buttons, menus, forms, embeds, collectors, managers | no |
| `@zrzur/sdk/solid` | The reactive `Client` with its collections (users, servers, channels, messages, …), used by the Zrzur app; re-exports the core | yes |

SolidJS (`solid-js`, `@solid-primitives/map`, `@solid-primitives/set`) is an
optional peer dependency: install it only for `@zrzur/sdk/solid`. Bots never
download it.

## Bots: `@zrzur/sdk/bot`

### Quickstart

1. In Zrzur, open **Settings → My Bots**, create a bot and copy its token.
2. Invite the bot to a test server (`/bots/<id>/invite`, or the invite link in the bot settings).
3. Put the token in the environment, never in code:

   ```sh
   export ZRZUR_BOT_TOKEN=...            # keep it secret
   export ZRZUR_API_URL=http://127.0.0.1:14702
   export ZRZUR_WS_URL=ws://127.0.0.1:14703
   ```

4. Write the bot:

   ```ts
   import { Client } from "@zrzur/sdk/bot";

   // Zrzur's own servers by default; a local or self-hosted server
   // passes { apiUrl, wsUrl }
   const client = new Client({
     apiUrl: process.env.ZRZUR_API_URL,
     wsUrl: process.env.ZRZUR_WS_URL,
   });

   client.command("hello", async (i) => {
     await i.reply("أهلاً بك في زرزور!");
   });

   await client.login(process.env.ZRZUR_BOT_TOKEN);
   await client.syncCommands([{ name: "hello", description: "Say hello" }]);
   ```

5. Type `/` in a channel of the test server: `/hello` shows up with your bot's name.

### Answering interactions

Every interaction must be acknowledged once, within **3 seconds**. After that
the token stays valid for **15 minutes** for edits.

| Method | When |
|---|---|
| `i.reply(content \| { content, embeds, components, ephemeral })` | New message now. `ephemeral: true`: only the user sees it, and it is never stored as a channel message. |
| `i.defer({ ephemeral })` | Work takes longer than 3 s. Shows "thinking…"; finish with `i.editReply(...)`. |
| `i.update({ content, components })` | Buttons and selects: change the message the component is on. |
| `i.deferUpdate()` | Buttons and selects: acknowledge now, change the message later with `i.editReply(...)`. |
| `i.showModal({ customId, title, fields })` | Open a form (not as the answer to a form). |
| `i.respond(choices)` | Autocomplete suggestions (handled for you by `bot.autocomplete`). |
| `i.editReply(...)` | Edit the answer until the token expires. |

Answering twice throws `InteractionAlreadyRepliedError`. A late answer fails
with `ApiError` of type `InteractionExpired`.

### Doing things

```ts
await bot.messages.send(channelId, { content: "Hi", embeds: [new EmbedBuilder().title("Rules").colour("#E0195F")] });
await bot.messages.reply(message, "Got it");          // reply without a ping
await bot.messages.react(channelId, messageId, "✅");
await bot.messages.bulkDelete(channelId, ids);         // needs Manage Messages
await bot.members.timeout(serverId, userId, 600);      // 10 minutes; 0 ends it
await bot.members.addRole(serverId, userId, roleId);
await bot.members.ban(serverId, userId, { reason: "spam" });
await bot.users.sendDM(userId, "Welcome!");
await bot.setStatus("Type / to see my commands");      // shown under the bot's name
bot.typing(channelId);                                 // "is typing…" for a few seconds
```

Server emojis (uploaded by members, or by the bot with Manage Customisation):

```ts
import { emoji } from "@zrzur/sdk/bot";

const list = await bot.emojis.list(serverId);
const party = await bot.emojis.find(serverId, "party");           // by name
await bot.messages.send(channelId, `Let's go ${emoji(party)}`);    // in text: ":id:"
await i.reply({ components: [{ type: "button", emoji: party._id, label: "Join", customId: "join" }] });
await bot.messages.react(channelId, messageId, party._id);         // as a reaction
await bot.emojis.create(serverId, "zrzur", pngBytes, { contentType: "image/png" });
await bot.emojis.delete(emojiId);
```

Events: `bot.onMessage(fn)` (skips the bot itself and other bots),
`bot.onMemberJoin(fn)`, `bot.onMemberLeave(fn)`, `bot.onReaction(fn)`, or any
gateway event with `bot.on(type, fn)`.

### Building commands

```ts
import { Permissions, SlashCommandBuilder, contextCommand } from "@zrzur/sdk/bot";

await bot.syncCommands([
  new SlashCommandBuilder("ban", "Ban a member")
    .describe({ ar: "حظر عضو", de: "Mitglied bannen" })
    .user("member", "Who to ban", { required: true })
    .string("reason", "Why", { maxLength: 200 })
    .permissions(Permissions.BanMembers),
  new SlashCommandBuilder("tag", "Tags")
    .subcommand("add", "Add a tag", (s) => s.string("name", "Name", { required: true }))
    .subcommand("list", "List tags"),
  contextCommand("Message", "quote"),   // right-click a message → Apps → quote
  contextCommand("User", "user-info"),  // right-click a user → Apps → user-info
]);

bot.command("ban", handler, { cooldown: 5 }); // one use per user every 5 s
```

### Routing

```ts
bot.command("ban", handler);                    // slash, user or message command by name
bot.component("ticket:open", handler);           // exact custom_id
bot.component("ticket:close:", handler);         // every custom_id starting with "ticket:close:"
bot.component(/^poll:\d+$/, handler);            // or a RegExp
bot.modal("ticket:form", handler);               // submitted forms
bot.autocomplete("city", "name", (i) => [{ name: "دمشق", value: "damascus" }]);
bot.on("ServerMemberJoin", (event) => { ... });  // any gateway event
```

Reading values:

```ts
i.option("name")        // option value (also inside sub-commands)
i.subcommand            // chosen sub-command
i.resolved              // users, members, roles and channels referenced by options
i.targetId              // user / message of a context menu command
i.customId, i.values    // component custom_id and select values
i.field("topic")        // form field value
i.focused               // autocomplete: { name, value }
```

### Components

Components may be written in the wire format or in a lighter form; loose
buttons are packed into rows of five and each select gets its own row.

```ts
await i.reply({
  content: "اختر:",
  components: [
    { type: "button", style: "primary", label: "فتح تذكرة", customId: "ticket:open" },
    { type: "button", style: "link", label: "Docs", url: "https://zrzur.com" },
    {
      type: "select",
      customId: "colour",
      maxValues: 2,
      options: [
        { label: "أحمر", value: "red" },
        { label: "أزرق", value: "blue" },
      ],
    },
  ],
});
```

Styles: `primary`, `secondary`, `success`, `danger`, `link`. Selects:
`select` (strings), `userSelect`, `roleSelect`, `channelSelect`,
`mentionableSelect`. A component can be limited to some users or roles with
`restrict: { users, roles }`; the server enforces it.

Limits: 5 rows, 5 buttons per row, 25 select options, `custom_id` up to 100
characters, labels up to 80. Link buttons only take `http(s)` URLs. Only bots
can send components.

**Layout blocks** arrange a message: `text` (Markdown), `section` (one to three paragraphs with a button or a thumbnail at the end), `gallery` (one to ten images), `file` (a file attached to the same message, shown in place), `separator` and `container` (a card around other blocks, with an optional `accent` colour strip and `spoiler`). Images are web links, loaded through the media proxy, or `{ attachment: id }` for a file of the same message.

```ts
await bot.send(channelId, {
  components: [{
    type: "container",
    accent: "#9075FF",
    components: [
      { type: "text", content: "## Plans" },
      { type: "section", text: "Game hosting", button: { type: "button", style: "success", label: "Join", customId: "plan:game" } },
      { type: "separator" },
      { type: "gallery", items: ["https://example.com/a.png", { url: "https://example.com/b.png", spoiler: true }] },
      { type: "button", style: "secondary", label: "Later", customId: "later" },
    ],
  }],
});
```

**Forms** (`i.showModal`) hold up to five fields, each with a `label` and an optional `description`, and `{ type: "text", content }` paragraphs: `textInput`, every select, `radio` (one choice), `checkboxes` (several), `checkbox` (yes / no) and `fileUpload` (`fileTypes: ["image", ".pdf"]`). Read the answers with `i.field(id)`, `i.fieldValues(id)`, `i.fieldChecked(id)` and `i.fieldFiles(id)`. The app tells people that answers go to your bot and never to share passwords.

Limits: 40 components per message, 5 rows per level, 4000 characters of block text, no container inside a container. Links in buttons open only after a warning, unless the reader trusts the site.

### Commands

`bot.syncCommands(list, { serverId? })` replaces the bot's commands with
exactly that list (global, or for one server where the bot is installed).
Unchanged commands keep their ids. Command names are lowercase letters of any
script, digits, `-` and `_`, so Arabic names work. Use
`name_localizations` / `description_localizations` for `ar`, `en`, `de`, ...

`default_member_permissions` hides a command from members without those
permission bits (see `Permissions`); the server checks it again on use.

### Errors

All API failures throw `ApiError` with `status`, `type` (for example
`UnknownCommand`, `ApplicationNotInstalled`, `InteractionExpired`,
`InteractionAlreadyAcknowledged`, `FailedValidation`) and `detail`.
Interaction tokens are removed from error messages. Short rate limits (429)
are waited out automatically.

### Security notes

- Keep the token in the environment or a secret store; rotate it from the bot settings if it leaks.
- Treat everything users send (options, form fields) as untrusted input.
- Never log interaction tokens or form contents.

## Core: `@zrzur/sdk`

Every route of the API, its parameters and its response are typed from the
server's OpenAPI document. Unknown routes and wrong fields fail to compile.

```ts
import { Api, ApiError, Gateway, Intents } from "@zrzur/sdk";

const api = new Api({
  baseURL: "https://api.zrzur.com",      // required: there is no default host
  authentication: { bot: process.env.ZRZUR_BOT_TOKEN }, // or { session }
});

const me = await api.get("/users/@me");                   // typed as API.User
await api.post(`/channels/${channelId}/messages`, { content: "Hi" });

try {
  await api.delete(`/servers/${serverId}/bans/${userId}`);
} catch (error) {
  if (error instanceof ApiError) console.log(error.status, error.type, error.detail);
}

const gateway = new Gateway({ intents: Intents.Default, reconnect: (n) => 1000 * 2 ** n });
gateway.on("event", (packet) => console.log(packet.type));
gateway.connect("wss://events.zrzur.com", process.env.ZRZUR_BOT_TOKEN!);
```

| `Api` option | |
|---|---|
| `baseURL` | Address of the API. Required. |
| `authentication` | `{ session }`, `{ bot }` or `{ headers }`; change later with `api.authenticate(...)`. |
| `headers` | Headers sent with every request. |
| `maxRetries` | Retries after a short 429 (default 2); after a global 429 every request waits until the limit resets. |
| `fetch` | Custom fetch (tests, proxies). |

Per request (last argument): `headers`, `query`, `body` (e.g. `FormData`),
`responseType` (`json`, `text`, `blob`, `arrayBuffer`), `anonymous` (no
authentication headers), `baseURL`. Files: `api.uploadFile(tag, bytes)`,
`api.upload(url, form)`, `api.download(url)`.

| `Gateway` option | |
|---|---|
| `intents` | Gateway intents of a bot (`Intents`, or `intentBits([...])`). |
| `reconnect` | `false` (default) or the delay in ms before attempt `n`; `backoff` is 1 s … 30 s with jitter. Close code 4014 (intent not enabled) never reconnects. |
| `heartbeatInterval`, `pongTimeout`, `connectTimeout` | Seconds (30, 10, 10). |
| `WebSocket` | Custom WebSocket class. |
| `debug` | Log every packet. |

The token goes in the first message (`Authenticate`), never in the URL.
Events: `event`, `state` (`ConnectionState`), `ping`, `close`, `error`.

## Apps: `@zrzur/sdk/solid`

```tsx
import { Client } from "@zrzur/sdk/solid";

const client = new Client({ baseURL: "https://api.zrzur.com" });
await client.login({ email, password });

function MyApp() {
  return <h1>Your username is: {client.user?.username ?? "[logging in...]"}</h1>;
}
```

Collections (`client.users`, `client.servers`, `client.channels`,
`client.messages`, …) update from the gateway and re-render what reads them.

## The API layer

`src/api/` is generated from `api/openapi.json`, the server's OpenAPI
document; never edit it by hand.

```bash
pnpm api:fetch http://127.0.0.1:14702   # refresh api/openapi.json from a running server, then regenerate
pnpm api:generate                       # regenerate src/api/ from api/openapi.json
pnpm api:check                          # CI: fails when src/api/ is stale or a route is missing
```

The document must come from a server with every feature on (webhooks
included), or their routes are missing.

## Other languages

The protocol is plain HTTP and WebSocket. `examples/hello-raw.mjs` and
`examples/python/hello.py` show it without this library.

## Development

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test        # builds, then runs the unit tests
```

## License and attribution

MIT, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The app client is based on
stoat.js © Pawel Makles and contributors. See `CHANGELOG.md` for versions.
