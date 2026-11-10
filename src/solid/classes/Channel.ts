import { Accessor, Setter, batch, createSignal } from "solid-js";

import { ReactiveMap } from "@solid-primitives/map";
import type { ReactiveSet } from "@solid-primitives/set";
import { decodeTime, ulid } from "ulid";

import type {
  Channel as APIChannel,
  Member as APIMember,
  Message as APIMessage,
  User as APIUser,
  Category,
  DataCreateInvite,
  DataEditChannel,
  DataMessageSearch,
  DataMessageSend,
  Invite,
  Override,
} from "../../api/types.js";
import type { APIRoutes } from "../../core/API.js";
import { Permission } from "../../core/permissions.js";
import type { UserSlowmodes } from "../../core/protocol.js";
import { ChannelCollection } from "../collections/index.js";
import type {
  ForumInformation,
  ThreadInformation,
} from "../hydration/channel.js";
import { hydrate } from "../hydration/index.js";
import { MessageFlags } from "../hydration/message.js";
import {
  bitwiseAndEq,
  calculatePermission,
} from "../permissions/calculator.js";

import type { ChannelWebhook } from "./ChannelWebhook.js";
import type { File } from "./File.js";
import type { Message } from "./Message.js";
import type { Server } from "./Server.js";
import type { ServerMember } from "./ServerMember.js";
import type { User } from "./User.js";
import { VoiceParticipant, VoiceStatus } from "./VoiceParticipant.js";

/**
 * Channel Class
 */
export class Channel {
  readonly #collection: ChannelCollection;
  readonly id: string;

  _typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  voiceParticipants = new ReactiveMap<string, VoiceParticipant>();

  readonly userSlowmode: Accessor<UserSlowmodes | undefined>;
  readonly #setUserSlowmode: Setter<UserSlowmodes | undefined>;
  #slowmodeTimeout: ReturnType<typeof setTimeout> | undefined;

  /**
   * Construct Channel
   * @param collection Collection
   * @param id Channel Id
   */
  constructor(collection: ChannelCollection, id: string) {
    this.#collection = collection;
    this.id = id;

    const [slowmode, setSlowmode] = createSignal<UserSlowmodes | undefined>();
    this.userSlowmode = slowmode;
    this.#setUserSlowmode = setSlowmode;
  }

  /**
   * Write to string as a channel mention
   * @returns Formatted String
   */
  toString(): string {
    return `<#${this.id}>`;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !!this.#collection.getUnderlyingObject(this.id).id;
  }

  /**
   * Time when this server was created
   */
  get createdAt(): Date {
    return new Date(decodeTime(this.id));
  }

  /**
   * Channel type
   */
  get type(): APIChannel["channel_type"] {
    return this.#collection.getUnderlyingObject(this.id).channelType;
  }

  /**
   * Absolute pathname to this channel in the client
   */
  get path(): string {
    if (this.serverId) {
      return `/server/${this.serverId}/channel/${this.id}`;
    } else {
      return `/channel/${this.id}`;
    }
  }

  /**
   * URL to this channel
   */
  get url(): string {
    return this.#collection.client.configuration?.app + this.path;
  }

  /**
   * Channel name
   */
  get name(): string {
    return this.#collection.getUnderlyingObject(this.id).name;
  }

  /**
   * Display name
   */
  get displayName(): string | undefined {
    return this.type === "SavedMessages"
      ? this.user?.username
      : this.type === "DirectMessage"
        ? this.recipient?.official
          ? this.recipient.displayName
          : this.recipient?.username
        : this.name;
  }

