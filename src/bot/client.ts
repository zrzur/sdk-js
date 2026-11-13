import type { DataEditApplicationCommand } from "../api/types.js";
import { API } from "../core/API.js";
import {
  CLOSE_DISALLOWED_INTENTS,
  ConnectionState,
  Gateway,
  backoff,
} from "../core/Gateway.js";
import type { RemovalIntention, ServerMessage } from "../core/protocol.js";

import { type EmbedBuilder, resolve } from "./builders.js";
import { type CollectorOptions, InteractionCollector } from "./collector.js";
import { type ComponentInput, toBlocks } from "./components.js";
import { InteractionCollectorError } from "./errors.js";
import {
  type InteractionHandlerOptions,
  createInteractionHandler,
  serveInteractions,
} from "./http.js";
import { Interaction, type InteractionContext } from "./interaction.js";
import {
  ChannelManager,
  EmojiManager,
  ForumManager,
  InviteManager,
  MemberManager,
  MessageManager,
  type Presence,
  RoleManager,
  ServerManager,
  ThreadManager,
  UserManager,
  VoiceManager,
  WebhookManager,
} from "./managers.js";
import type {
  CommandDefinition,
  ComponentBlock,
  Member,
  Message,
  OptionChoice,
  SendableEmbed,
  User,
} from "./types.js";
import { intentBits } from "./types.js";

/** Zrzur's own addresses; a self-hosted server passes its own */
export const DEFAULT_API_URL = "https://api.zrzur.com";
export const DEFAULT_WS_URL = "wss://events.zrzur.com";

export interface BotOptions {
  /** Bot token, or pass it to `login(token)`; read it from the environment, never hard-code it */
  token?: string;
  /** Default https://api.zrzur.com; e.g. http://127.0.0.1:14702 locally */
  apiUrl?: string;
  /** Default wss://events.zrzur.com; e.g. ws://127.0.0.1:14703 locally */
  wsUrl?: string;
  /**
   * Gateway intents (`[Intents.Default, Intents.MessageContent]` or a number);
   * the free ones when left out. Privileged intents must be enabled for the
   * bot in the developer portal, or login fails.
   */
  intents?: number | readonly number[];
  /** Called when a handler throws; defaults to console.error */
  onError?: (error: unknown, interaction?: Interaction) => void;
  /** Custom fetch (other runtimes, tests) */
  fetch?: typeof fetch;
  /** Custom WebSocket class (other runtimes, tests) */
  WebSocket?: typeof WebSocket;
}

/** Gateway packets, plus the two the bot client adds itself */
export type BotPacket =
  | ServerMessage
  | { type: "DisallowedIntents"; reason: string }
  | { type: "Disconnected" };

type Handler = (interaction: Interaction) => unknown | Promise<unknown>;
type AutocompleteHandler = (
  interaction: Interaction,
) => OptionChoice[] | Promise<OptionChoice[]>;
type Matcher = string | RegExp | ((customId: string) => boolean);

const matches = (matcher: Matcher, value: string) =>
  typeof matcher === "string"
    ? matcher === value || (matcher.endsWith(":") && value.startsWith(matcher))
    : matcher instanceof RegExp
      ? matcher.test(value)
      : matcher(value);

/** A message the bot sent or edited, with collector helpers */
export type SentMessage = Message & {
  readonly id: string;
  readonly channelId: string;
  createMessageComponentCollector(
    options?: CollectorOptions,
  ): InteractionCollector;
  awaitMessageComponent(options?: CollectorOptions): Promise<Interaction>;
};

export interface SendOptions {
  content?: string;
  embeds?: (SendableEmbed | EmbedBuilder)[];
  components?: ComponentInput[];
}

/**
 * A Zrzur bot: REST client, gateway connection and an interaction router.
 *
 * ```ts
 * const client = new Client();
 * client.command("hello", (i) => i.reply("أهلاً بك في زرزور!"));
 * await client.login(process.env.ZRZUR_BOT_TOKEN);
 * ```
 */
