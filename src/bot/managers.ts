import type * as APITypes from "../api/types.js";
import type { DataMemberEdit, FieldsMember } from "../api/types.js";
import type { API } from "../core/API.js";

import { type EmbedBuilder, resolve } from "./builders.js";
import { type ComponentInput, toBlocks } from "./components.js";
import type { Message, SendableEmbed } from "./types.js";

/** What a message can carry */
export interface MessageInput {
  content?: string;
  embeds?: (SendableEmbed | EmbedBuilder)[];
  components?: ComponentInput[];
  /** Reply to these messages; `mention` pings their authors */
  replyTo?: string | { id: string; mention?: boolean }[];
  /** Send without push or desktop notifications */
  silent?: boolean;
  /** Files to attach (uploaded first; up to the server's attachment limit) */
  files?: {
    name: string;
    data: Blob | ArrayBuffer | Uint8Array;
    type?: string;
  }[];
}

/** Upload a message's files and put their ids on the body */
async function withFiles(rest: API, input: string | MessageInput) {
  const body: Record<string, unknown> = messageBody(input);
  const files = typeof input === "string" ? undefined : input.files;
  if (files?.length) {
    body.attachments = await Promise.all(
      files.map((file) =>
        rest.uploadFile("attachments", file.data, file.name, file.type),
      ),
    );
  }
  return body;
}

const enc = encodeURIComponent;

function messageBody(input: string | MessageInput) {
  const options = typeof input === "string" ? { content: input } : input;
  const replies =
    typeof options.replyTo === "string"
      ? [{ id: options.replyTo, mention: false }]
      : options.replyTo?.map((r) => ({
          id: r.id,
          mention: r.mention ?? false,
        }));
  return {
    content: options.content,
    embeds: options.embeds?.map(resolve),
    components: options.components ? toBlocks(options.components) : undefined,
    replies,
    // the server's flags are bit positions: SuppressNotifications is 1 << 1
    flags: options.silent ? 1 << 1 : undefined,
  };
}

/** Messages in channels the bot can see */
export class MessageManager {
  constructor(private readonly rest: API) {}

  async send(channelId: string, message: string | MessageInput) {
    return this.rest.req(
      "post",
      `/channels/${channelId}/messages`,
      await withFiles(this.rest, message),
    );
  }

  /** Reply to a message (no ping unless `mention`) */
  reply(
    message: Pick<Message, "_id" | "channel">,
    reply: string | MessageInput,
    mention = false,
  ) {
    const options = typeof reply === "string" ? { content: reply } : reply;
    return this.send(message.channel, {
      ...options,
      replyTo: [{ id: message._id, mention }],
    });
  }

  fetch(channelId: string, messageId: string) {
    return this.rest.req("get", `/channels/${channelId}/messages/${messageId}`);
  }

  /** Latest messages first; `before` / `after` take message ids */
  async fetchMany(
    channelId: string,
    options: { limit?: number; before?: string; after?: string } = {},
  ): Promise<Message[]> {
    const found = await this.rest.req(
      "get",
      `/channels/${channelId}/messages`,
      {
        include_users: false,
        limit: options.limit || undefined,
        before: options.before || undefined,
        after: options.after || undefined,
      },
    );
    return Array.isArray(found) ? found : found.messages;
  }

  /** Edit one of the bot's own messages */
  edit(channelId: string, messageId: string, message: string | MessageInput) {
    const { replies: _replies, flags: _flags, ...body } = messageBody(message);
    return this.rest.req(
      "patch",
      `/channels/${channelId}/messages/${messageId}`,
      body,
    );
  }

  /** Delete a message (others' messages need Manage Messages) */
  delete(channelId: string, messageId: string) {
    return this.rest.req(
      "delete",
      `/channels/${channelId}/messages/${messageId}`,
    );
  }

  /** Delete up to 100 messages younger than a week (needs Manage Messages) */
  bulkDelete(channelId: string, messageIds: string[]) {
    return this.rest.req("delete", `/channels/${channelId}/messages/bulk`, {
      ids: messageIds,
    });
  }

  /** React with a Unicode emoji or a custom emoji id */
  react(channelId: string, messageId: string, emoji: string) {
    return this.rest.req(
      "put",
      `/channels/${channelId}/messages/${messageId}/reactions/${enc(emoji)}`,
    );
  }

