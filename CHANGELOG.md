# Changelog

## Unreleased

- Polls (events carry `version` and `total`; older events are dropped): `Message.poll` (counts and your choice), `isPollClosed`, `votePoll`, `unvotePoll`, `endPoll`, `fetchPollVoters` (pages, oldest vote first); `pollClosed`; `DataMessageSend.poll` (`DataPoll`); gateway events `MessagePollVoteAdd`, `MessagePollVoteRemove`, `MessagePollChoice`, `MessagePollEnd` update the stored poll and emit `messagePollUpdate`; `PollEndedSystemMessage` for the `poll_ended` reply; `features.polls`; error code `PollEnded`. Routes in the hand-edited snapshot until the coordinator re-exports it.
- Scheduled server events: `client.serverEvents` (`ServerEventCollection`) loads a server's events, creates, edits, starts, ends, cancels and deletes them, marks "Interested" and pages the interested members; it follows the gateway events `ServerEventCreate`, `ServerEventUpdate`, `ServerEventDelete` and `ServerEventInterest`, and the client emits `serverEventStarted` when an event you marked starts. Helpers `compareEvents`, `isUpcoming`, `serverEventChannel`, `serverEventLink` (http and https only). API snapshot by hand: the `/servers/{target}/events` routes, `RevoltFeatures.server_events`, system message `event_started`, audit actions `ServerEvent*`, error `TooManyServerEvents` (the coordinator re-exports it from delta).
- Voice: a Ready after a reconnect empties rooms that emptied while the gateway was down (they kept their old participants).

## 2.0.0 (unreleased)

`@zrzur/sdk` is now the one official Zrzur library for apps and bots; `@zrzur/bot` (zrzur/bot-js) is part of it.

