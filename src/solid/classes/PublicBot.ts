import type {
  File as APIFile,
  PublicBot as APIPublicBot,
} from "../../api/types.js";
import type { Client } from "../Client.js";

import { Channel } from "./Channel.js";
import { File } from "./File.js";
import { Server } from "./Server.js";

/**
 * Public Bot Class
 */
export class PublicBot {
  #client: Client;

  readonly id: string;
  readonly username: string;
  readonly avatar?: File;
  readonly description?: string;
  /** Permissions the bot asks for when it is added to a server (bit field) */
  readonly defaultPermissions?: number;
  readonly privacyPolicyUrl?: string;
  readonly termsOfServiceUrl?: string;
  /** Verified by Trust & Safety */
  readonly verified: boolean;
  /** Who made the bot, only when its owner chose to show it (never an id) */
  readonly creator?: { username: string; displayName?: string };
  /** Servers the bot is in */
  readonly serverCount?: number;

  /**
   * Construct Public Bot
   * @param client Client
   * @param data Data
   */
  constructor(client: Client, data: APIPublicBot) {
    this.#client = client;
    this.id = data._id;
    this.username = data.username;
    this.avatar = data.avatar
      ? new File(client, {
          _id: data.avatar,
          tag: "avatars",
        } as APIFile)
      : undefined;
    this.description = data.description!;
    this.defaultPermissions = data.default_permissions ?? undefined;
    this.privacyPolicyUrl = data.privacy_policy_url || undefined;
    this.termsOfServiceUrl = data.terms_of_service_url || undefined;
    this.verified = data.verified ?? false;
    this.creator = data.creator
      ? {
          username: data.creator.username,
          displayName: data.creator.display_name ?? undefined,
        }
      : undefined;
    this.serverCount = data.server_count ?? undefined;
  }

  /**
   * Add the bot to a server
   * @param server Server
   */
  async addToServer(server: Server | string): Promise<void> {
    await this.#client.api.post(`/bots/${this.id as ""}/invite`, {
      server: server instanceof Server ? server.id : server,
    });
  }

  /**
   * Add the bot to a group
   * @param group Group
   */
  async addToGroup(group: Channel | string): Promise<void> {
    // TODO: should use GroupChannel once that is added
    await this.#client.api.post(`/bots/${this.id as ""}/invite`, {
      group: group instanceof Channel ? group.id : group,
    });
  }
}