  /** Remove the bot's reaction, or `userId`'s (needs Manage Messages) */
  unreact(
    channelId: string,
    messageId: string,
    emoji: string,
    userId?: string,
  ) {
    return this.rest.req(
      "delete",
      `/channels/${channelId}/messages/${messageId}/reactions/${enc(emoji)}`,
      { user_id: userId },
    );
  }

  clearReactions(channelId: string, messageId: string) {
    return this.rest.req(
      "delete",
      `/channels/${channelId}/messages/${messageId}/reactions`,
    );
  }

  pin(channelId: string, messageId: string) {
    return this.rest.req(
      "post",
      `/channels/${channelId}/messages/${messageId}/pin`,
    );
  }

  unpin(channelId: string, messageId: string) {
    return this.rest.req(
      "delete",
      `/channels/${channelId}/messages/${messageId}/pin`,
    );
  }

  /**
   * The pinned messages of a channel. Text search stays closed to bots;
   * without the Message Content intent the texts come back empty.
   */
  async pins(channelId: string) {
    const found = await this.rest.req("post", `/channels/${channelId}/search`, {
      pinned: true,
    });
    return Array.isArray(found) ? found : found.messages;
  }
}

/** Threads of text channels; the permissions of the channel apply */
export class ThreadManager {
  constructor(private readonly rest: API) {}

  /** Start a thread from a message (`message`) or with a first `content` */
  create(
    channelId: string,
    options: { name: string; message?: string; content?: string },
  ) {
    return this.rest.req("post", `/channels/${channelId}/threads`, options);
  }

  /** Active threads, newest first; `archived: true` for the others */
  list(
    channelId: string,
    options: { archived?: boolean; before?: string; limit?: number } = {},
  ) {
    return this.rest.req("get", `/channels/${channelId}/threads`, options);
  }

  /** Rename, archive or reopen, lock (needs Manage Messages) or tag */
  edit(threadId: string, changes: APITypes.DataEditThread) {
    return this.rest.req("patch", `/channels/${threadId}/thread`, changes);
  }

  archive(threadId: string) {
    return this.edit(threadId, { archived: true });
  }

  reopen(threadId: string) {
    return this.edit(threadId, { archived: false });
  }
}

/** A tag of a forum */
export type ForumTag = APITypes.ForumTag;

/** Forum channels: every post is a thread with a title and tags */
export class ForumManager {
  constructor(private readonly rest: API) {}

  /** Create a forum channel (needs Manage Channels) */
  create(serverId: string, options: { name: string; description?: string }) {
    return this.rest.req("post", `/servers/${serverId}/channels`, {
      type: "Forum",
      ...options,
    });
  }

  /** Write a post: a title, the first message and up to five tags */
  post(
    forumId: string,
    options: { title: string; content: string; tags?: string[] },
  ) {
    return this.rest.req("post", `/channels/${forumId}/threads`, {
      name: options.title,
      content: options.content,
      tags: options.tags,
    });
  }

  /** Posts, newest first; `archived: true` for the others */
  posts(
    forumId: string,
    options: { archived?: boolean; before?: string; limit?: number } = {},
  ) {
    return this.rest.req("get", `/channels/${forumId}/threads`, options);
  }

  /** Set the tags posts can carry (up to 20; needs Manage Channels) */
  setTags(
    forumId: string,
    tags: ForumTag[],
    options: { required?: boolean } = {},
  ) {
    return this.rest.req("patch", `/channels/${forumId}`, {
      forum_tags: tags,
      require_tag: options.required,
    });
  }
}

/** Invites to servers. Bots make them; they never join through one */
export class InviteManager {
  constructor(private readonly rest: API) {}

  /** Create an invite for a channel (needs Invite Others) */
  create(channelId: string, options?: APITypes.DataCreateInvite) {
    return this.rest.req("post", `/channels/${channelId}/invites`, options);
  }

  /** What an invite leads to */
  fetch(code: string) {
    return this.rest.req("get", `/invites/${enc(code)}`);
  }

  /** Every invite of a server (needs Manage Server) */
  list(serverId: string) {
    return this.rest.req("get", `/servers/${serverId}/invites`);
  }

