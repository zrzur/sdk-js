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

  voice?: { maxUsers?: number };
  /** Announcement channel: only people who can manage messages post */
  announcement: boolean;

  /** A thread's channel (a thread uses its permissions) */
  parentId?: string;
  /** Thread state, when this channel is a thread */
  thread?: ThreadInformation;
  /** Forum settings, when this channel is a forum */
  forum?: ForumInformation;
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
});
