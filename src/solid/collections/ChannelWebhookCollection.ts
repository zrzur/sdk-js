import type { Webhook } from "../../api/types.js";
import { ChannelWebhook } from "../classes/ChannelWebhook.js";
import type { HydratedChannelWebhook } from "../hydration/channelWebhook.js";
import { hydrate } from "../hydration/index.js";

import { ClassCollection } from "./Collection.js";

/**
 * Collection of Channel Webhooks
 */
export class ChannelWebhookCollection extends ClassCollection<
  ChannelWebhook,
  HydratedChannelWebhook
> {
  /**
   * Fetch webhook by ID
   * @param id Id
   * @returns Webhook
   */
  async fetch(id: string): Promise<ChannelWebhook> {
    const webhook = this.get(id);
    if (webhook) return webhook;
    const data = await this.client.api.get(`/webhooks/${id as ""}`);
    return this.getOrCreate(data.id, data as Webhook);
  }

  /**
   * Create webhook with ID and token
   * @param id Id
   * @param token Token
   * @returns Webhook
   */
  async fromToken(id: string, token: string): Promise<ChannelWebhook> {
    const webhook = this.get(id);
    if (webhook) return webhook;
    const data = await this.client.api.get(
      `/webhooks/${id as ""}/${token as ""}`,
    );
    return this.getOrCreate(data.id, {
      ...data,
      avatar: undefined,
      creator_id: "",
      token,
    });
  }

  /**
   * Fetch every webhook of a server that this user may manage
   * @param serverId Server
   * @returns Webhooks, newest first
   */
  async fetchForServer(serverId: string): Promise<ChannelWebhook[]> {
    const webhooks = await this.client.api.get(
      `/servers/${serverId as ""}/webhooks`,
    );
    return webhooks.map((webhook) => {
      const known = this.get(webhook.id);
      if (known) {
        this.updateUnderlyingObject(
          webhook.id,
          hydrate("channelWebhook", webhook, this.client),
        );
        return known;
      }
      return this.getOrCreate(webhook.id, webhook);
    });
  }

  /**
   * Get or create
   * @param id Id
   * @param data Data
   */
  getOrCreate(id: string, data: Webhook): ChannelWebhook {
    if (this.has(id)) {
      return this.get(id)!;
    } else {
      const instance = new ChannelWebhook(this, id);
      this.create(id, "channelWebhook", instance, this.client, data);
      return instance;
    }
  }
}