  /** Remove an invite (its creator, or Manage Server) */
  delete(code: string) {
    return this.rest.req("delete", `/invites/${enc(code)}`);
  }
}

/**
 * A channel webhook. `token` and `url` come only with the answer that made
 * them (`create`, `regenerateToken`): keep them, they are not shown again.
 */
export type Webhook = APITypes.Webhook;

/** The token form of a webhook: no creator */
export type WebhookInfo = APITypes.ResponseWebhook;

/** Options of a message sent through a webhook */
export interface WebhookSendOptions {
  /** Name shown on this message; the webhook mark stays */
  username?: string;
  /** Avatar shown on this message, a web address */
  avatarUrl?: string;
  /** Post into this thread of the webhook's channel */
  threadId?: string;
  /** Forum: start a thread with this name */
  threadName?: string;
  /** Forum: tags of the new thread */
  appliedTags?: string[];
  /** Which mentions may notify anyone; left out, all that its permissions allow */
  allowedMentions?: APITypes.AllowedMentions;
}

function webhookQuery(threadId?: string) {
  return threadId ? `&thread_id=${encodeURIComponent(threadId)}` : "";
}

/** Webhooks of channels the bot manages (needs Manage Webhooks) */
export class WebhookManager {
  constructor(private readonly rest: API) {}

  create(channelId: string, options: { name: string; avatar?: string }) {
    return this.rest.req("post", `/channels/${channelId}/webhooks`, options);
  }

  list(channelId: string) {
    return this.rest.req("get", `/channels/${channelId}/webhooks`);
  }

  /** Every webhook of a server in channels the bot manages, newest first */
  listForServer(serverId: string) {
    return this.rest.req("get", `/servers/${serverId}/webhooks`);
  }

  fetch(webhookId: string) {
    return this.rest.req("get", `/webhooks/${webhookId}`);
  }

  /** The webhook as its token sees it */
  fetchWithToken(webhook: Pick<Webhook, "id" | "token">) {
    return this.rest.req("get", `/webhooks/${webhook.id}/${tokenOf(webhook)}`);
  }

  edit(
    webhookId: string,
    changes: {
      name?: string;
      avatar?: string;
      permissions?: number;
      /** Move it to another channel of the server */
      channel_id?: string;
    },
  ) {
    return this.rest.req("patch", `/webhooks/${webhookId}`, changes);
  }

  /** Make a new token: the old one stops at once. Keep the answer's `token` */
  regenerateToken(webhookId: string) {
    return this.rest.req("post", `/webhooks/${webhookId}/token`);
  }

  delete(webhookId: string) {
    return this.rest.req("delete", `/webhooks/${webhookId}`);
  }

  /** Post through a webhook with its token (embeds and components allowed) */
  send(
    webhook: Pick<Webhook, "id" | "token">,
    message: string | MessageInput,
    options: WebhookSendOptions = {},
  ) {
    const { flags, ...body } = messageBody(message);
    const silent = flags ? { flags: 4096 } : {};
    return this.rest.req(
      "post",
      `/webhooks/${webhook.id}/${tokenOf(webhook)}?wait=true${webhookQuery(options.threadId)}` as `/webhooks/${string}/${string}`,
      {
        ...body,
        ...silent,
        username: options.username,
        avatar_url: options.avatarUrl,
        thread_name: options.threadName,
        applied_tags: options.appliedTags,
        allowed_mentions: options.allowedMentions,
      },
    ) as Promise<APITypes.Message>;
  }

  /** A message this webhook sent */
  fetchMessage(webhook: Pick<Webhook, "id" | "token">, messageId: string) {
    return this.rest.req(
      "get",
      `/webhooks/${webhook.id}/${tokenOf(webhook)}/messages/${messageId}`,
    );
  }

  /** Post a payload in Slack's format */
  sendSlack(webhook: Pick<Webhook, "id" | "token">, payload: object) {
    return this.rest.req(
      "post",
      `/webhooks/${webhook.id}/${tokenOf(webhook)}/slack`,
      payload as never,
    );
  }

