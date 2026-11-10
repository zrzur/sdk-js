import type { Accessor, Setter } from "solid-js";
import { batch, createSignal } from "solid-js";

import { AsyncEventEmitter } from "@vladfrangu/async_event_emitter";

import type {
  ServerEvent as APIServerEvent,
  Error as ApiErrorBody,
  DataLogin,
  RevoltConfig,
  Role,
} from "../api/types.js";
import { API } from "../core/API.js";
import {
  ConnectionState,
  Gateway,
  type GatewayOptions,
} from "../core/Gateway.js";
import type { ProtocolV1, VoiceEvent } from "../core/protocol.js";
import {
  RE_CHANNELS,
  RE_CUSTOM_EMOJI,
  RE_MENTIONS,
  RE_SPOILER,
} from "../core/regex.js";

import type { Channel } from "./classes/Channel.js";
import type { Emoji } from "./classes/Emoji.js";
import type { Message } from "./classes/Message.js";
import type { Server } from "./classes/Server.js";
import type { ServerMember } from "./classes/ServerMember.js";
import type { User, UserLimits } from "./classes/User.js";
import {
  AccountCollection,
  type AgeBand,
} from "./collections/AccountCollection.js";
import { BotCollection } from "./collections/BotCollection.js";
import { ChannelCollection } from "./collections/ChannelCollection.js";
import { ChannelUnreadCollection } from "./collections/ChannelUnreadCollection.js";
import { ChannelWebhookCollection } from "./collections/ChannelWebhookCollection.js";
import { EmojiCollection } from "./collections/EmojiCollection.js";
import { MessageCollection } from "./collections/MessageCollection.js";
import { ServerCollection } from "./collections/ServerCollection.js";
import { ServerEventCollection } from "./collections/ServerEventCollection.js";
import { ServerMemberCollection } from "./collections/ServerMemberCollection.js";
import { SessionCollection } from "./collections/SessionCollection.js";
import { UserCollection } from "./collections/UserCollection.js";
import { handleEvent } from "./events/v1.js";
import type { HydratedChannel } from "./hydration/channel.js";
import type { HydratedEmoji } from "./hydration/emoji.js";
import type { HydratedMessage } from "./hydration/message.js";
import type { HydratedServer } from "./hydration/server.js";
import type { HydratedServerMember } from "./hydration/serverMember.js";
import type { HydratedUser } from "./hydration/user.js";
import { proxiedImageURL } from "./lib/proxy.js";
import { type ProxyTicket, ProxyTicketKeeper } from "./lib/proxyTicket.js";

export type Session = { _id: string; token: string; user_id: string } | string;

/**
 * Events provided by the client
 */
export type Events = {
  error: [error: ApiErrorBody | Error | Event];

  connected: [];
  connecting: [];
  disconnected: [];
  ready: [];
  logout: [];

  policyChanges: [
    policyChanges: ProtocolV1["types"]["policyChange"][],
    acknowledge: () => Promise<void>,
  ];

  messageCreate: [message: Message];
  messageUpdate: [message: Message, previousMessage: HydratedMessage];
  messageDelete: [message: HydratedMessage];
  messageDeleteBulk: [messages: HydratedMessage[], channel?: Channel];
  messageReactionAdd: [message: Message, userId: string, emoji: string];
  messageReactionRemove: [message: Message, userId: string, emoji: string];
  messageReactionRemoveEmoji: [message: Message, emoji: string];
  /** Poll counts changed, or your choice, or it ended (Zrzur) */
  messagePollUpdate: [message: Message];

  channelCreate: [channel: Channel];
  channelUpdate: [channel: Channel, previousChannel: HydratedChannel];
  channelDelete: [channel: HydratedChannel];
  channelGroupJoin: [channel: Channel, user: User];
  channelGroupLeave: [channel: Channel, user?: User];
  channelStartTyping: [channel: Channel, user?: User];
  channelStopTyping: [channel: Channel, user?: User];
  channelAcknowledged: [channel: Channel, messageId: string];

  serverCreate: [server: Server];
  serverUpdate: [server: Server, previousServer: HydratedServer];
  serverDelete: [server: HydratedServer];
  serverLeave: [server: HydratedServer];
  serverRoleUpdate: [server: Server, roleId: string, previousRole?: Role];
  serverRoleRanksUpdate: [server: Server, ranks: string[]];
  serverRoleDelete: [server: Server, roleId: string, role?: Role];

  serverMemberUpdate: [
    member: ServerMember,
    previousMember: HydratedServerMember,
  ];
  serverMemberJoin: [member: ServerMember];
  serverMemberLeave: [member: HydratedServerMember];

  userUpdate: [user: User, previousUser: HydratedUser];
  // ^ userRelationshipChanged: [user: User, previousRelationship: RelationshipStatus];
  // ^ userPresenceChanged: [user: User, previousPresence: boolean];
  userSettingsUpdate: [id: string, update: Record<string, [number, string]>];
  /** the age group of your account changed (on any of your devices) */
  accountAgeUpdate: [band: AgeBand];

  emojiCreate: [emoji: Emoji];
  emojiDelete: [emoji: HydratedEmoji];

  userSlowmodes: [];
  /** A scheduled event you marked "Interested" started */
  serverEventStarted: [event: APIServerEvent];
  voiceChannelLeave: [channelId: string, userId: string];
  /** Stage and soundboard events, for the app's voice screens */
  voiceEvent: [event: VoiceEvent];
  userMoveVoiceChannel: [
    move: { node: string; from: string; to: string; token: string },
  ];
};

