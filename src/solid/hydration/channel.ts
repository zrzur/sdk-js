import { ReactiveSet } from "@solid-primitives/set";

import type * as APITypes from "../../api/types.js";
import type { Channel as APIChannel } from "../../api/types.js";
import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

export type HydratedChannel = {
  id: string;
  channelType: APIChannel["channel_type"];

  name: string;
  description?: string;
  icon?: File;

  active: boolean;
  typingIds: ReactiveSet<string>;
  recipientIds: ReactiveSet<string>;

  userId?: string;
  ownerId?: string;
  serverId?: string;

  permissions?: bigint;
  defaultPermissions?: { a: bigint; d: bigint };
  rolePermissions?: Record<string, { a: bigint; d: bigint }>;
  /** Overrides for single members, by user id (applied after the roles) */
  memberPermissions?: Record<string, { a: bigint; d: bigint }>;
  /** Uses its category's default and role permissions instead of its own */
  permissionsSynced: boolean;
  nsfw: boolean;
  slowmode: number;

  lastMessageId?: string;

  voice?: {
    maxUsers?: number;
    stage?: boolean;
    /** Room maker: asking it for a room makes a voice channel of your own */
    maker?: boolean;
    /** Temporary room: the member it was made for; removed when it empties */
    temporaryFor?: string;
    /** Temporary room: only the people let in can join */
    locked?: boolean;
    /** Temporary room: only the people let in can see it */
    hidden?: boolean;
    /** Room maker: how its rooms are named; `{name}` stands for the member */
    roomName?: string;
  };
  /** Announcement channel: only people who can manage messages post */
  announcement: boolean;

  /** A thread's channel (a thread uses its permissions) */
  parentId?: string;
  /** Thread state, when this channel is a thread */
  thread?: ThreadInformation;
  /** Forum settings, when this channel is a forum */
  forum?: ForumInformation;
  /** Ticket state, when this channel is a member's ticket */
  ticket?: TicketInformation;
};

/** State of a ticket: a private channel between a member and the ticket staff */
export type TicketInformation = {
  /** The member who opened it */
  openerId: string;
  /** Its number in the server, from 1 */
  number: number;
  /** Closed: its opener no longer sees it; the staff can reopen it */
  closed: boolean;
  /** Name of the ticket type it was opened as, when the server has types */
  kind?: string;
  /** The staff member who took it */
  claimedById?: string;
  /** What its opener gave the help, 1 to 5, when they closed it */
  rating?: number;
};

/** State of a thread */
export type ThreadInformation = {
  ownerId: string;
  starterMessageId?: string;
  archived: boolean;
  locked: boolean;
  tags: string[];
  messageCount: number;
};

/** A forum tag */
export type ForumTag = APITypes.ForumTag;

/** Settings of a forum channel */
export type ForumInformation = { tags: ForumTag[]; requireTag: boolean };

export const channelHydration: Hydrate<Merge<APIChannel>, HydratedChannel> = {
  keyMapping: {
    _id: "id",
    channel_type: "channelType",
    recipients: "recipientIds",
    user: "userId",
    owner: "ownerId",
    server: "serverId",
    default_permissions: "defaultPermissions",
    role_permissions: "rolePermissions",
    last_message_id: "lastMessageId",
    slowmode: "slowmode",
  },
  functions: {
    id: (channel) => channel._id,
    channelType: (channel) => channel.channel_type,
    name: (channel) => channel.name,
    description: (channel) => channel.description!,
    icon: (channel, ctx) => new File(ctx as Client, channel.icon!),
    active: (channel) => channel.active || false,
    typingIds: () => new ReactiveSet(),
    recipientIds: (channel) => new ReactiveSet(channel.recipients),
    userId: (channel) => channel.user,
    ownerId: (channel) => channel.owner,
    serverId: (channel) => channel.server,
    permissions: (channel) => BigInt(channel.permissions!),
    defaultPermissions: (channel) => ({
      a: BigInt(channel.default_permissions?.a ?? 0),
      d: BigInt(channel.default_permissions?.d ?? 0),
    }),
    rolePermissions: (channel) =>
      Object.fromEntries(
        Object.entries(channel.role_permissions ?? {}).map(([k, v]) => [
          k,
          {
            a: BigInt(v.a),
            d: BigInt(v.d),
          },
        ]),
      ),
    memberPermissions: (channel) =>
      Object.fromEntries(
        Object.entries(
          (
            channel as {
              member_permissions?: Record<string, { a: number; d: number }>;
            }
          ).member_permissions ?? {},
        ).map(([k, v]) => [k, { a: BigInt(v.a), d: BigInt(v.d) }]),
      ),
    parentId: (channel) => channel.parent ?? undefined,
    thread: (channel) => {
      const thread = channel.thread;
      return thread
        ? {
            ownerId: thread.owner,
            starterMessageId: thread.starter_message ?? undefined,
            archived: thread.archived ?? false,
            locked: thread.locked ?? false,
            tags: thread.tags ?? [],
            messageCount: thread.message_count ?? 0,
          }
        : undefined;
    },
    forum: (channel) => {
      const forum = channel.forum;
      return forum
        ? { tags: forum.tags ?? [], requireTag: forum.require_tag ?? false }
        : undefined;
    },
    ticket: (channel) => {
      const ticket = channel.ticket;
      return ticket
        ? {
            openerId: ticket.opener,
            number: ticket.number,
            closed: ticket.closed ?? false,
            kind: ticket.kind ?? undefined,
            claimedById: ticket.claimed_by ?? undefined,
            rating: ticket.rating ?? undefined,
          }
        : undefined;
    },
    permissionsSynced: (channel) => channel.permissions_synced || false,
    nsfw: (channel) => channel.nsfw || false,
    lastMessageId: (channel) => channel.last_message_id!,
    slowmode: (channel) => channel.slowmode ?? 0,
    announcement: (channel) => channel.announcement || false,
    voice: (channel) =>
      !!channel.voice ||
      channel.channel_type === "DirectMessage" ||
      channel.channel_type === "Group"
        ? {
            maxUsers: channel.voice?.max_users || undefined,
            stage: channel.voice?.stage || undefined,
            maker: channel.voice?.maker || undefined,
            temporaryFor: channel.voice?.temporary ?? undefined,
            locked: channel.voice?.locked || undefined,
            hidden: channel.voice?.hidden || undefined,
            roomName: channel.voice?.room_name ?? undefined,
          }
        : undefined,
  },
  initialHydration: () => ({
    typingIds: new ReactiveSet(),
    recipientIds: new ReactiveSet(),
  }),
};

// newer than the API types: per-member overrides and category sync in
// channel updates
(channelHydration.keyMapping as Record<string, string>).member_permissions =
  "memberPermissions";
(channelHydration.keyMapping as Record<string, string>).permissions_synced =
  "permissionsSynced";
Object.assign(channelHydration.keyMapping as Record<string, string>, {
  parent: "parentId",
  thread: "thread",
  forum: "forum",
  ticket: "ticket",
});