  editMessage(
    webhook: Pick<Webhook, "id" | "token">,
    messageId: string,
    message: string | MessageInput,
  ) {
    const { replies: _replies, flags: _flags, ...body } = messageBody(message);
    return this.rest.req(
      "patch",
      `/webhooks/${webhook.id}/${tokenOf(webhook)}/messages/${messageId}`,
      body,
    );
  }

  deleteMessage(webhook: Pick<Webhook, "id" | "token">, messageId: string) {
    return this.rest.req(
      "delete",
      `/webhooks/${webhook.id}/${tokenOf(webhook)}/messages/${messageId}`,
    );
  }
}

function tokenOf(webhook: Pick<Webhook, "token">) {
  if (!webhook.token)
    throw new TypeError(
      "This webhook has no token: it is only shown when made. Keep it from create() or regenerateToken()",
    );
  return webhook.token;
}

/** A server member as the API returns it */
export type Member = APITypes.Member;

/** Members of the servers the bot is in */
export class MemberManager {
  constructor(private readonly rest: API) {}

  async fetch(serverId: string, userId: string): Promise<Member> {
    const response = await this.rest.get(
      `/servers/${serverId}/members/${userId}`,
    );
    // the route answers { member, roles } only when asked for roles
    return "member" in response ? response.member : response;
  }

  /**
   * Members of a server with their users (`{ members, users }`). Large
   * servers answer in pages: pass `limit` and the last user id as `after`.
   */
  fetchAll(
    serverId: string,
    options: { excludeOffline?: boolean; limit?: number; after?: string } = {},
  ) {
    return this.rest.req("get", `/servers/${serverId}/members`, {
      exclude_offline: options.excludeOffline ?? false,
      limit: options.limit,
      after: options.after,
    });
  }

  /** Change nickname, roles or timeout (needs the matching permission) */
  edit(
    serverId: string,
    userId: string,
    changes: {
      nickname?: string | null;
      roles?: string[];
      timeout?: Date | null;
      /** Move the member to this voice channel (they must be in voice) */
      voiceChannel?: string;
      /** Allow or stop speaking (server mute) */
      canPublish?: boolean;
      /** Allow or stop hearing (server deafen) */
      canReceive?: boolean;
    },
  ) {
    const remove: FieldsMember[] = [];
    const body: DataMemberEdit = {};
    if (changes.voiceChannel) body.voice_channel = changes.voiceChannel;
    if (changes.canPublish !== undefined) body.can_publish = changes.canPublish;
    if (changes.canReceive !== undefined) body.can_receive = changes.canReceive;
    if (changes.nickname === null) remove.push("Nickname");
    else if (changes.nickname !== undefined) body.nickname = changes.nickname;
    if (changes.roles) body.roles = changes.roles;
    if (changes.timeout === null) remove.push("Timeout");
    else if (changes.timeout) body.timeout = changes.timeout.toISOString();
    if (remove.length) body.remove = remove;
    return this.rest.req(
      "patch",
      `/servers/${serverId}/members/${userId}`,
      body,
    );
  }

  async addRole(serverId: string, userId: string, roleId: string) {
    const member = await this.fetch(serverId, userId);
    const roles = new Set(member.roles ?? []);
    roles.add(roleId);
    return this.edit(serverId, userId, { roles: [...roles] });
  }

  async removeRole(serverId: string, userId: string, roleId: string) {
    const member = await this.fetch(serverId, userId);
    return this.edit(serverId, userId, {
      roles: (member.roles ?? []).filter((id) => id !== roleId),
    });
  }

  /** Time out for `seconds`; `0` ends it */
  timeout(serverId: string, userId: string, seconds: number) {
    return this.edit(serverId, userId, {
      timeout: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
    });
  }

  kick(serverId: string, userId: string) {
    return this.rest.req("delete", `/servers/${serverId}/members/${userId}`);
  }

  ban(
    serverId: string,
    userId: string,
    options: { reason?: string; deleteMessageSeconds?: number } = {},
  ) {
    return this.rest.req("put", `/servers/${serverId}/bans/${userId}`, {
      reason: options.reason,
      delete_message_seconds: options.deleteMessageSeconds,
    });
  }

  unban(serverId: string, userId: string) {
    return this.rest.req("delete", `/servers/${serverId}/bans/${userId}`);
  }
}

export type Role = APITypes.Role;

/** Roles of a server (needs Manage Roles) */
export class RoleManager {
  constructor(private readonly rest: API) {}