/**
 * Client options object
 */
export type ClientOptions = Partial<
  Omit<GatewayOptions, "reconnect" | "intents">
> & {
  /**
   * Base URL of the API server
   */
  baseURL: string;

  /**
   * Whether to allow partial objects to emit from events
   * @default false
   */
  partials: boolean;

  /**
   * Whether to eagerly fetch users and members for incoming events
   * @default true
   * @deprecated
   */
  eagerFetching: boolean;

  /**
   * Whether to automatically sync unreads information
   * @default false
   */
  syncUnreads: boolean;

  /**
   * Whether to reconnect when disconnected
   * @default true
   */
  autoReconnect: boolean;

  /**
   * Whether to rewrite sent messages that include identifiers such as @silent
   * @default true
   */
  messageRewrites: boolean;

  /**
   * Retry delay function
   * @param retryCount Count
   * @returns Delay in seconds
   * @default (2^x-1) ±20%
   */
  retryDelayFunction(retryCount: number): number;

  /**
   * Check whether a channel is muted
   * @param channel Channel
   * @return Whether it is muted or through inheritance
   * @default false
   */
  channelIsMuted(channel: Channel): boolean;

  /**
   * Check whether a channel is exclusively muted (irrespective of server)
   * @param channel Channel
   * @return Whether it is exclusively muted
   * @default false
   */
  channelExclusiveMuted(channel: Channel): boolean;
};

/**
 * Zrzur client for SolidJS apps: reactive collections over the API and gateway
 */
export class Client extends AsyncEventEmitter<Events> {
  readonly account;
  readonly bots;
  readonly channels;
  readonly channelUnreads;
  readonly channelWebhooks;
  /** Scheduled server events */
  readonly serverEvents;
  readonly emojis;
  readonly messages;
  readonly servers;
  readonly serverMembers;
  readonly sessions;
  readonly users;

  readonly api: API;
  readonly options: ClientOptions;
  readonly events: Gateway;

  readonly configuration: RevoltConfig | undefined;
  #configLock?: Promise<void>;
  #session: Session | undefined;
  #proxyTickets: ProxyTicketKeeper | undefined;
  /** Set once a ticket is held, so images drawn before it are drawn again */
  #hasProxyTicket: Accessor<boolean>;
  #setHasProxyTicket: Setter<boolean>;
  user: User | undefined;

  readonly ready: Accessor<boolean>;
  #setReady: Setter<boolean>;

  readonly configured: Accessor<boolean>;
  #setConfigured: Setter<boolean>;

  /**
   * Language the app is shown in; official accounts are named in it
   */
  readonly language: Accessor<string | undefined>;
  /**
   * Set the language the app is shown in
   */
  readonly setLanguage: Setter<string | undefined>;

  readonly connectionFailureCount: Accessor<number>;
  #setConnectionFailureCount: Setter<number>;

