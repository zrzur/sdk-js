import type { ReactiveMap } from "@solid-primitives/map";
import type { ReactiveSet } from "@solid-primitives/set";
import { decodeTime, ulid } from "ulid";

import type {
  Message as APIMessage,
  MessageWebhook as APIMessageWebhook,
  PollVoters as APIPollVoters,
  DataEditMessage,
  DataMessageSend,
  Masquerade,
} from "../../api/types.js";
import type { Client } from "../Client.js";
import type { MessageCollection } from "../collections/MessageCollection.js";
import { MessageFlags, pollClosed } from "../hydration/message.js";
import type {
  MessageForward,
  MessageInteraction,
  MessagePoll,
} from "../hydration/message.js";

import type { Channel } from "./Channel.js";
import { File } from "./File.js";
import type { MessageEmbed } from "./MessageEmbed.js";
import type { Server } from "./Server.js";
import type { ServerMember } from "./ServerMember.js";
import { ServerRole } from "./ServerRole.js";
import type { SystemMessage } from "./SystemMessage.js";
import type { User } from "./User.js";

/**
 * Message Class
 */
export class Message {
  readonly #collection: MessageCollection;
  readonly id: string;

  /**
   * Construct Message
   * @param collection Collection
   * @param id Message Id
   */
  constructor(collection: MessageCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !!this.#collection.getUnderlyingObject(this.id).id;
  }

  /**
   * Time when this message was posted
   */
  get createdAt(): Date {
    return new Date(decodeTime(this.id));
  }

  /**
   * Absolute pathname to this message in the client
   */
  get path(): string {
    return `${this.channel?.path}/${this.id}`;
  }

  /**
   * URL to this message
   */
  get url(): string | undefined {
    return this.#collection.client.configuration?.app + this.path;
  }