  create(serverId: string, name: string, options: { rank?: number } = {}) {
    return this.rest.req("post", `/servers/${serverId}/roles`, {
      name,
      rank: options.rank,
    });
  }

  edit(
    serverId: string,
    roleId: string,
    changes: { name?: string; colour?: string; hoist?: boolean },
  ) {
    return this.rest.req(
      "patch",
      `/servers/${serverId}/roles/${roleId}`,
      changes,
    );
  }

  /** Allow and deny permission bits for the role on the whole server */
  setPermissions(serverId: string, roleId: string, allow: number, deny = 0) {
    return this.rest.req("put", `/servers/${serverId}/permissions/${roleId}`, {
      permissions: { allow, deny },
    });
  }

  delete(serverId: string, roleId: string) {
    return this.rest.req("delete", `/servers/${serverId}/roles/${roleId}`);
  }
}

/** Channels (creating and editing needs Manage Channels) */
export class ChannelManager {
  constructor(private readonly rest: API) {}

  fetch(channelId: string) {
    return this.rest.req("get", `/channels/${channelId}`);
  }

  /** Create a channel; `category` puts it into that category (see `servers.ensureCategory`) */
  create(
    serverId: string,
    options: {
      name: string;
      type?: "Text" | "Voice" | "Forum";
      description?: string;
      nsfw?: boolean;
      category?: string;
    },
  ) {
    return this.rest.req("post", `/servers/${serverId}/channels`, {
      type: options.type ?? "Text",
      name: options.name,
      description: options.description,
      nsfw: options.nsfw,
      category: options.category,
    });
  }

  edit(
    channelId: string,
    changes: { name?: string; description?: string; nsfw?: boolean },
  ) {
    return this.rest.req("patch", `/channels/${channelId}`, changes);
  }

  delete(channelId: string) {
    return this.rest.req("delete", `/channels/${channelId}`);
  }

  /**
   * Allow and deny permission bits on a channel for a role, or for everyone
   * (`"default"`). Needs Manage Permissions.
   */
  setPermissions(
    channelId: string,
    roleId: string | "default",
    allow: number,
    deny = 0,
  ) {
    return this.rest.req(
      "put",
      `/channels/${channelId}/permissions/${roleId}`,
      {
        permissions: { allow, deny },
      },
    );
  }

  /**
   * Allow and deny permission bits on a channel for one member, applied after
   * every role (a ticket only its author and the staff can see). `0, 0`
   * removes the entry. Needs Manage Permissions and a higher rank than the member.
   */
  setMemberPermissions(
    channelId: string,
    userId: string,
    allow: number,
    deny = 0,
  ) {
    return this.rest.req(
      "put",
      `/channels/${channelId}/permissions/members/${userId}`,
      { permissions: { allow, deny } },
    );
  }

  /** Create an invite code for a server channel */
  createInvite(channelId: string) {
    return this.rest.req("post", `/channels/${channelId}/invites`);
  }

  /** Show "is typing…" over HTTP, for bots without a gateway connection */
  typing(channelId: string) {
    return this.rest.req("post", `/channels/${channelId}/typing`);
  }
}

/** Users and direct messages */
export class UserManager {
  constructor(private readonly rest: API) {}

  fetch(userId: string) {
    return this.rest.req("get", `/users/${userId}`);
  }

  /** The direct message channel with a user (they must allow messages from the bot) */
  openDM(userId: string) {
    return this.rest.req("get", `/users/${userId}/dm`);
  }

  /** Send a direct message */
  async sendDM(userId: string, message: string | MessageInput) {
    const channel = await this.openDM(userId);
    return this.rest.req(
      "post",
      `/channels/${channel._id}/messages`,
      await withFiles(this.rest, message),
    );
  }
}

export type Presence = APITypes.Presence;

/** Servers the bot is in */
export class ServerManager {
  constructor(private readonly rest: API) {}

  /** Server with its channel ids, roles and settings */
  fetch(serverId: string) {
    return this.rest.req("get", `/servers/${serverId}`);
  }