export class Client {
  /** HTTP client of the API (typed routes, rate limits) */
  readonly rest: API;
  readonly gateway: Gateway;
  /** Send, edit, delete, react to and pin messages */
  readonly messages: MessageManager;
  /** Kick, ban, time out members and change their roles */
  readonly members: MemberManager;
  readonly roles: RoleManager;
  readonly channels: ChannelManager;
  /** Fetch users and send direct messages */
  readonly users: UserManager;
  readonly servers: ServerManager;
  /** Custom emojis of servers: list, add, remove */
  readonly emojis: EmojiManager;
  /** Tickets for voice channels */
  readonly voice: VoiceManager;
  /** Channel webhooks: create, edit, delete, post through them */
  readonly webhooks: WebhookManager;
  /** Threads: start, list, rename, archive, lock */
  readonly threads: ThreadManager;
  /** Forums: posts and tags */
  readonly forums: ForumManager;
  /** Invites: create, look up, list, remove */
  readonly invites: InviteManager;
  /** The bot's own account, after login (`id` as on interactions) */
  user?: User & { id: string };
  #cooldowns = new Map<string, number>();

  #commands = new Map<string, Handler>();
  #components: [Matcher, Handler][] = [];
  #modals: [Matcher, Handler][] = [];
  #autocomplete = new Map<string, AutocompleteHandler>();
  #listeners = new Map<string, Set<(packet: BotPacket) => unknown>>();
  #interactionListeners = new Set<(interaction: Interaction) => unknown>();
  #readyResolvers: (() => void)[] = [];
  #readyRejecters: ((error: Error) => void)[] = [];
  #collectors = new Set<InteractionCollector>();
  /** Components the bot last gave its messages, for `interaction.message.components` */
  #componentsOf = new Map<string, ComponentBlock[]>();
  #context: InteractionContext = {
    components: (id) => this.#componentsOf.get(id),
    remember: (id, components) => this.#remember(id, components),
    awaitModalSubmit: (options) => this.awaitModalSubmit(options),
  };

  constructor(private readonly options: BotOptions = {}) {
    this.rest = new API({
      baseURL: options.apiUrl ?? DEFAULT_API_URL,
      authentication: options.token ? { bot: options.token } : {},
      fetch: options.fetch,
    });
    this.gateway = new Gateway({
      intents:
        options.intents === undefined ? undefined : intentBits(options.intents),
      WebSocket: options.WebSocket,
      reconnect: backoff,
      // after a drop the missed events come again instead of being lost
      resume: true,
    });
    this.#wire(this.gateway);
    this.messages = new MessageManager(this.rest);
    this.members = new MemberManager(this.rest);
    this.roles = new RoleManager(this.rest);
    this.channels = new ChannelManager(this.rest);
    this.users = new UserManager(this.rest);
    this.servers = new ServerManager(this.rest);
    this.emojis = new EmojiManager(this.rest);
    this.voice = new VoiceManager(this.rest);
    this.webhooks = new WebhookManager(this.rest);
    this.threads = new ThreadManager(this.rest);
    this.forums = new ForumManager(this.rest);
    this.invites = new InviteManager(this.rest);
  }

  #wire(gateway: Gateway) {
    gateway.on("event", (packet) => this.#onPacket(packet));
    // without a listener an error event would throw; a refused intent is
    // told through login() and `DisallowedIntents` instead
    gateway.on("error", (error) => {
      if ((error as { type?: string }).type !== "MissingIntent")
        this.#report(error);
    });
    gateway.on("close", (code, reason) => {
      if (code === CLOSE_DISALLOWED_INTENTS) {
        this.#onPacket({ type: "DisallowedIntents", reason });
      }
    });
    gateway.on("state", (state) => {
      if (state === ConnectionState.Disconnected)
        this.#onPacket({ type: "Disconnected" });
    });
  }

  /** Handle a slash command (or user / message context command) by name */
  command(name: string, handler: Handler, options: { cooldown?: number } = {}) {
    const cooldown = (options.cooldown ?? 0) * 1000;
    if (!cooldown) {
      this.#commands.set(name, handler);
      return this;
    }
    // per user: a second use inside the cooldown gets a private "wait" reply
    this.#commands.set(name, (i) => {
      const key = `${name}:${i.user._id}`;
      const until = this.#cooldowns.get(key) ?? 0;
      if (Date.now() < until) {
        const seconds = Math.ceil((until - Date.now()) / 1000);
        return i.reply({
          content: `Please wait ${seconds} s before using /${name} again.`,
          ephemeral: true,
        });
      }
      this.#cooldowns.set(key, Date.now() + cooldown);
      const timer = setTimeout(() => this.#cooldowns.delete(key), cooldown) as {
        unref?: () => void;
      };
      timer.unref?.();
      return handler(i);
    });
    return this;
  }

  /**
   * Handle buttons and selects. A string ending in `:` matches every
   * `custom_id` starting with it (`"ticket:"` matches `"ticket:close:42"`).
   */
  component(matcher: Matcher, handler: Handler) {
    this.#components.push([matcher, handler]);
    return this;
  }

  /** Handle submitted forms by their `custom_id` */
  modal(matcher: Matcher, handler: Handler) {
    this.#modals.push([matcher, handler]);
    return this;
  }

  /** Suggest values while a user types into `command`'s `option` */
  autocomplete(command: string, option: string, handler: AutocompleteHandler) {
    this.#autocomplete.set(`${command}:${option}`, handler);
    return this;
  }

  /**
   * Collect clicks and choices on a message. Messages from `bot.send`
   * have this method too (`message.createMessageComponentCollector`).
   */
  createMessageComponentCollector(options: CollectorOptions = {}) {
    const collector = new InteractionCollector(
      { ...options, interactionType: "Component" },
      (c) => this.#collectors.delete(c),
    );
    this.#collectors.add(collector);
    return collector;
  }

  /** The first matching click or choice */
  awaitMessageComponent(options: CollectorOptions = {}) {
    return this.#awaitOne({ ...options, interactionType: "Component" });
  }

  /** The first matching submitted form */
  awaitModalSubmit(options: CollectorOptions & { time: number }) {
    if (typeof options?.time !== "number")
      throw new TypeError("awaitModalSubmit needs a time in milliseconds");
    return this.#awaitOne({ ...options, interactionType: "ModalSubmit" });
  }

  #awaitOne(options: CollectorOptions) {
    const collector = new InteractionCollector({ ...options, max: 1 }, (c) =>
      this.#collectors.delete(c),
    );
    this.#collectors.add(collector);
    return new Promise<Interaction>((resolve, reject) => {
      collector.once(
        "end",
        (collected: Map<string, Interaction>, reason: string) => {
          const first = collected.values().next().value;
          if (first) resolve(first);
          else reject(new InteractionCollectorError(reason));
        },
      );
    });
  }

  #remember(messageId: string, components: ComponentBlock[] | undefined) {
    if (!components) return;
    this.#componentsOf.delete(messageId);
    this.#componentsOf.set(messageId, components);
    // keep the most recent few hundred
    if (this.#componentsOf.size > 500)
      this.#componentsOf.delete(this.#componentsOf.keys().next().value!);
  }

  /** A sent message with collector helpers (not part of its JSON) */
  #withHelpers(message: Message, sent?: ComponentBlock[]) {
    this.#remember(message._id, message.components ?? sent);
    Object.defineProperties(message, {
      id: { value: message._id, enumerable: false },
      channelId: { value: message.channel, enumerable: false },
      createMessageComponentCollector: {
        value: (options: CollectorOptions = {}) =>
          this.createMessageComponentCollector({
            ...options,
            message: message._id,
          }),
        enumerable: false,
      },
      awaitMessageComponent: {
        value: (options: CollectorOptions = {}) =>
          this.awaitMessageComponent({ ...options, message: message._id }),
        enumerable: false,
      },
    });
    return message as SentMessage;
  }

  /**
   * Listen to any gateway event (`Message`, `ServerMemberJoin`, ...), or to
   * `"interactionCreate"` (`Events.InteractionCreate`) for every interaction.
   */
  on(
    type: "interactionCreate",
    listener: (interaction: Interaction) => unknown,
  ): this;
  on<T extends BotPacket["type"]>(
    type: T,
    listener: (packet: Extract<BotPacket, { type: T }>) => unknown,
  ): this;
  on(
    type: string,
    listener:
      | ((interaction: Interaction) => unknown)
      | ((packet: never) => unknown),
  ) {
    if (type === "interactionCreate") {
      this.#interactionListeners.add(
        listener as (interaction: Interaction) => unknown,
      );
      return this;
    }
    let set = this.#listeners.get(type);
    if (!set) this.#listeners.set(type, (set = new Set()));
    // a listener only ever receives packets of the type it was added for
    set.add(listener as (packet: BotPacket) => unknown);
    return this;
  }

  /**
   * New messages in channels the bot can see. The bot's own messages are
   * skipped, and other bots' too unless `includeBots`.
   */
  onMessage(
    listener: (message: Message) => void,
    options: { includeBots?: boolean } = {},
  ) {
    return this.on("Message", (packet) => {
      if (packet.author === this.user?._id) return;
      if (!options.includeBots && packet.user?.bot) return;
      const { type: _type, ...message } = packet;
      listener(message as Message);
    });
  }

  /** A member joined a server the bot is in */
  onMemberJoin(
    listener: (event: {
      serverId: string;
      userId: string;
      /** The new member, as the server sent it */
      member: Member;
    }) => void,
  ) {
    return this.on("ServerMemberJoin", (packet) =>
      listener({
        serverId: packet.id,
        userId: packet.user,
        member: packet.member,
      }),
    );
  }

  /** A member left or was removed */
  onMemberLeave(
    listener: (event: {
      serverId: string;
      userId: string;
      /** `Leave`, `Kick` or `Ban` */
      reason: RemovalIntention;
    }) => void,
  ) {
    return this.on("ServerMemberLeave", (packet) =>
      listener({
        serverId: packet.id,
        userId: packet.user,
        reason: packet.reason,
      }),
    );
  }

  /** Someone reacted to a message */
  onReaction(
    listener: (event: {
      channelId: string;
      messageId: string;
      userId: string;
      emoji: string;
    }) => void,
  ) {
    return this.on("MessageReact", (packet) =>
      listener({
        channelId: packet.channel_id,
        messageId: packet.id,
        userId: packet.user_id,
        emoji: packet.emoji_id,
      }),
    );
  }

  /** Set the bot's status text (e.g. "Playing chess") and presence */
  setStatus(text: string | null, presence: Presence = "Online") {
    return this.rest.req("patch", "/users/@me", {
      status: { text: text ?? undefined, presence },
      ...(text === null ? { remove: ["StatusText"] } : {}),
    });
  }

  /**
   * Show "is typing…" in a channel for a few seconds. Never rejects, so it is
   * safe without `await`: a failure goes to `onError`.
   */
  async typing(channelId: string) {
    if (this.gateway.state === ConnectionState.Connected) {
      this.gateway.send({ type: "BeginTyping", channel: channelId });
      return;
    }
    try {
      await this.channels.typing(channelId);
    } catch (error) {
      this.#report(error);
    }
  }

  /**
   * Connect to the gateway with the token given here or to the constructor;
   * resolves once the bot is ready
   */
  async login(token?: string) {
    const use = token ?? this.options.token;
    if (!use)
      throw new TypeError("A bot token is required: client.login(token)");
    this.rest.authenticate({ bot: use });
    const me = await this.rest.req("get", "/users/@me");
    this.user = { ...me, id: me._id };
    const ready = new Promise<void>((resolve, reject) => {
      this.#readyResolvers.push(resolve);
      this.#readyRejecters.push(reject);
    });
    this.gateway.connect(this.options.wsUrl ?? DEFAULT_WS_URL, use);
    await ready;
    return this;
  }

  /**
   * Sign in without a gateway connection, for a bot that receives its
   * interactions over HTTP. Events other than interactions don't arrive.
   */
  async loginHttp(token?: string) {
    const use = token ?? this.options.token;
    if (!use)
      throw new TypeError("A bot token is required: client.loginHttp(token)");
    this.rest.authenticate({ bot: use });
    const me = await this.rest.req("get", "/users/@me");
    this.user = { ...me, id: me._id };
    return this;
  }

  /**
   * A handler for interactions over HTTP (standard `Request` and `Response`)
   * for your own server or framework: `command`, `component` and the others
   * work as they do over the gateway.
   */
  httpHandler(options: InteractionHandlerOptions) {
    return createInteractionHandler(options, (interaction) =>
      this.#onPacket({ type: "InteractionCreate", interaction }),
    );
  }

  /** Receive interactions over HTTP on a port (Node only) */
  listen(
    options: InteractionHandlerOptions & {
      port: number;
      hostname?: string;
      path?: string;
    },
  ) {
    return serveInteractions(this.httpHandler(options), options);
  }

  /** Disconnect for good */
  destroy() {
    this.gateway.close();
  }

  /**
   * Replace the bot's commands with exactly this list (global, or for one
   * server). Unchanged commands keep their ids.
   */
  syncCommands(
    commands: (CommandDefinition | { toJSON(): CommandDefinition })[],
    options: { serverId?: string } = {},
  ) {
    const id = this.#selfId();
    const body = commands.map(resolve);
    return options.serverId
      ? this.rest.put(
          `/applications/${id}/servers/${options.serverId}/commands`,
          body,
        )
      : this.rest.put(`/applications/${id}/commands`, body);
  }

  /** Commands currently registered (global, or for one server) */
  fetchCommands(options: { serverId?: string } = {}) {
    const id = this.#selfId();
    return options.serverId
      ? this.rest.get(
          `/applications/${id}/servers/${options.serverId}/commands`,
        )
      : this.rest.get(`/applications/${id}/commands`);
  }

  /** Add one command (global, or for one server) */
  createCommand(
    command: CommandDefinition | { toJSON(): CommandDefinition },
    options: { serverId?: string } = {},
  ) {
    const id = this.#selfId();
    const body = resolve(command);
    return options.serverId
      ? this.rest.post(
          `/applications/${id}/servers/${options.serverId}/commands`,
          body,
        )
      : this.rest.post(`/applications/${id}/commands`, body);
  }

  fetchCommand(commandId: string, options: { serverId?: string } = {}) {
    const id = this.#selfId();
    return options.serverId
      ? this.rest.get(
          `/applications/${id}/servers/${options.serverId}/commands/${commandId}`,
        )
      : this.rest.get(`/applications/${id}/commands/${commandId}`);
  }

  /** Change parts of one command; its id stays */
  editCommand(
    commandId: string,
    changes: DataEditApplicationCommand | { toJSON(): CommandDefinition },
    options: { serverId?: string } = {},
  ) {
    const id = this.#selfId();
    const body = resolve(changes);
    return options.serverId
      ? this.rest.patch(
          `/applications/${id}/servers/${options.serverId}/commands/${commandId}`,
          body,
        )
      : this.rest.patch(`/applications/${id}/commands/${commandId}`, body);
  }

  deleteCommand(commandId: string, options: { serverId?: string } = {}) {
    const id = this.#selfId();
    return options.serverId
      ? this.rest.delete(
          `/applications/${id}/servers/${options.serverId}/commands/${commandId}`,
        )
      : this.rest.delete(`/applications/${id}/commands/${commandId}`);
  }

  /** Send a message to a channel */
  async send(channelId: string, message: string | SendOptions) {
    const options =
      typeof message === "string" ? { content: message } : message;
    const components = toBlocks(options.components);
    const sent = await this.rest.req(
      "post",
      `/channels/${channelId}/messages`,
      {
        content: options.content,
        embeds: options.embeds?.map(resolve),
        components,
      },
    );
    return this.#withHelpers(sent, components);
  }

  /** Edit one of the bot's messages */
  async editMessage(
    channelId: string,
    messageId: string,
    message: string | SendOptions,
  ) {
    const options =
      typeof message === "string" ? { content: message } : message;
    const components = toBlocks(options.components);
    const edited = await this.rest.req(
      "patch",
      `/channels/${channelId}/messages/${messageId}`,
      {
        content: options.content,
        embeds: options.embeds?.map(resolve),
        components,
      },
    );
    return this.#withHelpers(edited, components);
  }

  #selfId() {
    if (!this.user) throw new Error("Call login() first");
    return this.user._id;
  }

  #emit(packet: BotPacket) {
    for (const listener of this.#listeners.get(packet.type) ?? []) {
      try {
        listener(packet);
      } catch (error) {
        this.#report(error);
      }
    }
  }

  #report(error: unknown, interaction?: Interaction) {
    (this.options.onError ?? ((e) => console.error("[@zrzur/bot]", e)))(
      error,
      interaction,
    );
  }

  #onPacket(packet: BotPacket) {
    if (packet.type === "DisallowedIntents") {
      const error = new Error(
        `${String(packet.reason || "Disallowed intents")}. Switch them on for the bot in the developer portal, or leave them out of \`intents\`.`,
      );
      this.#readyResolvers.splice(0);
      for (const reject of this.#readyRejecters.splice(0)) reject(error);
    }
    if (packet.type === "Ready") {
      this.#readyRejecters.splice(0);
      for (const resolve of this.#readyResolvers.splice(0)) resolve();
    }
    if (packet.type === "InteractionCreate") {
      const interaction = new Interaction(
        packet.interaction,
        this.rest,
        this.#context,
      );
      // listeners and collectors see every interaction, before the routers
      for (const listener of this.#interactionListeners) {
        try {
          Promise.resolve(listener(interaction)).catch((error) =>
            this.#report(error, interaction),
          );
        } catch (error) {
          this.#report(error, interaction);
        }
      }
      for (const collector of [...this.#collectors]) {
        collector
          .handle(interaction)
          .catch((error) => this.#report(error, interaction));
      }
      this.#route(interaction).catch((error) =>
        this.#report(error, interaction),
      );
    }
    if (packet.type === "MessageDelete") {
      for (const collector of [...this.#collectors]) {
        if (collector.messageId === packet.id) collector.stop("messageDelete");
      }
    }
    if (packet.type === "ChannelDelete") {
      for (const collector of [...this.#collectors]) {
        if (collector.channelId === packet.id) collector.stop("channelDelete");
      }
    }
    // keep up with the bot's own messages, wherever they were changed
    if (
      packet.type === "MessageUpdate" &&
      this.#componentsOf.has(packet.id as string)
    ) {
      const data = packet.data as { components?: ComponentBlock[] } | undefined;
      if (data?.components)
        this.#remember(packet.id as string, data.components);
    }
    this.#emit(packet);
  }

  async #route(interaction: Interaction) {
    const raw = interaction.raw;
    let handler: Handler | undefined;
    switch (raw.type) {
      case "Command":
        handler = this.#commands.get(raw.command!.name);
        break;
      case "Component":
        handler = this.#components.find(([m]) =>
          matches(m, raw.component!.custom_id),
        )?.[1];
        break;
      case "ModalSubmit":
        handler = this.#modals.find(([m]) =>
          matches(m, raw.modal!.custom_id),
        )?.[1];
        break;
      case "Autocomplete": {
        const key = `${raw.command!.name}:${raw.command!.focused}`;
        const suggest = this.#autocomplete.get(key);
        if (suggest) {
          await interaction.respond(await suggest(interaction));
        }
        return;
      }
    }
    if (handler) await handler(interaction);
  }
}
