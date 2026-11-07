import type { Role as APIRole } from "../../api/types.js";
import type { Client } from "../Client.js";

import { File } from "./File.js";

/**
 * Server Role
 */
export class ServerRole {
  protected client: Client;
  protected serverId: string;

  readonly id: string;
  readonly name: string;
  readonly icon?: File;
  readonly permissions: {
    a: bigint;
    d: bigint;
  };
  readonly colour?: string;
  readonly hoist: boolean;
  readonly rank: number;
  readonly owner?: string;
  /** The role as the API sent it */
  readonly data: APIRole;

  /**
   * Construct server role
   * @param client Client
   * @param serverId Server ID
   * @param id Role ID
   * @param data Role data
   */
  constructor(client: Client, serverId: string, id: string, data: APIRole) {
    this.client = client;
    this.serverId = serverId;

    this.id = id;
    this.name = data.name;
    this.icon = data.icon ? new File(client, data.icon) : undefined;
    this.permissions = {
      a: BigInt(data.permissions.a),
      d: BigInt(data.permissions.d),
    };
    this.colour = data.colour ?? undefined;
    this.hoist = data.hoist || false;
    this.rank = data.rank ?? 0;
    this.owner = data.owner ?? undefined;
    this.data = data;
  }

  /**
   * A copy of this role with some fields changed
   * @param changes Changed fields
   */
  with(changes: Partial<APIRole>): ServerRole {
    return new ServerRole(this.client, this.serverId, this.id, {
      ...this.data,
      ...changes,
    });
  }

  /** Managed bot roles cannot be offered as public lobby choices. */
  get isManaged() {
    return !!this.owner;
  }

  /**
   * Write to string as a role mention
   * @returns Formatted String
   */
  toString(): string {
    return `<%${this.id}>`;
  }

  /**
   * Server attached to this role
   */
  get server() {
    return this.client.servers.get(this.serverId);
  }

  /**
   * Whether this role is assigned to our server member
   */
  get assigned() {
    return this.server?.member?.roles.includes(this.id) || false;
  }

  /**
   * Delete this role
   */
  delete() {
    return this.server!.deleteRole(this.id);
  }
}
