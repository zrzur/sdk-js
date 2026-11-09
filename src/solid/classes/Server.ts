import { batch } from "solid-js";

import type { ReactiveMap } from "@solid-primitives/map";
import type { ReactiveSet } from "@solid-primitives/set";
import { decodeTime } from "ulid";

import type {
  Member as APIMember,
  Message as APIMessage,
  Server as APIServer,
  User as APIUser,
  AllMemberResponse,
  AuditLogEntry,
  BannedUser,
  Category,
  DataBanCreate,
  DataCreateEmoji,
  DataCreateServerChannel,
  DataEditRole,
  DataEditServer,
  DataMessageSearch,
  DiscoverRequest,
  Override,
  Role,
} from "../../api/types.js";
import type { APIRoutes } from "../../core/API.js";
import { Permission } from "../../core/permissions.js";
import type { ServerCollection } from "../collections/ServerCollection.js";
import { hydrate } from "../hydration/index.js";
import {
  type AutoModRule,
  type ServerAccess,
  type ServerFlags,
  type ServerJoinRequest,
  type ServerLobby,
  type ServerStat,
  type ServerVanityInvite,
  type ServerVerificationLevel,
  hydrateVanityInvite,
} from "../hydration/server.js";
import { HydratedServerMember } from "../hydration/serverMember.js";
import { HydratedUser } from "../hydration/user.js";
import {
  bitwiseAndEq,
  calculatePermission,
} from "../permissions/calculator.js";

import { BannedUser as BannedUserClass } from "./BannedUser.js";
import type { Channel } from "./Channel.js";
import type { Emoji } from "./Emoji.js";
import type { File } from "./File.js";
import { ChannelInvite } from "./Invite.js";
import type { MFATicket } from "./MFA.js";
import type { Message } from "./Message.js";
import { ServerBan } from "./ServerBan.js";
import { ServerMember } from "./ServerMember.js";
import { ServerRole } from "./ServerRole.js";
import { User } from "./User.js";
import { VoiceStatus } from "./VoiceParticipant.js";

/**
 * Server Class
 */
export class Server {
  readonly #collection: ServerCollection;
  readonly id: string;

  /**
   * Construct Server
   * @param collection Collection
   * @param id Id
   */
  constructor(collection: ServerCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }
  /**
   * Convert to string
   * @returns String
   */
  toString(): string {
    return `<%${this.id}>`;
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
   * Owner's user ID
   */
  get ownerId(): string {
    return this.#collection.getUnderlyingObject(this.id).ownerId;
  }

  /**
   * Owner
   */
  get owner(): User | undefined {
    return this.#collection.client.users.get(
      this.#collection.getUnderlyingObject(this.id).ownerId,
    );
  }

  /**
   * Absolute pathname to this server in the client
   */
  get path(): string {
    return `/server/${this.id}`;
  }

  /**
   * Name
   */
  get name(): string {
    return this.#collection.getUnderlyingObject(this.id).name;
  }