  /**
   * Create a client
   * @param configuration Deprecated - Please use `Client.initConfig` if you need to override config.
   */
  constructor(options?: Partial<ClientOptions>, configuration?: RevoltConfig) {
    super();

    this.options = {
      // no default host: callers must pass baseURL
      baseURL: "",
      partials: false,
      eagerFetching: true,
      syncUnreads: false,
      autoReconnect: true,
      messageRewrites: true,
      /**
       * Retry delay function
       * @param retryCount Count
       * @returns Delay in seconds
       */
      retryDelayFunction(retryCount: number) {
        return (Math.pow(2, retryCount) - 1) * (0.8 + Math.random() * 0.4);
      },
      /**
       * Check whether a channel is muted
       * @param channel Channel
       * @return Whether it is muted
       */
      channelIsMuted() {
        return false;
      },
      /**
       * Check whether a channel is exclusively muted (irrespective of server)
       * @param channel Channel
       * @return Whether it is exclusively muted
       * @default false
       */
      channelExclusiveMuted() {
        return false;
      },
      ...options,
    };

    this.configuration = configuration;

    // fails closed without a baseURL: there is no default host
    this.api = new API({
      baseURL: this.options.baseURL,
    });

    const [configured, setConfigured] = createSignal(
      configuration !== undefined,
    );
    this.configured = configured;
    this.#setConfigured = setConfigured;

    const [hasProxyTicket, setHasProxyTicket] = createSignal(false);
    this.#hasProxyTicket = hasProxyTicket;
    this.#setHasProxyTicket = setHasProxyTicket;

    const [ready, setReady] = createSignal(false);
    this.ready = ready;
    this.#setReady = setReady;

    const [language, setLanguage] = createSignal<string | undefined>();
    this.language = language;
    this.setLanguage = setLanguage;

    const [connectionFailureCount, setConnectionFailureCount] = createSignal(0);
    this.connectionFailureCount = connectionFailureCount;
    this.#setConnectionFailureCount = setConnectionFailureCount;

    this.account = new AccountCollection(this);
    this.bots = new BotCollection(this);
    this.channels = new ChannelCollection(this);
    this.channelUnreads = new ChannelUnreadCollection(this);
    this.channelWebhooks = new ChannelWebhookCollection(this);
    this.serverEvents = new ServerEventCollection(this);
    this.emojis = new EmojiCollection(this);
    this.messages = new MessageCollection(this);
    this.servers = new ServerCollection(this);
    this.serverMembers = new ServerMemberCollection(this);
    this.sessions = new SessionCollection(this);
    this.users = new UserCollection(this);

    this.events = new Gateway({
      ...this.options,
      reconnect: this.options.autoReconnect
        ? (attempt) => this.options.retryDelayFunction(attempt) * 1e3
        : false,
    });
    this.events.on("error", (error) =>
      this.listenerCount("error") > 0 ? this.emit("error", error) : undefined,
    );
    this.events.on("state", (state) => {
      switch (state) {
        case ConnectionState.Connected:
          batch(() => {
            this.servers.forEach((server) => server.resetSyncStatus());
            this.#setConnectionFailureCount(0);
            this.emit("connected");
          });
          break;
        case ConnectionState.Connecting:
          this.#setReady(false);
          this.channelUnreads.cancelBackgroundSync();
          this.emit("connecting");
          break;
        case ConnectionState.Disconnected:
          this.channelUnreads.cancelBackgroundSync();
          // the gateway reconnects by itself when autoReconnect is on
          if (this.options.autoReconnect) {
            this.#setConnectionFailureCount((count) => count + 1);
          }
          this.emit("disconnected");
          break;
      }
    });

    this.events.on("event", (event) =>
      handleEvent(this, event, this.#setReady),
    );
  }

  /**
   * Current session id
   */
  get sessionId(): string | undefined {
    return typeof this.#session === "string" ? undefined : this.#session?._id;
  }

  /**
   * Get authentication header
   */
  get authenticationHeader(): [string, string] {
    return typeof this.#session === "string"
      ? ["X-Bot-Token", this.#session]
      : ["X-Session-Token", this.#session?.token as string];
  }

  /**
   * Connect to the configured Zrzur/instance events endpoint.
   * Fails when the server configuration has no WebSocket URL.
   */
  connect(): void {
    this.#setReady(false);
    const ws = this.configuration?.ws;
    if (!ws) {
      throw new Error("Zrzur: the server configuration has no WebSocket URL.");
    }
    if (!this.options.baseURL) {
      throw new Error("Zrzur: API baseURL is not configured.");
    }
    this.events.connect(
      ws,
      typeof this.#session === "string" ? this.#session : this.#session!.token,
    );
  }

  /**
   * Fetches the server config. This is called automatically by `login()` or `loginBot()`,
   * but you can call it first manually if you need to override any config options.
   *
   * Override example:
   * ```ts
   * await client.initConfig((config) => {
   *   config.ws = "wss://example.com";
   * });
   * ```
   */
  async initConfig(preConfig?: (config: RevoltConfig) => void): Promise<void> {
    if (!this.#configLock && !this.configuration) {
      //Create promise lock to avoid race condition
      this.#configLock = (async () => {
        //@ts-expect-error readonly override
        this.configuration = await this.api.get("/");
        preConfig?.(this.configuration);
        this.#setConfigured(true);
        this.#configLock = undefined;
      })();
    }
    return this.#configLock;
  }

  /**
   * Update API object to use authentication.
   */
  #updateHeaders(): void {
    (this.api as API) = new API({
      baseURL: this.options.baseURL,
      authentication: {
        ...(typeof this.#session === "string"
          ? { bot: this.#session }
          : { session: this.#session?.token }),
      },
    });
  }

  /**
   * Log in with auth data, creating a new session in the process.
   * @param details Login data object
   * @returns An on-boarding function if on-boarding is required, undefined otherwise
   */
  async login(details: DataLogin): Promise<void> {
    await this.initConfig();
    const data = await this.api.post("/auth/session/login", details);
    if (data.result === "Success") {
      this.#session = data;
      // TODO: return await this.connect();
    } else {
      throw "MFA not implemented!";
    }
  }

  /**
   * Use an existing session
   */
  useExistingSession(session: Session): void {
    this.#session = session;
    this.#updateHeaders();
    this.#setHasProxyTicket(false);
    this.#proxyTickets = new ProxyTicketKeeper(
      // not in the generated table until the snapshot is refreshed
      () => this.api.raw<ProxyTicket>("post", "/auth/session/proxy_ticket"),
      () => this.#setHasProxyTicket(true),
    );
    this.#proxyTickets.current();
  }

  /**
   * Log in as a bot
   * @param token Bot token
   */
  async loginBot(token: string): Promise<void> {
    await this.initConfig();
    this.#session = token;
    this.#updateHeaders();
    this.connect();
  }

  /**
   * Log out of current session
   *
   * This function prepares the client for disposal by removing all event listeners and killing the events socket.
   */
  async logout(): Promise<void> {
    this.channelUnreads.cancelBackgroundSync();
    this.#proxyTickets = undefined;
    await this.api.post("/auth/session/logout");
    this.events.removeAllListeners();
    this.removeAllListeners();
    this.events.close();
  }

  /**
   * Messages from the last 30 days that mention you (by name, by one of your
   * roles, or with @everyone / @here) in channels you can see, newest first
   * @param limit How many to fetch (1 to 100, default 50)
   */
  async fetchMentions(limit = 50): Promise<Message[]> {
    const data = await this.api.get("/users/@me/mentions", { limit });

    const messages = Array.isArray(data) ? data : data.messages;
    const users = Array.isArray(data) ? [] : (data.users ?? []);

    return batch(() => {
      for (const user of users) this.users.getOrCreate(user._id, user);
      return messages.map((message) =>
        this.messages.getOrCreate(message._id, message),
      );
    });
  }

  /**
   * Prepare a markdown-based message to be displayed to the user as plain text.
   * @param source Source markdown text
   * @returns Modified plain text
   */
  markdownToText(source: string): string {
    return source
      .replace(RE_MENTIONS, (sub: string, id: string) => {
        const user = this.users.get(id as string);

        if (user) {
          return `@${user.username}`;
        }

        return sub;
      })
      .replace(RE_CHANNELS, (sub: string, id: string) => {
        const channel = this.channels.get(id as string);

        if (channel) {
          return `#${channel.displayName}`;
        }

        return sub;
      })
      .replace(RE_CUSTOM_EMOJI, (sub: string, id: string) => {
        const emoji = this.emojis.get(id as string);

        if (emoji) {
          return `:${emoji.name}:`;
        }

        return sub;
      })
      .replace(RE_SPOILER, "<spoiler>");
  }

  /**
   * Prepare a markdown-based message to be displayed to the user as plain text. This method will fetch each user or channel if they are missing. Useful for serviceworkers.
   * @param source Source markdown text
   * @returns Modified plain text
   */
  async markdownToTextFetch(source: string): Promise<string> {
    // Get all user matches, create a map to dedupe
    const userMatches = Object.fromEntries(
      Array.from(source.matchAll(RE_MENTIONS), (match) => {
        return [match[0], match[1]];
      }),
    );

    // Get all channel matches, create a map to dedupe
    const channelMatches = Object.fromEntries(
      Array.from(source.matchAll(RE_CHANNELS), (match) => {
        return [match[0], match[1]];
      }),
    );

    // Get all custom emoji matches, create a map to dedupe
    const customEmojiMatches = Object.fromEntries(
      Array.from(source.matchAll(RE_CUSTOM_EMOJI), (match) => {
        return [match[0], match[1]];
      }),
    );

    // Send requests to replace user ids
    const userReplacementPromises = Object.keys(userMatches).map(
      async (key) => {
        const substr = userMatches[key];
        if (substr) {
          try {
            const user = await this.users.fetch(substr);
            if (user) {
              return [key, `@${user.username}`];
            }
          } catch {
            // If the fetch fails, just show the match as a default
            return [key, key];
          }
        }

        return [key, key];
      },
    );

    // Send requests to replace channel ids
    const channelReplacementPromises = Object.keys(channelMatches).map(
      async (key) => {
        const substr = channelMatches[key];
        if (substr) {
          try {
            const channel = await this.channels.fetch(substr);
            if (channel) {
              return [key, `#${channel.displayName}`];
            }
          } catch {
            // If the fetch fails, just show the match as a default
            return [key, key];
          }
        }

        return [key, key];
      },
    );

    // Send requests to replace custom emojis
    const customEmojiReplacementPromises = Object.keys(customEmojiMatches).map(
      async (key) => {
        const substr = customEmojiMatches[key];
        if (substr) {
          try {
            const emoji = await this.emojis.fetch(substr);
            if (emoji) {
              return [key, `:${emoji.name}:`];
            }
          } catch {
            // If the fetch fails, just show the match as a default
            return [key, key];
          }
        }

        return [key, key];
      },
    );

    // Await for all promises to get the strings to replace with.
    const replacements = await Promise.all([
      ...userReplacementPromises,
      ...channelReplacementPromises,
      ...customEmojiReplacementPromises,
    ]);

    const replacementsMap = Object.fromEntries(replacements);

    return source
      .replace(RE_MENTIONS, (match) => replacementsMap[match])
      .replace(RE_CHANNELS, (match) => replacementsMap[match])
      .replace(RE_CUSTOM_EMOJI, (match) => replacementsMap[match])
      .replace(RE_SPOILER, "<spoiler>");
  }

  /**
   * Proxy a file through January.
   * @param url URL to proxy
   * @returns Proxied media URL
   */
  proxyFile(url: string): string | undefined {
    const features = this.configuration?.features;
    this.#hasProxyTicket();
    return proxiedImageURL(
      url,
      features?.january.enabled ? features.january.url : undefined,
      features?.autumn.url,
      this.#proxyTickets?.current(),
    );
  }

  /**
   * Upload a file
   * @param tag Tag
   * @param file File
   * @param uploadUrl Media server upload route
   */
  async uploadFile(
    tag: string,
    file: File,
    uploadUrl?: string,
  ): Promise<string> {
    const body = new FormData();
    body.append("file", file);
    const base = uploadUrl ?? this.configuration?.features.autumn.url;
    if (!base) throw new Error("This server has no file service");
    return (await this.api.upload(`${base.replace(/\/$/, "")}/${tag}`, body))
      .id;
  }

  /**
   * Backend enforced limits for the logged in user
   */
  get limits(): UserLimits | undefined {
    if (this.configured() && this.user) return this.user.limits;
  }
}
