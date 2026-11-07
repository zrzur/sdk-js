import { decodeTime } from "ulid";

import { DataEditWebhook } from "../../api/types.js";
import type { ChannelWebhookCollection } from "../collections/ChannelWebhookCollection.js";
import { hydrate } from "../hydration/index.js";

import type { Channel } from "./Channel.js";
import type { File } from "./File.js";

/**
 * Channel Webhook Class
 */
export class ChannelWebhook {
  readonly #collection: ChannelWebhookCollection;
  readonly id: string;

  /**
   * Construct Channel Webhook
   * @param collection Collection
   * @param id Webhook
   */
  constructor(collection: ChannelWebhookCollection, id: string) {
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
   * Webhook name
   */
  get name(): string {
    return this.#collection.getUnderlyingObject(this.id).name;
  }

  /**
   * Webhook avatar
   */
  get avatar(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).avatar;
  }

  /**
   * Webhook avatar URL
   */
  get avatarURL(): string | undefined {
    return this.#collection
      .getUnderlyingObject(this.id)
      .avatar?.createFileURL();
  }

  /**
   * Channel ID this webhook belongs to
   */
  get channelId(): string {
    return this.#collection.getUnderlyingObject(this.id).channelId;
  }

  /**
   * Channel this webhook belongs to
   */
  get channel(): Channel | undefined {
    return this.#collection.client.channels.get(
      this.#collection.getUnderlyingObject(this.id).channelId,
    );
  }

  /**
   * Who made this webhook
   */
  get creatorId(): string {
    return this.#collection.getUnderlyingObject(this.id).creatorId;
  }

  /**
   * When this webhook was made
   */
  get createdAt(): Date {
    return new Date(decodeTime(this.id));
  }

  /**
   * When this webhook last sent something, to the minute
   */
  get lastUsed(): Date | undefined {
    return this.#collection.getUnderlyingObject(this.id).lastUsed;
  }

  /**
   * Permissions of this webhook
   */
  get permissions(): number {
    return this.#collection.getUnderlyingObject(this.id).permissions;
  }

  /**
   * Secret token. Known only right after it was made: the server keeps a
   * hash and never returns it again.
   */
  get token(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).token;
  }

  /**
   * Address to post to, known exactly when the token is
   */
  get url(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).url;
  }

  /**
   * Edit this webhook. Needs Manage Webhooks.
   */
  async edit(data: DataEditWebhook): Promise<void> {
    const webhook = await this.#collection.client.api.patch(
      `/webhooks/${this.id as ""}`,
      data,
    );

    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate("channelWebhook", webhook, this.#collection.client),
    );
  }

  /**
   * Make a new token. The old one stops working at once.
   * @returns The new address to post to; it is not shown again
   */
  async regenerateToken(): Promise<string> {
    const webhook = await this.#collection.client.api.post(
      `/webhooks/${this.id as ""}/token`,
    );

    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate("channelWebhook", webhook, this.#collection.client),
    );
    return webhook.url!;
  }

  /**
   * Post a short test message. Needs Manage Webhooks, not the token.
   */
  async sendTest(content: string): Promise<void> {
    await this.#collection.client.api.post(`/webhooks/${this.id as ""}/test`, {
      content,
    });
  }

  /**
   * Delete this webhook. Needs Manage Webhooks.
   */
  async delete(): Promise<void> {
    await this.#collection.client.api.delete(`/webhooks/${this.id as ""}`);

    this.#collection.delete(this.id);
  }
}