  /**
   * Channel description
   */
  get description(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).description;
  }

  /**
   * Channel icon
   */
  get icon(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).icon;
  }

  /**
   * Whether the conversation is active
   */
  get active(): boolean {
    return this.#collection.getUnderlyingObject(this.id).active;
  }

  /**
   * User ids of people currently typing in channel
   */
  get typingIds(): ReactiveSet<string> {
    return this.#collection.getUnderlyingObject(this.id).typingIds;
  }

  /**
   * Users currently trying in channel
   */
  get typing(): User[] {
    return [...this.typingIds.values()].map(
      (id) => this.#collection.client.users.get(id)!,
    );
  }

  /**
   * User ids of recipients of the group
   */
  get recipientIds(): ReactiveSet<string> {
    return this.#collection.getUnderlyingObject(this.id).recipientIds;
  }

  /**
   * Recipients of the group
   */
  get recipients(): User[] {
    return [
      ...this.#collection.getUnderlyingObject(this.id).recipientIds.values(),
    ].map((id) => this.#collection.client.users.get(id)!);
  }

  /**
   * Find recipient of this DM
   */
  get recipient(): User | undefined {
    return this.type === "DirectMessage"
      ? this.recipients?.find(
          (user) => user?.id !== this.#collection.client.user!.id,
        )
      : undefined;
  }

  /**
   * User ID
   */
  get userId(): string {
    return this.#collection.getUnderlyingObject(this.id).userId!;
  }

  /**
   * User this channel belongs to
   */
  get user(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).userId!,
    );
  }

  /**
   * Owner ID
   */
  get ownerId(): string {
    return this.#collection.getUnderlyingObject(this.id).ownerId!;
  }

  /**
   * Owner of the group
   */
  get owner(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).ownerId!,
    );
  }

  /**
   * Server ID
   */
  get serverId(): string {
    return this.#collection.getUnderlyingObject(this.id).serverId!;
  }

  /**
   * Server this channel is in
   */
  get server(): Server | undefined {
    return this.#collection.client.servers.get(
      this.#collection.getUnderlyingObject(this.id).serverId!,
    );
  }

  /**
   * Permissions allowed for users in this group
   */
  get permissions(): bigint | undefined {
    return this.#collection.getUnderlyingObject(this.id).permissions;
  }

  /**
   * Default permissions for this server channel
   */
  get defaultPermissions(): { a: bigint; d: bigint } | undefined {
    return this.#collection.getUnderlyingObject(this.id).defaultPermissions;
  }

  /**
   * Role permissions for this server channel
   */
  get rolePermissions(): Record<string, { a: bigint; d: bigint }> | undefined {
    return this.#collection.getUnderlyingObject(this.id).rolePermissions;
  }

  /**
   * Permissions for single members in this server channel, by user id
   */
  get memberPermissions():
    | Record<string, { a: bigint; d: bigint }>
    | undefined {
    return this.#collection.getUnderlyingObject(this.id).memberPermissions;
  }

  /**
   * Id of the channel this thread belongs to
   */
  get parentId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).parentId;
  }

  /**
   * The channel this thread belongs to
   */
  get parent(): Channel | undefined {
    const id = this.parentId;
    return id ? this.#collection.get(id) : undefined;
  }

  /**
   * Thread state, when this channel is a thread
   */
  get thread(): ThreadInformation | undefined {
    return this.#collection.getUnderlyingObject(this.id).thread;
  }

  /**
   * Forum settings, when this channel is a forum (every post is a thread)
   */
  get forum(): ForumInformation | undefined {
    return this.#collection.getUnderlyingObject(this.id).forum;
  }

  /**
   * Whether this channel is a thread
   */
  get isThread(): boolean {
    return !!this.thread;
  }

  /**
   * Whether this channel is a forum
   */
  get isForum(): boolean {
    return !!this.forum;
  }

  /**
   * The thread started from a message of this channel, if one is known
   * @param messageId Message id
   */
  threadOf(messageId: string): Channel | undefined {
    return this.#collection.find(
      (channel) =>
        channel.parentId === this.id &&
        channel.thread?.starterMessageId === messageId,
    );
  }

  /**
   * Start a thread here: from a message, or with a first message (required
   * in forums, where it is a post with a title and tags)
   */
  async createThread(data: {
    name: string;
    message?: string;
    content?: string;
    tags?: string[];
  }): Promise<Channel> {
    const channel = await this.#collection.client.api.post(
      `/channels/${this.id}/threads`,
      data,
    );
    return this.#collection.getOrCreate(channel._id, channel);
  }

  /**
   * Threads of this channel, newest first (active ones, or archived)
   */
  async fetchThreads(
    options: { archived?: boolean; before?: string; limit?: number } = {},
  ): Promise<Channel[]> {
    const channels = await this.#collection.client.api.get(
      `/channels/${this.id}/threads`,
      {
        archived: options.archived || undefined,
        before: options.before,
        limit: options.limit || undefined,
      },
    );
    return channels.map((channel) =>
      this.#collection.getOrCreate(channel._id, channel),
    );
  }

  /**
   * Change this thread: name, archived, locked (moderators), forum tags
   */
  async editThread(data: {
    name?: string;
    archived?: boolean;
    locked?: boolean;
    tags?: string[];
  }): Promise<APIChannel> {
    return await this.#collection.client.api.patch(
      `/channels/${this.id}/thread`,
      data,
    );
  }

  /**
   * Whether this server channel uses its category's default and role
   * permissions instead of its own
   */
  get permissionsSynced(): boolean {
    return this.#collection.getUnderlyingObject(this.id).permissionsSynced;
  }

  /**
   * The category whose permissions this channel follows, when it is synced
   * with one
   */
  get syncedCategory(): Category | undefined {
    if (!this.permissionsSynced) return undefined;
    return this.server?.categories?.find((category) =>
      category.channels.includes(this.id),
    );
  }

  /**
   * Whether this channel is marked as mature
   */
  get mature(): boolean {
    return this.#collection.getUnderlyingObject(this.id).nsfw;
  }

  /**
   * ID of the last message sent in this channel
   */
  get lastMessageId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).lastMessageId;
  }

  /**
   * Last message sent in this channel
   */
  get lastMessage(): Message | undefined {
    return this.#collection.client.messages.get(this.lastMessageId!);
  }

  /**
   * Time when the last message was sent
   */
  get lastMessageAt(): Date | undefined {
    return this.lastMessageId && this.lastMessageId.length === 26
      ? new Date(decodeTime(this.lastMessageId))
      : undefined;
  }

  /**
   * Time when the channel was last updated (either created or a message was sent)
   */
  get updatedAt(): Date {
    return this.lastMessageAt ?? this.createdAt;
  }

  /**
   * Whether this channel is unread
   */
  get unread(): boolean {
    if (
      !this.lastMessageId ||
      this.type === "SavedMessages" ||
      this.isVoiceRoom ||
      this.#collection.client.options.channelExclusiveMuted(this)
    )
      return false;

    const client = this.#collection.client;
    // before the first sync nothing is known: never "unread"
    if (client.options.syncUnreads && !client.channelUnreads.loaded) {
      return false;
    }

    const unread = client.channelUnreads.for(this);
    // the newest message is this account's own: nothing in here is new
    // (covers read marks the server kept from before it acked own messages)
    if (
      client.user &&
      this.lastMessage?.authorId === client.user.id &&
      unread.messageMentionIds.size === 0
    ) {
      return false;
    }
    return (
      (unread.lastMessageId ?? "0").localeCompare(this.lastMessageId) === -1 ||
      unread.messageMentionIds.size > 0
    );
  }

  /**
   * Whether this channel is muted
   */
  get muted(): boolean {
    return this.#collection.client.options.channelIsMuted(this);
  }

  /**
   * Get mentions in this channel for user.
   */
  get mentions(): ReactiveSet<string> | undefined {
    if (this.type === "SavedMessages" || this.isVoiceRoom) return undefined;

    return this.#collection.client.channelUnreads.get(this.id)
      ?.messageMentionIds;
  }

  /**
   * Whether this is a 'voice chats v2' channel
   *
   * NB. subject to change as vc(2) goes to production
   */
  get isVoice(): boolean {
    return (
      this.type === "DirectMessage" ||
      this.type === "Group" ||
      typeof this.#collection.getUnderlyingObject(this.id).voice === "object"
    );
  }

  /**
   * Server voice channel: a voice room only. Its messages (call started
   * notices) are never read as chat, so it never counts as unread.
   */
  get isVoiceRoom(): boolean {
    return (
      this.type === "TextChannel" &&
      typeof this.#collection.getUnderlyingObject(this.id).voice === "object"
    );
  }

  /** Configured voice room information. */
  get voice(): { maxUsers?: number } | undefined {
    return this.#collection.getUnderlyingObject(this.id).voice;
  }

  /**
   * URL to the channel icon
   */
  get iconURL(): string | undefined {
    return this.icon?.createFileURL() ?? this.recipient?.avatarURL;
  }

  /**
   * URL to the animated channel icon
   */
  get animatedIconURL(): string | undefined {
    return this.icon?.createFileURL(true) ?? this.recipient?.animatedAvatarURL;
  }

  /**
   * Whether this channel may be hidden to some users
   */
  get potentiallyRestrictedChannel(): string | boolean | undefined {
    if (!this.serverId) return false;
    return (
      bitwiseAndEq(this.defaultPermissions?.d ?? 0n, Permission.ViewChannel) ||
      !bitwiseAndEq(this.server!.defaultPermissions, Permission.ViewChannel) ||
      [...(this.server?.roles.keys() ?? [])].find(
        (role) =>
          bitwiseAndEq(
            this.rolePermissions?.[role]?.d ?? 0n,
            Permission.ViewChannel,
          ) ||
          bitwiseAndEq(
            this.server?.roles.get(role)?.permissions.d ?? 0n,
            Permission.ViewChannel,
          ),
      )
    );
  }

  /**
   * Permission the currently authenticated user has against this channel
   */
  get permission(): bigint {
    return calculatePermission(this.#collection.client, this);
  }

  /**
   * Check whether we have a given permission in a channel
   * @param permission Permission Names
   * @returns Whether we have this permission
   */
  havePermission(...permission: (keyof typeof Permission)[]): boolean {
    return bitwiseAndEq(
      this.permission,
      ...permission.map((x) => Permission[x]),
    );
  }

  /**
   * Check whether we have at least one of the given permissions in a channel
   * @param permission Permission Names
   * @returns Whether we have one of the permissions
   */
  orPermission(...permission: (keyof typeof Permission)[]): boolean {
    return (
      permission.findIndex((x) =>
        bitwiseAndEq(this.permission, Permission[x]),
      ) !== -1
    );
  }

  /**
   * Fetch a channel's members.
   * @requires `Group`
   * @returns An array of the channel's members.
   */
  async fetchMembers(): Promise<User[]> {
    const members = await this.#collection.client.api.get(
      `/channels/${this.id as ""}/members`,
    );

    return batch(() =>
      members.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
    );
  }

  /**
   * Create a webhook
   * @param name Webhook name
   * @returns The newly-created webhook
   */
  async createWebhook(name: string): Promise<ChannelWebhook> {
    const webhook = await this.#collection.client.api.post(
      `/channels/${this.id as ""}/webhooks`,
      {
        name,
      },
    );

    return this.#collection.client.channelWebhooks.getOrCreate(
      webhook.id,
      webhook,
    );
  }

  /**
   * Fetch a channel's webhooks
   * @requires `TextChannel`, `Group`
   * @returns Webhooks
   */
  async fetchWebhooks(): Promise<ChannelWebhook[]> {
    const webhooks = await this.#collection.client.api.get(
      `/channels/${this.id as ""}/webhooks`,
    );

    return batch(() =>
      webhooks.map((webhook) =>
        this.#collection.client.channelWebhooks.getOrCreate(
          webhook.id,
          webhook,
        ),
      ),
    );
  }

  /**
   * Edit a channel
   * @param data Changes
   */
  async edit(
    data: DataEditChannel & {
      /** Make it an announcement channel (text channels only) */
      announcement?: boolean;
    },
  ) {
    const channel = await this.#collection.client.api.patch(
      `/channels/${this.id as ""}`,
      data,
    );

    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate("channel", channel, this.#collection.client, false),
    );
  }

  /**
   * Delete or leave a channel
   * @param leaveSilently Whether to not send a message on leave
   * @requires `DirectMessage`, `Group`, `TextChannel`
   */
  async delete(leaveSilently?: boolean): Promise<void> {
    await this.#collection.client.api.delete(`/channels/${this.id as ""}`, {
      leave_silently: leaveSilently,
    });

    if (this.type === "DirectMessage") {
      this.#collection.updateUnderlyingObject(this.id, "active", false);
      return;
    }

    this.#collection.delete(this.id);
  }

  /**
   * Add a user to a group
   * @param user_id ID of the target user
   * @requires `Group`
   */
  async addMember(user_id: string): Promise<void> {
    return await this.#collection.client.api.put(
      `/channels/${this.id as ""}/recipients/${user_id as ""}`,
    );
  }

  /**
   * Remove a user from a group
   * @param user_id ID of the target user
   * @requires `Group`
   */
  async removeMember(user_id: string): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.id as ""}/recipients/${user_id as ""}`,
    );
  }

  /**
   * Send a message
   * @param data Either the message as a string or message sending route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Sent message
   */
  async sendMessage(
    data: string | DataMessageSend,
    idempotencyKey: string = ulid(),
  ): Promise<Message> {
    const msg: DataMessageSend =
      typeof data === "string" ? { content: data } : data;

    // Mark as silent message
    if (msg.content?.startsWith("@silent ")) {
      msg.content = msg.content.substring(8);
      msg.flags = (msg.flags ?? 0) | (1 << MessageFlags.SuppressNotifications);
    }

    const message = await this.#collection.client.api.post(
      `/channels/${this.id as ""}/messages`,
      msg,
      {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      },
    );

    return this.#collection.client.messages.getOrCreate(
      message._id,
      message,
      true,
    );
  }

  /**
   * Fetch a message by its ID
   * @param messageId ID of the target message
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Message
   */
  async fetchMessage(messageId: string): Promise<Message> {
    const message = await this.#collection.client.api.get(
      `/channels/${this.id as ""}/messages/${messageId as ""}`,
    );

    return this.#collection.client.messages.getOrCreate(message._id, message);
  }

  /**
   * Fetch multiple messages from a channel
   * @param params Message fetching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Messages
   */
  async fetchMessages(
    params?: Omit<
      (APIRoutes & {
        method: "get";
        template: "/channels/{target}/messages";
      })["params"],
      "include_users"
    >,
  ): Promise<Message[]> {
    const messages = (await this.#collection.client.api.get(
      `/channels/${this.id as ""}/messages`,
      { ...params },
    )) as APIMessage[];

    return messages.map((message) =>
      this.#collection.client.messages.getOrCreate(message._id, message),
    );
  }

  /**
   * Fetch multiple messages from a channel including the users that sent them
   * @param params Message fetching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Object including messages and users
   */
  async fetchMessagesWithUsers(
    params?: Omit<
      (APIRoutes & {
        method: "get";
        template: "/channels/{target}/messages";
      })["params"],
      "include_users"
    >,
  ): Promise<{
    messages: Message[];
    users: User[];
    members: ServerMember[] | undefined;
  }> {
    const data = (await this.#collection.client.api.get(
      `/channels/${this.id as ""}/messages`,
      { ...params, include_users: true },
    )) as { messages: APIMessage[]; users: APIUser[]; members?: APIMember[] };

    return batch(() => ({
      messages: data.messages.map((message) =>
        this.#collection.client.messages.getOrCreate(message._id, message),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
      members: data.members?.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
    }));
  }

  /**
   * Search for messages
   * @param params Message searching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Messages
   */
  async search(
    params: Omit<DataMessageSearch, "include_users">,
  ): Promise<Message[]> {
    const messages = (await this.#collection.client.api.post(
      `/channels/${this.id as ""}/search`,
      params,
    )) as APIMessage[];

    return batch(() =>
      messages.map((message) =>
        this.#collection.client.messages.getOrCreate(message._id, message),
      ),
    );
  }

  /**
   * Search for messages including the users that sent them
   * @param params Message searching route data
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   * @returns Object including messages and users
   */
  async searchWithUsers(
    params: Omit<DataMessageSearch, "include_users">,
  ): Promise<{
    messages: Message[];
    users: User[];
    members: ServerMember[] | undefined;
  }> {
    const data = (await this.#collection.client.api.post(
      `/channels/${this.id as ""}/search`,
      {
        ...params,
        include_users: true,
      },
    )) as { messages: APIMessage[]; users: APIUser[]; members?: APIMember[] };

    return batch(() => ({
      messages: data.messages.map((message) =>
        this.#collection.client.messages.getOrCreate(message._id, message),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
      members: data.members?.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
    }));
  }

  /**
   * Delete many messages by their IDs
   * @param ids List of message IDs
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   */
  async deleteMessages(ids: string[]): Promise<void> {
    await this.#collection.client.api.delete(
      `/channels/${this.id as ""}/messages/bulk`,
      {
        ids,
      },
    );
  }

  /**
   * Create an invite to the channel
   * @requires `TextChannel`
   * @param options.maxUses How many people can join with it (unlimited when left out)
   * @param options.expiresIn Seconds until it expires, or `null` for never;
   *   left out, the server's default applies (7 days)
   * @returns Newly created invite code
   */
  async createInvite(
    options: { maxUses?: number; expiresIn?: number | null } = {},
  ): Promise<Invite> {
    const body: DataCreateInvite = {};
    if (options.maxUses) body.max_uses = options.maxUses;
    if (options.expiresIn === null) {
      body.never_expires = true;
    } else if (options.expiresIn !== undefined) {
      body.expires = new Date(
        Date.now() + options.expiresIn * 1000,
      ).toISOString();
    }

    return await this.#collection.client.api.post(
      `/channels/${this.id as ""}/invites`,
      body,
    );
  }

  #ackTimeout?: number;
  #ackLimit?: number;
  #manuallyMarked?: boolean;
  #releaseAck?: () => void;

  /**
   * Mark a channel as read
   * @param message Last read message or its ID
   * @param skipRateLimiter Whether to skip the internal rate limiter
   * @param skipRequest For internal updates only
   * @param skipNextMarking For internal usage only
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   */
  async ack(
    message?: Message | string,
    skipRateLimiter?: boolean,
    skipRequest?: boolean,
    skipNextMarking?: boolean,
  ): Promise<void> {
    if (!message && this.#manuallyMarked) {
      this.#manuallyMarked = false;
      return;
    }
    // Skip the next unread marking
    else if (skipNextMarking) {
      this.#manuallyMarked = true;
    }

    const lastMessageId =
      (typeof message === "string" ? message : message?.id) ??
      this.lastMessageId ??
      ulid();

    const channelUnread = this.#collection.client.channelUnreads.for(this);

    // skipped requests (the server learns another way) only guard a running sync
    const releaseAck = skipRequest
      ? undefined
      : this.#collection.client.channelUnreads.holdAck(this.id);

    batch(() => {
      this.#collection.client.channelUnreads.markLocal(this.id, "ack");
      this.#collection.client.channelUnreads.updateUnderlyingObject(
        this.id,
        "lastMessageId",
        lastMessageId,
      );

      if (channelUnread.messageMentionIds.size) {
        channelUnread.messageMentionIds.clear();
      }
    });

    // Skip request if not needed
    if (skipRequest) return;

    /**
     * Send the actual acknowledgement request. The mark stays until it
     * settles; a request replaced by a newer ack (the rate limiter) settles
     * with it.
     */
    this.#releaseAck?.();
    this.#releaseAck = releaseAck;
    const performAck = (): void => {
      this.#ackLimit = undefined;
      this.#releaseAck = undefined;
      this.#collection.client.api
        .put(`/channels/${this.id}/ack/${lastMessageId as ""}`)
        .then(
          () => releaseAck?.(),
          () => releaseAck?.(),
        );
    };

    if (skipRateLimiter) return performAck();

    clearTimeout(this.#ackTimeout);
    if (this.#ackLimit && +new Date() > this.#ackLimit) {
      performAck();
    }

    this.#ackTimeout = setTimeout(performAck, 1500) as unknown as number;

    if (!this.#ackLimit) {
      this.#ackLimit = +new Date() + 4e3;
    }
  }

  /**
   * Set role permissions
   * @param role_id Role Id, set to 'default' to affect all users
   * @param permissions Permission value
   * @requires `Group`, `TextChannel`
   */
  async setPermissions(
    role_id = "default",
    permissions: Override | number,
  ): Promise<APIChannel> {
    if (role_id === "default") {
      return await this.#collection.client.api.put(
        `/channels/${this.id}/permissions/default`,
        typeof permissions === "number" ? { permissions } : { permissions },
      );
    }
    if (typeof permissions === "number") {
      throw new TypeError("Role permissions take an allow / deny override");
    }
    return await this.#collection.client.api.put(
      `/channels/${this.id}/permissions/${role_id}`,
      { permissions },
    );
  }

  /**
   * Set permissions for one member in this server channel, applied after the
   * roles. An empty override (allow 0, deny 0) removes it.
   * @param user_id User id
   * @param permissions Permission override
   */
  async setMemberPermissions(
    user_id: string,
    permissions: Override,
  ): Promise<APIChannel> {
    return await this.#collection.client.api.put(
      `/channels/${this.id}/permissions/members/${user_id}`,
      { permissions },
    );
  }

  /**
   * Follow the category's permissions again; the channel's own default and
   * role overrides are cleared (per-member overrides stay)
   */
  async syncPermissions(): Promise<APIChannel> {
    return await this.#collection.client.api.post(
      `/channels/${this.id}/permissions/sync`,
    );
  }

  /**
   * Get slowmode value for the channel
   */
  get slowmode(): number {
    return this.#collection.getUnderlyingObject(this.id).slowmode ?? 0;
  }

  /**
   * Whether this is an announcement channel: only people who can manage
   * messages post in it
   */
  get announcement(): boolean {
    return this.#collection.getUnderlyingObject(this.id).announcement ?? false;
  }

  /**
   * Join a call
   * @param node Target node
   * @param forceDisconnect Whether to disconnect existing call
   * @param recipients Ring targets
   * @returns LiveKit URL and Token
   */
  async joinCall(
    node?: string,
    forceDisconnect = true,
    recipients?: (User | string)[],
  ) {
    return await this.#collection.client.api.post(
      `/channels/${this.id as ""}/join_call`,
      {
        node,
        recipients: recipients?.map((entry) =>
          typeof entry === "string" ? entry : entry.id,
        ),
        force_disconnect: forceDisconnect,
      },
    );
  }

  /**
   * Start typing in this channel
   * @requires `DirectMessage`, `Group`, `TextChannel`
   */
  startTyping(): void {
    this.#collection.client.events.send({
      type: "BeginTyping",
      channel: this.id,
    });
  }

  /**
   * Stop typing in this channel
   * @requires `DirectMessage`, `Group`, `TextChannel`
   */
  stopTyping(): void {
    this.#collection.client.events.send({
      type: "EndTyping",
      channel: this.id,
    });
  }

  /**
   * The voice status of a channel. Screenshare supersedes video, video
   * supersedes voice, and voice supersedes none. This getter takes the highest
   * priority status from all participants in the channel.
   */
  get voiceStatus(): VoiceStatus {
    if (!this.isVoice || this.voiceParticipants.size === 0) {
      return "none";
    }

    let highest: VoiceStatus = "voice";
    for (const participant of this.voiceParticipants.values()) {
      const status = participant.voiceStatus;
      if (status === "screenshare") {
        return "screenshare";
      }
      if (status === "video") {
        highest = "video";
      }
    }

    return highest;
  }

  setUserSlowmode(slowmode: UserSlowmodes) {
    if (this.#slowmodeTimeout) {
      clearTimeout(this.#slowmodeTimeout);
    }

    this.#setUserSlowmode({ ...slowmode, receivedAt: Date.now() });

    this.#slowmodeTimeout = setTimeout(() => {
      this.#setUserSlowmode();
      this.#slowmodeTimeout = undefined;
      this.#collection.client.emit("userSlowmodes");
    }, slowmode.retry_after * 1000);
  }
}
