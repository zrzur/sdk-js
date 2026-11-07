import type { Webhook } from "../../api/types.js";
import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

export type HydratedChannelWebhook = {
  id: string;
  name: string;
  avatar?: File;
  channelId: string;
  creatorId: string;
  permissions: number;
  lastUsed?: Date;
  /** Only right after it was made (create, regenerate) */
  token?: string;
  /** Only with the token */
  url?: string;
};

export const channelWebhookHydration: Hydrate<
  Merge<Webhook>,
  HydratedChannelWebhook
> = {
  keyMapping: {
    id: "id",
    name: "name",
    avatar: "avatar",
    channel_id: "channelId",
    creator_id: "creatorId",
    permissions: "permissions",
    last_used: "lastUsed",
    token: "token",
    url: "url",
  },
  functions: {
    id: (webhook) => webhook.id,
    name: (webhook) => webhook.name,
    avatar: (webhook, ctx) =>
      webhook.avatar ? new File(ctx as Client, webhook.avatar) : undefined,
    channelId: (webhook) => webhook.channel_id,
    creatorId: (webhook) => webhook.creator_id,
    permissions: (webhook) => webhook.permissions,
    lastUsed: (webhook) =>
      webhook.last_used ? new Date(webhook.last_used) : undefined,
    token: (webhook) => webhook.token ?? undefined,
    url: (webhook) => webhook.url ?? undefined,
  },
  initialHydration: () => ({}),
};