  /**
   * The id of the category with this title (case-insensitive), created at the
   * end of the channel list if the server has none. Needs Manage Channels.
   */
  async ensureCategory(serverId: string, title: string) {
    const categories = (await this.fetch(serverId)).categories ?? [];
    const found = categories.find(
      (c) => c.title.toLowerCase() === title.toLowerCase(),
    );
    if (found) return found.id;
    const id = newId();
    await this.rest.req("patch", `/servers/${serverId}`, {
      categories: [...categories, { id, title, channels: [] }],
    });
    return id;
  }
}

/** A group of channels in a server */
export type Category = APITypes.Category;

/** A ULID-shaped id (time + randomness, Crockford base32) for new categories */
function newId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++) {
    head = alphabet[time % 32] + head;
    time = Math.floor(time / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  return head + Array.from(random, (b) => alphabet[b % 32]).join("");
}

/** A custom emoji uploaded to a server */
export type ServerEmoji = APITypes.Emoji;

/**
 * Custom emojis of servers. Use one in text with `emoji(e)` (`:id:`), and in
 * buttons, select options and reactions by its id.
 */
export class EmojiManager {
  constructor(private readonly rest: API) {}

  /** All emojis of a server */
  list(serverId: string) {
    return this.rest.req("get", `/servers/${serverId}/emojis`);
  }

  fetch(emojiId: string) {
    return this.rest.req("get", `/custom/emoji/${emojiId}`);
  }

  /** Find a server emoji by name (case-insensitive) */
  async find(serverId: string, name: string) {
    const wanted = name.replace(/:/g, "").toLowerCase();
    return (await this.list(serverId)).find(
      (e) => e.name.toLowerCase() === wanted,
    );
  }

  /**
   * Upload an image (PNG, JPEG, GIF or WebP, up to the server's size limit)
   * as a new server emoji. Needs Manage Customisation. Names: lowercase
   * letters, digits and `_`.
   */
  async create(
    serverId: string,
    name: string,
    image: Blob | ArrayBuffer | Uint8Array,
    options: { filename?: string; contentType?: string; nsfw?: boolean } = {},
  ) {
    const blob =
      image instanceof Blob
        ? image
        : new Blob([image as BlobPart], {
            type: options.contentType ?? "image/png",
          });
    const form = new FormData();
    form.append("file", blob, options.filename ?? "emoji.png");
    const { id } = await this.rest.upload(
      `${await this.rest.filesUrl()}/emojis`,
      form,
    );
    return this.rest.req("put", `/custom/emoji/${id}`, {
      name,
      parent: { type: "Server", id: serverId },
      nsfw: options.nsfw ?? false,
    });
  }

  /** Delete a server emoji (needs Manage Customisation) */
  delete(emojiId: string) {
    return this.rest.req("delete", `/custom/emoji/${emojiId}`);
  }
}

/** Text form of a custom emoji for message content: `:01J…:` */
export const emoji = (e: string | { _id: string }) =>
  `:${typeof e === "string" ? e : e._id}:`;

/** Ticket for a LiveKit voice room: connect with any LiveKit client (e.g. @livekit/rtc-node) */
export interface VoiceTicket {
  /** LiveKit server address */
  url: string;
  /** Access token for this channel's room */
  token: string;
  /** Voice node used */
  node: string;
}

/**
 * Voice channels. The API hands out LiveKit tickets; the audio itself goes
 * through a LiveKit client. Members are moved and muted with `members.edit`.
 */
export class VoiceManager {
  #nodes?: Promise<{ name: string; public_url: string }[]>;

  constructor(private readonly rest: API) {}

  /** Voice nodes this server offers (empty when voice is off) */
  nodes() {
    this.#nodes ??= this.rest
      .get("/", undefined, { anonymous: true })
      .then((root) =>
        root.features?.livekit?.enabled
          ? (root.features.livekit.nodes ?? [])
          : [],
      );
    return this.#nodes;
  }

  /** Get a ticket to join a voice channel (on the first node unless `node` is given) */
  async join(
    channelId: string,
    options: { node?: string } = {},
  ): Promise<VoiceTicket> {
    const node = options.node ?? (await this.nodes())[0]?.name;
    if (!node) throw new Error("Voice is not enabled on this server");
    const ticket = await this.rest.req(
      "post",
      `/channels/${channelId}/join_call`,
      { node },
    );
    return { ...ticket, node };
  }
}