  /**
   * Description
   */
  get description(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).description;
  }

  /**
   * Icon
   */
  get icon(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).icon;
  }

  /**
   * Banner
   */
  get banner(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).banner;
  }

  /**
   * Channel IDs
   */
  get channelIds(): ReactiveSet<string> {
    return this.#collection.getUnderlyingObject(this.id).channelIds;
  }

  /**
   * Channels
   */
  get channels(): Channel[] {
    const channelIds = this.#collection.getUnderlyingObject(this.id).channelIds;
    if (!channelIds) return [];

    return [...channelIds.values()]
      .map((id) => this.#collection.client.channels.get(id)!)
      .filter((x) => x);
  }

  /**
   * Categories
   */
  get categories(): Category[] | undefined {
    return this.#collection.getUnderlyingObject(this.id).categories;
  }

  /**
   * System message channels
   */
  get systemMessages(): APIServer["system_messages"] {
    return this.#collection.getUnderlyingObject(this.id).systemMessages;
  }

  /**
   * Roles
   */
  get roles(): ReactiveMap<string, ServerRole> {
    return this.#collection.getUnderlyingObject(this.id).roles;
  }

  /**
   * Default permissions
   */
  get defaultPermissions(): bigint {
    return this.#collection.getUnderlyingObject(this.id).defaultPermissions;
  }

  /**
   * Server flags
   */
  get flags(): ServerFlags {
    return this.#collection.getUnderlyingObject(this.id).flags;
  }

  /**
   * Whether analytics are enabled for this server
   */
  get analytics(): boolean {
    return this.#collection.getUnderlyingObject(this.id).analytics;
  }

  /**
   * Whether this server is publicly discoverable
   */
  get discoverable(): boolean {
    return this.#collection.getUnderlyingObject(this.id).discoverable;
  }

  /**
   * Threads are switched off on this server: nothing new, existing ones stay
   * readable
   */
  get threadsDisabled(): boolean {
    return this.#collection.getUnderlyingObject(this.id).threadsDisabled;
  }

  /**
   * Forums are switched off on this server: nothing new, existing ones stay
   * readable
   */
  get forumsDisabled(): boolean {
    return this.#collection.getUnderlyingObject(this.id).forumsDisabled;
  }

  /**
   * Who can become a member: `Open`, `Approval` or `Locked`
   */
  get access(): ServerAccess {
    return this.#collection.getUnderlyingObject(this.id).access ?? "Open";
  }

  /**
   * What members without a role need before they can talk:
   * `None`, `Low`, `Medium` or `High`
   */
  get verificationLevel(): ServerVerificationLevel {
    return (
      this.#collection.getUnderlyingObject(this.id).verificationLevel ?? "None"
    );
  }

  /**
   * Zrzur supercharges on this server and the level they reach
   */
  get supercharge(): { count: number; level: number } | undefined {
    return this.#collection.getUnderlyingObject(this.id).supercharge;
  }

  /**
   * Id of the channel that holds the server rules
   */
  get rulesChannelId(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).rulesChannelId;
  }

  /**
   * Channel that holds the server rules
   */
  get rulesChannel(): Channel | undefined {
    const id = this.rulesChannelId;
    return id ? this.#collection.client.channels.get(id) : undefined;
  }

  /**
   * Live counters shown at the top of the channel list, in order
   */
  get stats(): ServerStat[] {
    return this.#collection.getUnderlyingObject(this.id).stats ?? [];
  }

  /**
   * Welcome page shown before the channels
   */
  get lobby(): ServerLobby | undefined {
    return this.#collection.getUnderlyingObject(this.id).lobby;
  }

  /**
   * Custom invite link (zrzur.cc/<code>), a Wings level perk
   */
  get vanityInvite(): ServerVanityInvite | undefined {
    return this.#collection.getUnderlyingObject(this.id).vanityInvite;
  }

  /**
   * Approximate amount of members in this server
   */
  get approximateMemberCount(): number {
    return this.#collection.getUnderlyingObject(this.id).approximateMemberCount;
  }

  /**
   * Whether this server is marked as mature
   */
  get mature(): boolean {
    return this.#collection.getUnderlyingObject(this.id).nsfw;
  }

  /**
   * Get an array of ordered categories with their respective channels.
   * Uncategorised channels are returned in `id="default"` category.
   */
  get orderedChannels(): (Omit<Category, "channels"> & {
    channels: Channel[];
  })[] {
    const uncategorised = new Set(this.channels.map((channel) => channel.id));

    const elements = [];
    let defaultCategory;

    const categories = this.categories;
    if (categories) {
      for (const category of categories) {
        const channels = [];
        for (const key of category.channels) {
          if (uncategorised.delete(key)) {
            channels.push(this.#collection.client.channels.get(key)!);
          }
        }

        const cat = {
          ...category,
          channels,
        };

        if (cat.id === "default") {
          if (channels.length === 0) continue;

          defaultCategory = cat;
        }

        elements.push(cat);
      }
    }

    // force Default category for client logic
    // if (uncategorised.size > 0) {
    const channels = [...uncategorised].map(
      (key) => this.#collection.client.channels.get(key)!,
    );

    if (defaultCategory) {
      defaultCategory.channels = [...defaultCategory.channels, ...channels];
    } else {
      elements.unshift({
        id: "default",
        title: "Default",
        channels,
      });
    }
    // }

    return elements;
  }

  /**
   * Default channel for this server
   */
  get defaultChannel(): Channel | undefined {
    return this.orderedChannels.find((cat) => cat.channels.length)?.channels[0];
  }

  /**
   * Get an ordered array of roles with their IDs attached.
   * The highest ranking roles will be first followed by lower
   * ranking roles. This is dictated by the "rank" property
   * which is smaller for higher priority roles.
   */
  get orderedRoles(): ServerRole[] {
    const roles = this.roles;
    return roles
      ? [...roles.values()].sort((a, b) => (a.rank || 0) - (b.rank || 0))
      : [];
  }

  /**
   * Check whether the server is currently unread
   * @returns Whether the server is unread
   */
  get unread(): boolean {
    return !!this.channels.find((channel) => channel.unread);
  }

  /**
   * Find all message IDs of unread messages
   * @returns Array of message IDs which are unread
   */
  get mentions(): string[] {
    const arr = this.channels.map((channel) =>
      Array.from(channel.mentions?.values() ?? []),
    );

    return ([] as string[]).concat(...arr);
  }

  /**
   * URL to the server's icon
   */
  get iconURL(): string | undefined {
    return this.icon?.createFileURL();
  }

  /**
   * URL to the server's animated icon
   */
  get animatedIconURL(): string | undefined {
    return this.icon?.createFileURL(true);
  }

  /**
   * URL to the server's banner
   */
  get bannerURL(): string | undefined {
    return this.banner?.createFileURL();
  }

  /**
   * Own member object for this server
   */
  get member(): ServerMember | undefined {
    return this.#collection.client.serverMembers.getByKey({
      server: this.id,
      user: this.#collection.client.user!.id,
    });
  }

  /**
   * Permission the currently authenticated user has against this server
   */
  get permission(): bigint {
    if (!this.$exists) return 0n;
    return calculatePermission(this.#collection.client, this);
  }

  /**
   * Check whether we have a given permission in a server
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
   * Check whether we have at least one of the given permissions in a server
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
   * Helper function to retrieve cached server member by their ID in this server
   * @param userId User's ID
   * @returns Server Member (if cached)
   */
  getMember(userId: string): ServerMember | undefined {
    return this.#collection.client.serverMembers.getByKey({
      server: this.id,
      user: userId,
    });
  }
  /**
   * @param params
   * @returns This server's tracked actions, members and users
   */
  async getAuditLogs(
    params?: (APIRoutes & {
      method: "get";
      template: "/servers/{target}/audit_logs";
      parts: 3;
    })["params"],
  ): Promise<{
    audit_logs: AuditLogEntry[];
    users: User[];
    members: ServerMember[];
  }> {
    const logs = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/audit_logs`,
      { ...params },
    );

    return batch(() => ({
      audit_logs: logs.audit_logs,
      users: logs.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
      members: logs.members.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
    }));
  }

  /**
   * Create a channel
   * @param data Channel create route data
   * @returns The newly-created channel
   */
  async createChannel(
    data: DataCreateServerChannel & {
      /** Make it an announcement channel (text channels only) */
      announcement?: boolean;
    },
  ): Promise<Channel> {
    const channel = await this.#collection.client.api.post(
      `/servers/${this.id as ""}/channels`,
      // Zrzur fields are not in the upstream API types
      data as DataCreateServerChannel,
    );

    return this.#collection.client.channels.getOrCreate(channel._id, channel);
  }

  /**
   * Edit a server
   * @param data Changes
   */
  async edit(
    data: Omit<DataEditServer, "remove"> & {
      /** Channel that holds the server rules */
      rules_channel?: string;
      /** Live counters to show at the top of the channel list */
      stats?: ServerStat[];
      /** Welcome page; replaces the whole lobby */
      lobby?: ServerLobby;
      /** Who can become a member; anything but Open also unlists it */
      access?: ServerAccess;
      /** What members without a role need before they can talk */
      verification_level?: ServerVerificationLevel;
      /** New members accept the rules before they can talk */
      rules_screening?: boolean;
      remove?: (
        | NonNullable<DataEditServer["remove"]>[number]
        | "RulesChannel"
        | "Stats"
        | "Lobby"
      )[];
    },
  ): Promise<void> {
    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate(
        "server",
        await this.#collection.client.api.patch(
          `/servers/${this.id as ""}`,
          // Zrzur fields are not in the upstream API types
          data as DataEditServer,
        ),
        this.#collection.client,
        false,
      ),
    );
  }

  /**
   * Hand the server to another member (owner only). The server asks for a
   * fresh MFA ticket and refuses bots and people who are not members.
   * @param userId New owner
   * @param ticket Validated MFA ticket
   */
  async transferOwnership(userId: string, ticket: MFATicket): Promise<void> {
    ticket._consume();
    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate(
        "server",
        await this.#collection.client.api.patch(
          `/servers/${this.id as ""}`,
          // `owner` is not in the upstream API types
          { owner: userId } as DataEditServer,
          { headers: { "X-MFA-Ticket": ticket.token } },
        ),
        this.#collection.client,
        false,
      ),
    );
  }

  /** Answer a public lobby question; the backend resolves and validates the role. */
  async answerLobbyQuestion(question: string, option: string): Promise<void> {
    this.#storeMember(
      await this.#collection.client.api.post(
        `/servers/${this.id}/lobby/answers`,
        { question, option },
      ),
    );
  }

  /** Take back a lobby answer; removes only the role of that configured answer. */
  async removeLobbyAnswer(question: string, option: string): Promise<void> {
    this.#storeMember(
      await this.#collection.client.api.delete(
        `/servers/${this.id}/lobby/answers/${encodeURIComponent(question)}/${encodeURIComponent(option)}`,
      ),
    );
  }

  /** Store the member a lobby or rules route returns. */
  #storeMember(data: APIMember) {
    this.#collection.client.serverMembers.updateUnderlyingObject(
      data._id.server + data._id.user,
      hydrate("serverMember", data, this.#collection.client, false),
    );
  }

  /**
   * Claim or change the server's custom invite link (zrzur.cc/<code>).
   * Needs Manage Server and the Wings level that unlocks it.
   * @param code Name after zrzur.cc/
   * @param channel Channel new members land in (default: first readable one)
   */
  async claimVanityInvite(code: string, channel?: string): Promise<void> {
    const data = await this.#collection.client.api.put(
      `/servers/${this.id}/vanity`,
      {
        code,
        channel,
      },
    );
    this.#collection.updateUnderlyingObject(this.id, {
      vanityInvite: hydrateVanityInvite(data),
    });
  }

  /** Remove the server's custom invite link; the name is free again. */
  async removeVanityInvite(): Promise<void> {
    await this.#collection.client.api.delete(`/servers/${this.id}/vanity`);
    this.#collection.updateUnderlyingObject(this.id, {
      vanityInvite: undefined,
    });
  }

  /**
   * Search messages in every channel of this server you may read (view the
   * channel and read its history), with the users who sent them. Channels
   * you may not read are left out, never reported.
   * @param params Same filters as a channel search, plus `channels` to search only some of them
   * @returns Messages, newest first unless `sort` says otherwise, and their authors
   */
  async searchMessagesWithUsers(
    params: Omit<DataMessageSearch, "include_users">,
  ): Promise<{
    messages: Message[];
    users: User[];
    members: ServerMember[] | undefined;
  }> {
    const data = (await this.#collection.client.api.post(
      `/servers/${this.id as ""}/messages/search`,
      { ...params, include_users: true },
    )) as
      | { messages: APIMessage[]; users: APIUser[]; members?: APIMember[] }
      | APIMessage[];
    const body = Array.isArray(data)
      ? { messages: data, users: [], members: undefined }
      : data;
    const client = this.#collection.client;
    return batch(() => ({
      messages: body.messages.map((message) =>
        client.messages.getOrCreate(message._id, message),
      ),
      users: body.users.map((user) => client.users.getOrCreate(user._id, user)),
      members: body.members?.map((member) =>
        client.serverMembers.getOrCreate(member._id, member),
      ),
    }));
  }

  /**
   * Requests to join this server that wait for a decision, oldest first,
   * with each applicant's public profile. Needs Manage Join Requests.
   */
  async fetchJoinRequests(): Promise<
    { request: ServerJoinRequest; user?: BannedUserClass }[]
  > {
    const { requests, users } = (await this.#collection.client.api.get(
      `/servers/${this.id}/join_requests`,
    )) as { requests: ServerJoinRequest[]; users: BannedUser[] };
    const byId = new Map(users.map((user) => [user._id, user]));
    return requests.map((request) => {
      const user = byId.get(request.user);
      return {
        request,
        user: user
          ? new BannedUserClass(this.#collection.client, user)
          : undefined,
      };
    });
  }

  /** Make an applicant a member (needs Manage Join Requests) */
  async approveJoinRequest(userId: string): Promise<void> {
    await this.#collection.client.api.post(
      `/servers/${this.id}/join_requests/${userId}/approve`,
    );
  }

  /** Turn down an applicant (needs Manage Join Requests) */
  async rejectJoinRequest(userId: string): Promise<void> {
    await this.#collection.client.api.post(
      `/servers/${this.id}/join_requests/${userId}/reject`,
    );
  }

  /** Change who can become a member (needs Manage Server) */
  async setAccess(access: ServerAccess): Promise<void> {
    await this.edit({ access });
  }

  /** Rules screening: since when new members accept the rules first */
  get rulesScreeningSince(): Date | undefined {
    return this.#collection.getUnderlyingObject(this.id).rulesScreeningSince;
  }

  /** Whether you still have to accept the rules before you can talk */
  get mustAcceptRules(): boolean {
    const since = this.rulesScreeningSince;
    const member = this.member;
    return (
      !!since &&
      !!this.rulesChannelId &&
      !!member &&
      this.ownerId !== member.id.user &&
      +member.joinedAt >= +since &&
      !member.acceptedRulesAt
    );
  }

  /** Accept the server rules (rules screening) */
  async acceptRules(): Promise<void> {
    this.#storeMember(
      await this.#collection.client.api.post(
        `/servers/${this.id}/rules/accept`,
      ),
    );
  }

  /** Switch rules screening on or off (needs Manage Server and a rules channel) */
  async setRulesScreening(enabled: boolean): Promise<void> {
    await this.edit({ rules_screening: enabled });
  }

  /** Until when invites are paused (in the past or undefined: not paused) */
  get invitesPausedUntil(): Date | undefined {
    return this.#collection.getUnderlyingObject(this.id).invitesPausedUntil;
  }

  /** Until when DMs between members who aren't friends are paused */
  get dmsPausedUntil(): Date | undefined {
    return this.#collection.getUnderlyingObject(this.id).dmsPausedUntil;
  }

  /**
   * Security actions: pause invites and / or DMs between members who
   * aren't friends for 1, 6, 12 or 24 hours; 0 ends a pause (Manage Server)
   */
  async pauseSafety(pause: {
    invitesHours?: 0 | 1 | 6 | 12 | 24;
    dmsHours?: 0 | 1 | 6 | 12 | 24;
  }): Promise<void> {
    await this.#collection.client.api.put(`/servers/${this.id}/safety/pause`, {
      invites_hours: pause.invitesHours,
      dms_hours: pause.dmsHours,
    });
  }

  /** The server's AutoMod rules (needs Manage Server) */
  async fetchAutoMod(): Promise<AutoModRule[]> {
    return (
      await this.#collection.client.api.get(`/servers/${this.id}/automod`)
    ).rules;
  }

  /** Replace the server's AutoMod rules, at most 10 (needs Manage Server) */
  async setAutoMod(rules: AutoModRule[]): Promise<AutoModRule[]> {
    return (
      await this.#collection.client.api.put(`/servers/${this.id}/automod`, {
        rules,
      })
    ).rules;
  }

  /** Change what members without a role need (needs Manage Server) */
  async setVerificationLevel(level: ServerVerificationLevel): Promise<void> {
    await this.edit({ verification_level: level });
  }

  /**
   * Set ordering of roles
   * @param roleIds Role IDs
   */
  async setRoleOrdering(roleIds: string[]): Promise<void> {
    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate(
        "server",
        await this.#collection.client.api.patch(
          `/servers/${this.id as ""}/roles/ranks`,
          {
            ranks: roleIds,
          },
        ),
        this.#collection.client,
        false,
      ),
    );
  }

  /**
   * Delete the underlying server
   * @param leaveEvent Whether we are leaving
   */
  $delete(leaveEvent?: boolean): void {
    batch(() => {
      const server = this.#collection.client.servers.getUnderlyingObject(
        this.id,
      );

      // Avoid race conditions
      if (server.id) {
        this.#collection.client.emit(
          leaveEvent ? "serverLeave" : "serverDelete",
          server,
        );

        for (const channel of this.channelIds) {
          this.#collection.client.channels.delete(channel);
        }
        // threads are not in channelIds: drop the ones of this server too
        const threads: string[] = [];
        this.#collection.client.channels.forEach((channel, id) => {
          if (channel.serverId === server.id && channel.parentId) {
            threads.push(id);
          }
        });
        for (const id of threads) this.#collection.client.channels.delete(id);

        this.#collection.delete(this.id);
      }
      // TODO: delete members, emoji, etc
    });
  }

  /**
   * Delete or leave a server
   * @param leaveSilently Whether to not send a message on leave
   * @param ticket Validated MFA ticket, required by the server when the owner deletes it
   */
  async delete(leaveSilently?: boolean, ticket?: MFATicket): Promise<void> {
    ticket?._consume();
    await this.#collection.client.api.delete(
      `/servers/${this.id as ""}`,
      {
        leave_silently: leaveSilently,
      },
      ticket
        ? {
            headers: {
              "X-MFA-Ticket": ticket.token,
            },
          }
        : undefined,
    );

    this.$delete();
  }

  /**
   * Mark a server as read
   */
  async ack(): Promise<void> {
    // the marks stay until the request settles, so an unread sync that
    // starts meanwhile does not bring the channels back as unread
    const unreads = this.#collection.client.channelUnreads;
    const releases = this.channels.map((channel) =>
      unreads.holdAck(channel.id),
    );
    batch(() => {
      for (const channel of this.channels) {
        channel.ack(undefined, false, true);
      }
    });

    try {
      await this.#collection.client.api.put(`/servers/${this.id}/ack`);
    } finally {
      for (const release of releases) release();
    }
  }

  /**
   * Ban user from this server
   * @param user User
   * @param options Ban options
   */
  async banUser(
    user: string | User | ServerMember,
    options: DataBanCreate = {},
    auditReason?: string,
  ): Promise<ServerBan> {
    const userId =
      user instanceof User
        ? user.id
        : user instanceof ServerMember
          ? user.id.user
          : user;

    const ban = await this.#collection.client.api.put(
      `/servers/${this.id as ""}/bans/${userId as ""}`,
      options,
      auditReasonHeader(auditReason ?? options.reason ?? undefined),
    );

    return new ServerBan(this.#collection.client, ban);
  }

  /**
   * Kick user from this server
   * @param user User
   */
  async kickUser(
    user: string | User | ServerMember,
    reason?: string,
  ): Promise<void> {
    return await this.#collection.client.api.delete(
      `/servers/${this.id as ""}/members/${
        typeof user === "string"
          ? user
          : user instanceof User
            ? user.id
            : user.id.user
      }`,
      undefined,
      auditReasonHeader(reason),
    );
  }

  /**
   * Pardon user's ban
   * @param user User
   */
  async unbanUser(user: string | User): Promise<void> {
    const userId = user instanceof User ? user.id : user;
    return await this.#collection.client.api.delete(
      `/servers/${this.id as ""}/bans/${userId}`,
    );
  }

  /**
   * Fetch a server's invites
   * @returns An array of the server's invites
   */
  async fetchInvites(): Promise<ChannelInvite[]> {
    const invites = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/invites`,
    );

    return invites.map((invite) =>
      ChannelInvite.from(this.#collection.client, invite),
    );
  }

  /**
   * Fetch a server's bans
   * @returns An array of the server's bans.
   */
  async fetchBans(): Promise<ServerBan[]> {
    const { users, bans } = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/bans`,
    );

    const userDict = users.reduce(
      (d, c) => ({ ...d, [c._id]: c }),
      {} as Record<string, BannedUser>,
    );

    return bans.map(
      (ban) =>
        new ServerBan(this.#collection.client, ban, userDict[ban._id.user]),
    );
  }

  /**
   * Set role permissions
   * @param roleId Role Id, set to 'default' to affect all users
   * @param permissions Permission value
   */
  async setPermissions(
    roleId = "default",
    permissions: Override | number,
  ): Promise<APIServer> {
    return await this.#collection.client.api.put(
      `/servers/${this.id as ""}/permissions/${roleId as ""}`,
      { permissions: permissions as Override },
    );
  }

  /**
   * Set a category's permissions; channels synced with the category use them
   * @param categoryId Category Id
   * @param roleId Role Id, or 'default' for everyone
   * @param permissions Permission override (empty removes a role's)
   */
  async setCategoryPermissions(
    categoryId: string,
    roleId: string,
    permissions: Override,
  ): Promise<APIServer> {
    if (roleId === "default") {
      return await this.#collection.client.api.put(
        `/servers/${this.id}/categories/${categoryId}/permissions/default`,
        { permissions },
      );
    }
    return await this.#collection.client.api.put(
      `/servers/${this.id}/categories/${categoryId}/permissions/${roleId}`,
      { permissions },
    );
  }

  /**
   * Create role
   * @param name Role name
   */
  async createRole(name: string): Promise<{ id: string; role: Role }> {
    return await this.#collection.client.api.post(
      `/servers/${this.id as ""}/roles`,
      {
        name,
      },
    );
  }

  /**
   * Edit a role
   * @param roleId Role ID
   * @param data Role editing route data
   */
  async editRole(roleId: string, data: DataEditRole): Promise<ServerRole> {
    const updated = await this.#collection.client.api.patch(
      `/servers/${this.id as ""}/roles/${roleId as ""}`,
      data,
    );

    const role = new ServerRole(
      this.#collection.client,
      this.id,
      roleId,
      updated,
    );

    this.roles.set(roleId, role);

    return role;
  }

  /**
   * Delete role
   * @param roleId Role ID
   */
  async deleteRole(roleId: string): Promise<void> {
    return await this.#collection.client.api.delete(
      `/servers/${this.id as ""}/roles/${roleId as ""}`,
    );
  }

  /**
   * Fetch a server member
   * @param user User
   * @returns Server member object
   */
  async fetchMember(user: User | string): Promise<ServerMember> {
    const userId = typeof user === "string" ? user : user.id;
    const existing = this.#collection.client.serverMembers.getByKey({
      server: this.id,
      user: userId,
    });

    if (existing) return existing;
    return this.#collection.client.serverMembers.fetch(this.id, userId);
  }

  #synced: undefined | "partial" | "full";

  async syncMembers(excludeOffline?: boolean): Promise<void> {
    if (this.#synced && (this.#synced === "full" || excludeOffline)) return;

    // a page at a time; very large servers stop after MAX_SYNC_PAGES
    let after: string | undefined;
    for (let page = 0; page < Server.MAX_SYNC_PAGES; page++) {
      const data = await this.#memberPage({
        limit: Server.MEMBER_PAGE,
        after,
        excludeOffline,
      });

      const newUsers: HydratedUser[] = [];
      const newServerMembers: HydratedServerMember[] = [];
      const users = new Map(data.users.map((user) => [user._id, user]));

      for (const member of data.members) {
        const user = users.get(member._id.user);
        if (!user || (excludeOffline && !user.online)) continue;
        const newUser = this.#collection.client.users.hydrateIfNotHas(
          user._id,
          user,
        );
        if (newUser) {
          newUsers.push(newUser);
        }
        const newMember = this.#collection.client.serverMembers.hydrateIfNotHas(
          member._id,
          member,
        );
        if (newMember) {
          newServerMembers.push(newMember);
        }
      }

      batch(() => {
        for (const newUser of newUsers) {
          this.#collection.client.users.addHydratedUser(newUser);
        }
        for (const newServerMember of newServerMembers) {
          this.#collection.client.serverMembers.addHydratedServerMember(
            newServerMember,
          );
        }
      });

      if (!data.next) break;
      after = data.next;
    }
  }

  /**
   * Reset member sync status
   */
  resetSyncStatus(): void {
    this.#synced = undefined;
  }

  /** Members per page when syncing or fetching every member */
  static MEMBER_PAGE = 1000;
  /** Pages syncMembers loads at most (the member sidebar) */
  static MAX_SYNC_PAGES = 10;

  /** One page of members, as the API returns it */
  async #memberPage(options: {
    limit?: number;
    after?: string;
    excludeOffline?: boolean;
  }): Promise<AllMemberResponse> {
    return await this.#collection.client.api.get(
      `/servers/${this.id}/members`,
      {
        limit: options.limit || undefined,
        after: options.after,
        exclude_offline: options.excludeOffline || undefined,
      },
    );
  }

  /**
   * Fetch one page of a server's members, ordered by user id
   * @param options.limit Page size (default 100, at most 1000)
   * @param options.after Start after this user id (the previous page's `next`)
   * @returns Members, their users, and `next` while more pages follow
   */
  async fetchMembersPage(
    options: { limit?: number; after?: string } = {},
  ): Promise<{ members: ServerMember[]; users: User[]; next?: string }> {
    const data = await this.#memberPage({
      ...options,
      limit: options.limit ?? 100,
    });
    return batch(() => ({
      members: data.members.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
      next: data.next ?? undefined,
    }));
  }

  /**
   * Fetch all of a server's members, a page at a time
   * @returns List of the server's members and their user objects
   */
  async fetchMembers(): Promise<{ members: ServerMember[]; users: User[] }> {
    const members: ServerMember[] = [];
    const users: User[] = [];
    let after: string | undefined;
    do {
      const page = await this.fetchMembersPage({
        limit: Server.MEMBER_PAGE,
        after,
      });
      members.push(...page.members);
      users.push(...page.users);
      after = page.next;
    } while (after);
    return { members, users };
  }

  /**
   * Query members from a server by name
   * @param query Name
   * @returns List of the server's members and their user objects
   */
  async queryMembersExperimental(
    query: string,
  ): Promise<{ members: ServerMember[]; users: User[] }> {
    // as parameters: the API client always adds "?" after the path, so a
    // query written into the path ended in a stray "?" ("name?") and
    // matched nobody
    const data = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/members_experimental_query`,
      { query, experimental_api: true },
    );

    return batch(() => ({
      members: data.members.map((member) =>
        this.#collection.client.serverMembers.getOrCreate(member._id, member),
      ),
      users: data.users.map((user) =>
        this.#collection.client.users.getOrCreate(user._id, user),
      ),
    }));
  }

  /**
   * Create an emoji on the server
   * @param autumnId Autumn Id
   * @param options Options
   */
  async createEmoji(
    autumnId: string,
    options: Omit<DataCreateEmoji, "parent">,
  ): Promise<Emoji> {
    const emoji = await this.#collection.client.api.put(
      `/custom/emoji/${autumnId as ""}`,
      {
        parent: {
          type: "Server",
          id: this.id,
        },
        ...options,
      },
    );

    return this.#collection.client.emojis.getOrCreate(emoji._id, emoji, true);
  }

  /**
   * Fetch a server's emoji
   * @returns List of server emoji
   */
  async fetchEmojis(): Promise<Emoji[]> {
    const emojis = await this.#collection.client.api.get(
      `/servers/${this.id as ""}/emojis`,
    );

    return batch(() =>
      emojis.map((emoji) =>
        this.#collection.client.emojis.getOrCreate(emoji._id, emoji),
      ),
    );
  }

  /**
   * All emojis tied to this server
   */
  get emojis(): Emoji[] {
    return this.#collection.client.emojis.filter(
      (emoji) => emoji.parent.type === "Server" && emoji.parent.id === this.id,
    );
  }

  /**
   * Delete emoji
   * @param emojiId Emoji ID
   */
  async deleteEmoji(emojiId: string): Promise<void> {
    await this.#collection.client.api.delete(`/custom/emoji/${emojiId}`);
  }

  /**
   * The voice status of a server. Screenshare supersedes video, video
   * supersedes voice, and voice supersedes none. This getter takes the highest
   * priority status from all channels in the server.
   */
  get voiceStatus(): VoiceStatus {
    let highest: VoiceStatus = "none";

    for (const chan of this.channels) {
      const status = chan.voiceStatus;
      if (status === "screenshare") {
        return "screenshare";
      }
      if (status === "video") {
        highest = "video";
      }
      if (status === "voice" && highest === "none") {
        highest = "voice";
      }
    }

    return highest;
  }

  /**
   * Add server to the discover request queue
   */
  async requestDiscover(): Promise<void> {
    await this.#collection.client.api.put(`/servers/${this.id as ""}/discover`);
  }

  /**
   * Get the status of the discover request for this server
   * @returns The discovery request for this server if one exists
   */
  async discoverRequestStatus(): Promise<DiscoverRequest> {
    return await this.#collection.client.api.get(
      `/servers/${this.id as ""}/discover`,
    );
  }

  /**
   * Cancel the discover request for this server
   *
   * This cannot be used to remove servers from discover that have already been accepted
   * and should only be called on servers that have an outstanding discover request.
   */
  async cancelDiscoverRequest() {
    await this.#collection.client.api.delete(
      `/servers/${this.id as ""}/discover`,
    );
  }
}

/**
 * Request options carrying an audit log reason. URL-encoded, so reasons in
 * any language fit in a header (the server decodes them).
 */
export function auditReasonHeader(
  reason?: string,
): { headers: Record<string, string> } | undefined {
  const text = reason?.trim();
  return text
    ? { headers: { "X-Audit-Log-Reason": encodeURIComponent(text) } }
    : undefined;
}