Added:
- Message search filters: `DataMessageSearch` takes `authors`, `mentions`, `has` (`MessageHas`: link, file, image, video, embed, sound), `before_date`, `after_date` and `channels`; `POST /servers/{target}/messages/search` and `Server.searchMessagesWithUsers` search every channel of a server the user may read.
- Message forwarding: `Message.forward(target, note?)` (`POST /channels/{target}/messages/forward`), `Message.forwarded` (type `MessageForward`: message, `sent_at`, note; channel and server only for server channels whose message was not masqueraded), `features.forwarding` in the root config, error code `ForwardMatureContent`.
- Gateway resume: `new Gateway({ resume: true })` asks for a resumable session, tracks `seq` (`gateway.seq`) and the `session_id` of `Ready` (`gateway.sessionId`), and after a drop sends `Resume` first: the missed events come again, then `Resumed`. When the server answers `InvalidSession` it authenticates anew on the same socket (the event is passed on, so the caller knows to catch up). Bots (`@zrzur/sdk/bot`) resume by default; the app's client does not ask for it. Protocol types `Resume`, `Resumed`, `InvalidSession`, `Authenticate.resumable`, `Ready.session_id`.
- Rate limits: a route whose bucket the server reported empty (`X-RateLimit-Remaining: 0`) waits for its reset before the next request instead of drawing a 429 (one entry per route shape, at most 256), and a 429 without readable headers takes `retry_after` and `global` from the body.
- Message flags are bit positions, as the server stores them: bots send silent messages as `flags: 2` (`1 << 1`; was `1`, which the server ignored), and `Message.mentioned` in the app's client tests `1 << MessageFlags.MentionsEveryone` / `MentionsOnline` (it read a silent message as a mention). Webhook `send` keeps the Discord-style 4096, which the webhook route maps.
- Gateway: an `Error` `MissingIntent` stops reconnecting and waits for the server's 4014 close, so bots get `DisallowedIntents` (before, the error closed the socket first and the bot retried for ever). A passing error such as `InternalError` keeps the session to resume. The bot client passes gateway errors to `onError` instead of throwing.
- `PublicBot.defaultPermissions`, `privacyPolicyUrl`, `termsOfServiceUrl`, `verified`, `creator`, `serverCount` (`creator` only when the owner turned on `Bot.show_creator`, never with an id; `DataEditBot.show_creator`); `User.verifiedBot`. Routes and types for command permissions (`CommandPermission`, `CommandPermissions`, `DataEditCommandPermissions`, audit action `CommandPermissionsUpdate` with `before`/`after`), `GET /servers/{server_id}/applications/{application_id}/commands`, `GET /bots/{target}/commands` and `?channel=` on `GET /servers/{server_id}/commands` (snapshot edited by hand, to be re-exported).
- Plugins can be switched off on a server: `features.plugins` in the root config; error code `PluginsDisabled` (403) from every `/plugins` route while it is off.
- `FailedValidation` answers carry `fields` (`{ field, rule, min, max }`) and `TooManyBotCreations` carries `resets_at`; on `ApiError` both are read from `body`.
- `POST /servers/create` takes an optional `blueprint`: `client.servers.createServer({ name, blueprint })` builds the categories, channels, roles, read-only channels, rules channel, member invites and icon in one request (types `DataServerBlueprint`, `BlueprintCategory`, `BlueprintChannel`, `BlueprintRole`).
- Official accounts: `User.official`, `User.officialBot` (a bot Zrzur runs itself), `User.officialNames` (in hydration), `Client.language` and `setLanguage` (`User.displayName` and the name of a conversation follow it for official accounts), `User.defaultAvatarURL` of an official account has a new address so browsers fetch the current logo; error code `OfficialAccount`.
- Profile fields on `UserProfile`: `links`, `interests`, `sections`, `hiddenSections`.
- Thread and forum permissions: `Permission.CreateThreads`, `SendMessageInThreads`, `CreateForumPosts`, in the default for new servers and webhooks as the API has them; `Server.threadsDisabled`, `Server.forumsDisabled`; error codes `ThreadsDisabled`, `ForumsDisabled`.
- `client.typing` never rejects; a failure goes to `onError`. Replay protection works on the signed `_id`: the `X-Zrzur-Delivery` header is not signed.
- Bots: `client.threads`, `client.forums`, `client.invites`, `client.messages.pins`, `client.channels.typing`; `client.typing` uses HTTP when there is no gateway connection and now returns a promise.
- Bots: interactions over HTTP: `client.loginHttp`, `client.listen`, `client.httpHandler` (standard `Request` and `Response`), `verifySignature` (constant time, 300-second window), `DeliveryLog` against replays.
- `api/gateway.schema.json` is the gateway's published schema and `api/error-codes.txt` the stable error list; `ERROR_CODES` and `ErrorCode` are generated from it. Tests fail when a gateway event has no SDK type.
- Webhooks: `channelWebhooks.fetchForServer`, `ChannelWebhook.regenerateToken`, `sendTest`, `creatorId`, `createdAt`, `lastUsed`; `bot.webhooks.listForServer`, `fetchWithToken`, `regenerateToken`, `fetchMessage`, `sendSlack` and `send` options (`username`, `avatarUrl`, `threadId`, `threadName`, `appliedTags`, `allowedMentions`). `TextEmbed.proxiedImageURL` and `proxiedThumbnailURL` for embed images by address.
- App sessions fetch a media proxy ticket (`POST /auth/session/proxy_ticket`), keep it fresh, and `proxyFile` adds it as `t`. Without one, addresses stay as they were.

