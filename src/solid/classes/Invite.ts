import type { Invite } from "../../api/types.js";
import type { Client } from "../Client.js";

import type { Channel } from "./Channel.js";
import type { Server } from "./Server.js";
import type { User } from "./User.js";

/**
 * Channel Invite
 */
export abstract class ChannelInvite {
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
   * Create an Invite from an API Invite
   * @param client Client
   * @param invite Data
   * @returns Invite
   */
  static from(client: Client, invite: Invite): ChannelInvite {
    switch (invite.type) {
      case "Server":
        return new ServerInvite(client, invite);
      default:
        return new UnknownInvite(client);
    }
  }
}

/**
 * Invite of unknown type
 */
export class UnknownInvite extends ChannelInvite {}

/**
 * Server Invite
 */
export class ServerInvite extends ChannelInvite {
  readonly id: string;
  readonly creatorId: string;
  readonly serverId: string;
  readonly channelId: string;
  /** How many people joined with it */
  readonly uses: number;
  /** How many people can join with it (unlimited when undefined) */
  readonly maxUses?: number;
  /** When it stops working (never when undefined) */
  readonly expires?: Date;

  /**
   * Construct Server Invite
   * @param client Client
   * @param invite Invite
   */
  constructor(client: Client, invite: Invite & { type: "Server" }) {
    super(client, "Server");

    this.id = invite._id;
    this.creatorId = invite.creator;
    this.serverId = invite.server;
    this.channelId = invite.channel;

    // newer than the API types
    const extra = invite as {
      uses?: number;
      max_uses?: number | null;
      expires?: string | null;
    };
    this.uses = extra.uses ?? 0;
    this.maxUses = extra.max_uses ?? undefined;
    this.expires = extra.expires ? new Date(extra.expires) : undefined;
  }

  /**
   * Creator of the invite
   */
  get creator(): User | undefined {
    return this.client!.users.get(this.creatorId);
  }

  /**
   * Server this invite points to
   */
  get server(): Server | undefined {
    return this.client!.servers.get(this.serverId);
  }

  /**
   * Channel this invite points to
   */
  get channel(): Channel | undefined {
    return this.client!.channels.get(this.channelId);
  }

  /**
   * Delete the invite
   */
  async delete(): Promise<void> {
    await this.client!.api.delete(`/invites/${this.id}`);
  }
}
