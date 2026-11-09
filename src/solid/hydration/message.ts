import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";

import type * as APITypes from "../../api/types.js";
import type { Interactions, Masquerade, Message } from "../../api/types.js";
import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import { MessageWebhook } from "../classes/Message.js";
import { MessageEmbed } from "../classes/MessageEmbed.js";
import { SystemMessage } from "../classes/SystemMessage.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

/**
 * Command or component use a bot message answers (Zrzur)
 */
export type MessageInteraction = APITypes.MessageInteraction;

/**
 * Where a forwarded message came from (Zrzur)
 */
export type MessageForward = APITypes.MessageForward;

/**
 * Poll carried by a message: counts per answer and your own choice (Zrzur)
 */
export type MessagePoll = APITypes.Poll;

export type HydratedMessage = {
  id: string;
  nonce?: string;
  channelId: string;
  authorId?: string;
  webhook?: MessageWebhook;
  content?: string;
  systemMessage?: SystemMessage;
  attachments?: File[];
  editedAt?: Date;
  embeds?: MessageEmbed[];
  mentionIds?: string[];
  roleMentionIds?: string[];
  replyIds?: string[];
  reactions: ReactiveMap<string, ReactiveSet<string>>;
  interactions?: Interactions;
  /** Buttons and selects sent by a bot (Zrzur) */
  components?: unknown[];
  /** The command or component use this bot message answers (Zrzur) */
  interaction?: MessageInteraction;
  masquerade?: Masquerade;
  pinned?: boolean;
  /** Where this message was forwarded from (Zrzur) */
  forwarded?: MessageForward;
  /** Poll carried by this message (Zrzur) */
  poll?: MessagePoll;
  flags?: MessageFlags;
};

export const messageHydration: Hydrate<Merge<Message>, HydratedMessage> = {
  keyMapping: {
    _id: "id",
    channel: "channelId",
    author: "authorId",
    system: "systemMessage",
    edited: "editedAt",
    mentions: "mentionIds",
    role_mentions: "roleMentionIds",
    replies: "replyIds",
  },
  functions: {
    id: (message) => message._id,
    nonce: (message) => message.nonce!,
    channelId: (message) => message.channel,
    authorId: (message) => message.author,
    webhook: (message, ctx) =>
      message.webhook
        ? new MessageWebhook(ctx as Client, message.webhook, message.author)
        : undefined,
    content: (message) => message.content!,
    systemMessage: (message, ctx) =>
      SystemMessage.from(ctx as Client, message, message.system!),
    attachments: (message, ctx) =>
      message.attachments!.map((file) => new File(ctx as Client, file)),
    editedAt: (message) => new Date(message.edited!),
    embeds: (message, ctx) =>
      message.embeds!.map((embed) => MessageEmbed.from(ctx as Client, embed)),
    mentionIds: (message) => message.mentions!,
    roleMentionIds: (message) => message.role_mentions!,
    replyIds: (message) => message.replies!,
    reactions: (message) => {
      const map = new ReactiveMap<string, ReactiveSet<string>>();
      if (message.reactions) {
        for (const reaction of Object.keys(message.reactions)) {
          map.set(reaction, new ReactiveSet(message.reactions![reaction]));
        }
      }
      return map;
    },
    interactions: (message) => message.interactions,
    components: (message) => message.components ?? [],
    interaction: (message) => message.interaction ?? undefined,
    masquerade: (message) => message.masquerade!,
    pinned: (message) => message.pinned!,
    forwarded: (message) => message.forwarded ?? undefined,
    poll: (message) => message.poll ?? undefined,
    flags: (message) => message.flags!,
  },
  initialHydration: () => ({
    reactions: new ReactiveMap(),
  }),
};

/**
 * Flags attributed to messages
 */
export enum MessageFlags {
  /**
   * Message will not send push / desktop notifications
   */
  SuppressNotifications = 1,
  /**
   * Message will mention all users who can see the channel
   */
  MentionsEveryone = 2,
  /**
   * Message will mention all users who are online and can see the channel.
   * This cannot be true if MentionsEveryone is true
   */
  MentionsOnline = 3,
}

/**
 * Whether a poll no longer takes votes: ended (early or closed by the
 * server) or past its end time (Zrzur)
 * @param poll Poll
 * @param now Time to compare with
 */
export function pollClosed(poll: MessagePoll, now: Date = new Date()): boolean {
  return !!poll.ended || new Date(poll.expires_at).getTime() <= now.getTime();
}