Breaking:
- Webhooks: tokens are shown once and stored hashed, so `ChannelWebhook.token` and `.url` are known only right after `createWebhook` or `regenerateToken()`. `ChannelWebhook.edit` and `delete` use the Manage Webhooks routes. `bot.webhooks.send` asks for the message with `?wait=true`, since the route now answers 204 by default. `GET /webhooks/{id}/{token}` leaves out `creator_id`.
- Three entry points. `@zrzur/sdk` is the core (HTTP API, gateway, types, events) and no longer holds the reactive `Client`: import it from `@zrzur/sdk/solid`. Bots import from `@zrzur/sdk/bot` instead of `@zrzur/bot`.
- SolidJS is an optional peer dependency (needed for `@zrzur/sdk/solid` only).
- `stoat-api` is gone: the API layer (`src/api/`) is generated from the server's OpenAPI document. `API.API` (also exported as `Api`) takes `authentication: { session } | { bot } | { headers }`, fails without a `baseURL` and throws `ApiError` (with the server's error fields) instead of the raw body.
- `EventClient` is replaced by `Gateway`: the token goes in the `Authenticate` message instead of the URL; `state` and `ping` are plain getters (the reactive `Client` keeps its signals); `lastError.type` is `"server"` instead of `"revolt"`.
- Bots: `client.rest` is the shared `Api`; `rest.request("GET", path)` becomes `rest.get(path)` (typed) or `rest.req("get", path)`. The wire types are the server's (`null` where the server sends it).
- `serverRoleUpdate` / `serverRoleDelete` pass `undefined` instead of `{}` when the role was not known.

Changed:
- Unread state and the account's own messages: a `Message` event from this account (any session) moves the channel's read point to it and never adds a mention; a `ChannelAck` for this account (another session read the channel) moves it here too, keeping mentions newer than the ack. `Channel.unread` is false when the newest message is the account's own and no mention waits. New `channelUnreads.advance(id, messageId)`: forward only, no request.
- `Gateway` gives up after 3 `InvalidSession` answers in a row (`INVALID_SESSION_LIMIT`), retrying with backoff in between: one answer can come from a server that is restarting. A `Ready` resets the count.
- The unread sync keeps this device's ack mark until the ack request settles (it was dropped when the next sync started), and tracks acks and new mentions apart: a mention after an ack is no longer lost, and mentions before it are not brought back. `markLocal(id, kind?)` takes `"ack"` or `"mention"`; `holdAck(id)` is new; `Server.ack()` holds its channels the same way; a sync that was asked before the ack settled is dropped for that channel.
- `PublicBot.addToServer()` / `addToGroup()` return their promise (a failed request was an unhandled rejection).

Added:
- Every route of the server (328), typed: parameters, bodies and responses; `pnpm api:check` fails in CI when the layer is stale or a route is missing.
- `Api` waits out short rate limits and pauses every request after a global 429 (for apps too).
- `Gateway` reconnects with backoff when asked (`reconnect`), stops on close code 4014, and types the interaction events.
- Bot tests, live tests and examples (JavaScript and Python) moved in.


## 1.0.0 (unreleased)

First release as `@zrzur/sdk`, the client library for the Zrzur API. It continues the Stoat (Revolt) JavaScript SDK 7.3; the version starts again at 1.0.0 under the new name.

- Zrzur hosts by default (`api.zrzur.com`).
- Gateway intents and the global per-bot rate limit pause.
- Per-member channel permission overrides (`Channel.memberPermissions`, `setMemberPermissions`).
- Invites with an expiry and a maximum number of uses (`createInvite({ maxUses, expiresIn })`).
- Paged member lists (`fetchMembersPage`).
- Server safety: verification level, paused invites and DMs, raid alerts, AutoMod rules, rules screening.
- Kick and ban reasons reach the audit log.
- Threads and forums: `Channel.createThread()`, `fetchThreads()`, `editThread()`, `threadOf()`, `parent`, `thread`, `forum`, `isThread`, `isForum`; a thread uses its parent's permissions in the calculator.
- Ownership transfer with an MFA ticket: `Server.transferOwnership(userId, ticket)`.
- Category permissions: `Server.setCategoryPermissions()`, `Channel.permissionsSynced`, `Channel.syncedCategory`, `Channel.syncPermissions()`; the permission calculator uses the category's overrides for synced channels.