  /**
   * Nonce value
   */
  get nonce(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).nonce;
  }

  /**
   * Id of channel this message was sent in
   */
  get channelId(): string {
    return this.#collection.getUnderlyingObject(this.id).channelId;
  }

  /**
   * Channel this message was sent in
   */
  get channel(): Channel | undefined {
    return this.#collection.client.channels.get(
      this.#collection.getUnderlyingObject(this.id).channelId,
    );
  }

  /**
   * Server this message was sent in
   */
  get server(): Server | undefined {
    return this.channel?.server;
  }

  /**
   * Member this message was sent by
   */
  get member(): ServerMember | undefined {
    return this.#collection.client.serverMembers.getByKey({
      server: this.channel?.serverId as string,
      user: this.authorId!,
    });
  }

  /**
   * Id of user or webhook this message was sent by
   */
  get authorId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).authorId;
  }

  /**
   * User this message was sent by
   */
  get author(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).authorId!,
    );
  }

  /**
   * Webhook information for this message
   */
  get webhook(): MessageWebhook | undefined {
    return this.#collection.getUnderlyingObject(this.id).webhook!;
  }

  /**
   * Content
   */
  get content(): string {
    return this.#collection.getUnderlyingObject(this.id).content ?? "";
  }

  /**
   * Content converted to plain text
   */
  get contentPlain(): string {
    return this.#collection.client.markdownToText(this.content);
  }

  /**
   * System message content
   */
  get systemMessage(): SystemMessage | undefined {
    return this.#collection.getUnderlyingObject(this.id).systemMessage;
  }

  /**
   * Attachments
   */
  get attachments(): File[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).attachments;
  }

  /**
   * Time at which this message was edited
   */
  get editedAt(): Date | undefined {
    return this.#collection.getUnderlyingObject(this.id).editedAt;
  }

  /**
   * Embeds
   */
  get embeds(): MessageEmbed[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).embeds;
  }

  /**
   * IDs of users this message mentions
   */
  get mentionIds(): string[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).mentionIds;
  }

  /**
   * IDs of roles this message mentions
   */
  get roleMentionIds(): string[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).roleMentionIds;
  }

  /**
   * Roles this message mentions
   */
  get roleMentions(): ServerRole[] | undefined {
    return this.roleMentionIds
      ?.map((roleId) => this.server?.roles.get(roleId) as ServerRole)
      .filter((role) => role);
  }

  /**
   * Whether this message mentions us
   */
  get mentioned(): boolean {
    return (
      // flags are bit positions (MessageFlags gives the position)
      !!(this.flags & (1 << MessageFlags.MentionsEveryone)) ||
      !!(this.flags & (1 << MessageFlags.MentionsOnline)) ||
      this.mentionIds?.includes(this.#collection.client.user!.id) ||
      this.roleMentions?.some((role) => role.assigned) ||
      false
    );
  }

  /**
   * IDs of messages this message replies to
   */
  get replyIds(): string[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).replyIds;
  }

  /**
   * Reactions
   */
  get reactions(): ReactiveMap<string, ReactiveSet<string>> {
    return this.#collection.getUnderlyingObject(this.id).reactions;
  }

  /**
   * Interactions
   */
  get interactions(): APIMessage["interactions"] {
    return this.#collection.getUnderlyingObject(this.id).interactions;
  }

  /**
   * Buttons and selects sent by a bot (Zrzur developer platform)
   */
  get components(): unknown[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).components;
  }

  /**
   * The command or component use this bot message answers (Zrzur)
   */
  get interaction(): MessageInteraction | undefined {
    return this.#collection.getUnderlyingObject(this.id).interaction;
  }

  /**
   * Masquerade
   */
  get masquerade(): Masquerade | undefined {
    return this.#collection.getUnderlyingObject(this.id).masquerade;
  }

  /**
   * Whether this message is pinned
   */
  get pinned(): boolean {
    return this.#collection.getUnderlyingObject(this.id).pinned || false;
  }

  /**
   * Where this message was forwarded from, if it is a forwarded copy (Zrzur)
   */
  get forwarded(): MessageForward | undefined {
    return this.#collection.getUnderlyingObject(this.id).forwarded;
  }

  /**
   * Poll carried by this message, if any (Zrzur)
   */
  get poll(): MessagePoll | undefined {
    return this.#collection.getUnderlyingObject(this.id).poll;
  }

  /**
   * Whether this message's poll no longer takes votes: ended early, closed,
   * or past its end time (Zrzur)
   * @param now Time to compare with (defaults to now)
   */
  isPollClosed(now: Date = new Date()): boolean {
    const poll = this.poll;
    if (!poll) return false;
    return pollClosed(poll, now);
  }

  /**
   * Replace the stored poll (after a vote or an event)
   * @param poll New poll
   * @internal
   */
  #setPoll(poll: MessagePoll) {
    this.#collection.updateUnderlyingObject(this.id, "poll", poll);
  }

  /**
   * Choose an answer of this message's poll. On a single-choice poll this
   * replaces your earlier choice; on a multiple-choice poll it is added to
   * it (Zrzur)
   * @param answer Answer id
   * @returns The poll with the new counts and your choice
   */
  async votePoll(answer: number): Promise<MessagePoll> {
    const poll = (await this.#collection.client.api.put(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/polls/answers/${answer as 0}/votes/@me`,
    )) as MessagePoll;
    this.#setPoll(poll);
    return poll;
  }

  /**
   * Take back your choice of an answer of this message's poll (Zrzur)
   * @param answer Answer id
   * @returns The poll with the new counts and your choice
   */
  async unvotePoll(answer: number): Promise<MessagePoll> {
    const poll = (await this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/polls/answers/${answer as 0}/votes/@me`,
    )) as MessagePoll;
    this.#setPoll(poll);
    return poll;
  }

  /**
   * End this message's poll now: the author can end their own, others need
   * Manage Messages (Zrzur)
   * @returns The final poll
   */
  async endPoll(): Promise<MessagePoll> {
    const poll = (await this.#collection.client.api.post(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/polls/end`,
    )) as MessagePoll;
    this.#setPoll(poll);
    return poll;
  }

  /**
   * People who chose an answer of this message's poll, oldest vote first,
   * a page at a time (Zrzur)
   * @param answer Answer id
   * @param options Page size (1 to 100, default 50) and the last user id of
   *   the page before
   */
  async fetchPollVoters(
    answer: number,
    options: { limit?: number; after?: string } = {},
  ): Promise<{ users: User[]; count: number; next?: string }> {
    const client = this.#collection.client;
    const page = (await client.api.get(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/polls/answers/${answer as 0}/voters`,
      {
        ...(options.limit ? { limit: options.limit } : {}),
        ...(options.after ? { after: options.after } : {}),
      },
    )) as APIPollVoters;

    const users = new Map(
      page.users.map((user) => [
        user._id,
        client.users.getOrCreate(user._id, user),
      ]),
    );
    for (const member of page.members ?? []) {
      client.serverMembers.getOrCreate(member._id, member);
    }

    const limit = options.limit ?? 50;
    return {
      users: page.ids
        .map((id) => users.get(id))
        .filter((user): user is User => !!user),
      count: page.count,
      next:
        page.ids.length >= limit ? page.ids[page.ids.length - 1] : undefined,
    };
  }

  /**
   * Flags
   */
  get flags(): number {
    return this.#collection.getUnderlyingObject(this.id).flags || 0;
  }

  /**
   * Get the username for this message
   */
  get username(): string | undefined {
    const webhook = this.webhook;

    return (
      this.masquerade?.name ??
      (webhook
        ? webhook.name
        : (this.member?.nickname ??
          this.author?.displayName ??
          this.author?.username))
    );
  }

  /**
   * Get the role colour for this message
   */
  get roleColour(): string | null | undefined {
    return this.masquerade?.colour ?? this.member?.roleColour;
  }

  /**
   * Get the role colour for this message
   */
  get iconRole(): ServerRole | null | undefined {
    return this.member?.iconRole;
  }

  /**
   * Get the avatar URL for this message
   */
  get avatarURL(): string | undefined {
    const webhook = this.webhook;

    return (
      this.masqueradeAvatarURL ??
      (webhook
        ? webhook.avatarURL
        : (this.member?.avatarURL ?? this.author?.avatarURL))
    );
  }

  /**
   * Get the animated avatar URL for this message
   */
  get animatedAvatarURL(): string | undefined {
    const webhook = this.webhook;

    return (
      this.masqueradeAvatarURL ??
      (webhook
        ? webhook.avatarURL
        : this.member
          ? this.member?.animatedAvatarURL
          : this.author?.animatedAvatarURL)
    );
  }

  /**
   * Avatar URL from the masquerade
   */
  get masqueradeAvatarURL(): string | undefined {
    const avatar = this.masquerade?.avatar;
    return avatar ? this.#collection.client.proxyFile(avatar) : undefined;
  }

  /**
   * Whether this message has suppressed desktop/push notifications
   */
  get isSuppressed(): boolean {
    return (this.flags & 1) === 1;
  }

  /**
   * Edit a message
   * @param data Message edit route data
   */
  async edit(data: DataEditMessage): Promise<APIMessage> {
    return await this.#collection.client.api.patch(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}`,
      data,
    );
  }

  /**
   * Delete a message
   */
  async delete(): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}`,
    );
  }

  /**
   * Acknowledge this message as read
   * @param skipRateLimiter Whether to skip the internal rate limiter
   * @param skipRequest For internal updates only
   * @param skipNextMarking For internal usage only
   * @requires `SavedMessages`, `DirectMessage`, `Group`, `TextChannel`
   */
  ack(
    skipRateLimiter?: boolean,
    skipRequest?: boolean,
    skipNextMarking?: boolean,
  ): void {
    this.channel?.ack(this, skipRateLimiter, skipRequest, skipNextMarking);
  }

  /**
   * Reply to Message
   */
  reply(
    data:
      | string
      | (Omit<DataMessageSend, "nonce"> & {
          nonce?: string;
        }),
    mention = true,
  ): Promise<Message> | undefined {
    const obj = typeof data === "string" ? { content: data } : data;
    return this.channel?.sendMessage({
      ...obj,
      replies: [{ id: this.id, mention }],
    });
  }

  /**
   * Forward a copy of this message to another channel (Zrzur)
   *
   * Needs `features.forwarding` on the server. The copy keeps the text,
   * files and rich embeds and notifies nobody it mentions.
   * @param target Channel (or its id) to forward to
   * @param note Optional short note shown with the copy (up to 1000 characters)
   * @param idempotencyKey Key that makes a retried request send only once
   * @returns The forwarded copy
   */
  async forward(
    target: Channel | string,
    note?: string,
    idempotencyKey: string = ulid(),
  ): Promise<Message> {
    const targetId = typeof target === "string" ? target : target.id;
    const trimmed = note?.trim();
    const message = await this.#collection.client.api.post(
      `/channels/${targetId as ""}/messages/forward`,
      {
        channel: this.channelId,
        message: this.id,
        ...(trimmed ? { note: trimmed } : {}),
      },
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
   * Clear all reactions from this message
   */
  async clearReactions(): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/reactions`,
    );
  }

  /**
   * React to a message
   * @param emoji Unicode or emoji ID
   */
  async react(emoji: string): Promise<void> {
    return await this.#collection.client.api.put(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/reactions/${
        emoji as ""
      }`,
    );
  }

  /**
   * Un-react from a message
   * @param emoji Unicode or emoji ID
   * @param deleteAll Remove all reactions
   */
  async unreact(emoji: string, deleteAll = false): Promise<void> {
    return await this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/reactions/${
        emoji as ""
      }`,
      { remove_all: deleteAll },
    );
  }

  /**
   * Pin the message
   */
  pin(): Promise<void> {
    return this.#collection.client.api.post(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/pin`,
    );
  }

  /**
   * Unpin the message
   */
  unpin(): Promise<void> {
    return this.#collection.client.api.delete(
      `/channels/${this.channelId as ""}/messages/${this.id as ""}/pin`,
    );
  }
}

/**
 * Message Webhook Class
 */
export class MessageWebhook {
  #client: Client;

  readonly id: string;
  readonly name: string;
  readonly avatar?: File;

  /**
   * Construct Message Webhook
   * @param client Client
   * @param webhook Webhook data
   */
  constructor(client: Client, webhook: APIMessageWebhook, id: string) {
    this.#client = client;
    this.id = id;
    this.name = webhook.name;
    this.avatar = webhook.avatar
      ? new File(client, {
          _id: webhook.avatar,
          tag: "avatars",
          metadata: {
            type: "Image",
            width: 256,
            height: 256,
          },
        })
      : undefined;
  }

  /**
   * Get the avatar URL for this message webhook
   */
  get avatarURL(): string {
    return (
      this.avatar?.createFileURL() ??
      `${this.#client.options.baseURL}/users/${this.id}/default_avatar`
    );
  }
}
