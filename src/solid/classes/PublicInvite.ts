import { batch } from "solid-js";

import type { Invite, InviteResponse } from "../../api/types.js";
import type { Client } from "../Client.js";
import type {
  ServerAccess,
  ServerFlags,
  ServerJoinRequest,
} from "../hydration/server.js";

import { File } from "./File.js";
import type { Server } from "./Server.js";

/**
 * Public Channel Invite
 */
export abstract class PublicChannelInvite {
  protected client?: Client;
  readonly type: Invite["type"] | "None";

  /**
   * Construct Channel Invite
   * @param client Client
   * @param type Type
   */
  constructor(client?: Client, type: Invite["type"] | "None" = "None") {
    this.client = client;
    this.type = type;
  }

  /**
   * Create an Invite from an API Invite Response
   * @param client Client
   * @param invite Data
   * @returns Invite
   */
  static from(client: Client, invite: InviteResponse): PublicChannelInvite {
    switch (invite.type) {
      case "Server":
        return new ServerPublicInvite(client, invite);
      default:
        return new UnknownPublicInvite(client);
    }
  }
}

/**
 * Thrown by `join()` when the server needs approval: a request was made
 * (or already existed) and the person is not a member yet
 */
export class JoinRequestCreated extends Error {
  readonly request: ServerJoinRequest;

  constructor(request: ServerJoinRequest) {
    super("Join request created; waiting for approval");
    this.name = "JoinRequestCreated";
    this.request = request;
  }
}

/**
 * Public invite of unknown type
 */
export class UnknownPublicInvite extends PublicChannelInvite {}

/**
 * Public Server Invite
 */
export class ServerPublicInvite extends PublicChannelInvite {
  readonly code: string;
  readonly userName: string;
  readonly userAvatar?: File;

  readonly serverId: string;
  readonly serverName: string;
  readonly serverIcon?: File;
  readonly serverBanner?: File;
  readonly serverFlags: ServerFlags;
  readonly memberCount: number;
  /** Who can become a member; `Approval` means join sends a request */
  readonly serverAccess: ServerAccess;

  readonly channelId: string;
  readonly channelName: string;
  readonly channelDescription?: string;

  /**
   * Construct Server Invite
   * @param client Client
   * @param invite Invite
   */
  constructor(client: Client, invite: InviteResponse & { type: "Server" }) {
    super(client, "Server");

    this.code = invite.code;
    this.userName = invite.user_name;
    this.userAvatar = invite.user_avatar
      ? new File(client, invite.user_avatar)
      : undefined;

    this.serverId = invite.server_id;
    this.serverName = invite.server_name;
    this.serverIcon = invite.server_icon
      ? new File(client, invite.server_icon)
      : undefined;
    this.serverBanner = invite.server_banner
      ? new File(client, invite.server_banner)
      : undefined;
    this.serverFlags = invite.server_flags ?? 0;
    this.memberCount = invite.member_count;
    this.serverAccess = invite.server_access ?? "Open";

    this.channelId = invite.channel_id;
    this.channelName = invite.channel_name;
    this.channelDescription = invite.channel_description!;
  }

  /**
   * Server (if it exists in cache)
   */
  get server(): Server | undefined {
    return this.client!.servers.get(this.serverId);
  }

  /**
   * Join the server.
   *
   * On a server that needs approval nobody joins from a link: the server
   * records a request instead, and this throws a `JoinRequestCreated` that
   * carries it (so callers never treat the person as a member).
   */
  async join(): Promise<Server> {
    const existingServer = this.client!.servers.get(this.serverId);
    if (existingServer) return existingServer;

    const invite = await this.client!.api.post(`/invites/${this.code as ""}`);

    // not in the upstream API types: a request instead of a membership
    const pending = invite as unknown as {
      type: string;
      request?: ServerJoinRequest;
    };
    if (pending.type === "JoinRequest" && pending.request) {
      throw new JoinRequestCreated(pending.request);
    }

    if (invite.type === "Server") {
      return batch(() => {
        for (const channel of invite.channels) {
          this.client!.channels.getOrCreate(channel._id, channel);
        }

        return this.client!.servers.getOrCreate(
          invite.server._id,
          invite.server,
          true,
        );
      });
    } else {
      throw "unreachable";
    }
  }
}
