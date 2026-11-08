import { type Accessor, type Setter, batch, createSignal } from "solid-js";

import type { ChannelUnread as APIChannelUnread } from "../../api/types.js";
import type { Client } from "../Client.js";
import { ChannelUnread } from "../classes/ChannelUnread.js";
import { Channel } from "../classes/index.js";
import type { HydratedChannelUnread } from "../hydration/channelUnread.js";

import { ClassCollection } from "./Collection.js";

/**
 * Collection of Channel Unreads
 */
export class ChannelUnreadCollection extends ClassCollection<
  ChannelUnread,
  HydratedChannelUnread
> {
  readonly #isLoaded: Accessor<boolean>;
  readonly #setLoaded: Setter<boolean>;

  constructor(client: Client) {
    super(client);
    const [isLoaded, setLoaded] = createSignal(false);
    this.#isLoaded = isLoaded;
    this.#setLoaded = setLoaded;
  }

  /**
   * Whether unread state has been loaded from the server at least once
   * (reactive). Until then no channel counts as unread and nothing is
   * acknowledged on the strength of empty data.
   */
  get loaded(): boolean {
    return this.#isLoaded();
  }

  /** Channels acknowledged on this device since the running sync started */
  #localAck = new Set<string>();
  /** Channels with a new mention on this device since the running sync started */
  #localMention = new Set<string>();
  /**
   * Channels whose ack request has not settled yet. Unlike the two sets
   * above this is not cleared when a sync starts: until the server has the
   * ack, any answer it gives is older than this device's state.
   */
  #pendingAck = new Map<string, number>();

  /**
   * Note that this device changed a channel's unread state (an ack, a new
   * mention), so a sync that was already in flight does not undo it
   * @param id Channel id
   * @param kind What changed; both when left out
   */
  markLocal(id: string, kind?: "ack" | "mention"): void {
    if (kind !== "mention") this.#localAck.add(id);
    if (kind !== "ack") this.#localMention.add(id);
  }

  /**
   * Keep an ack mark until its request settles
   * @param id Channel id
   * @returns Call it when the request has settled (success or failure)
   */
  holdAck(id: string): () => void {
    const version = (this.#pendingAck.get(id) ?? 0) + 1;
    this.#pendingAck.set(id, version);
    this.markLocal(id, "ack");
    return () => {
      // a newer ack on the same channel holds the mark on its own
      if (this.#pendingAck.get(id) !== version) return;
      this.#pendingAck.delete(id);
      // a sync already in flight asked the server before it had the ack:
      // its answer must not undo this device's state
      this.#localAck.add(id);
    };
  }

  /**
   * Move a channel's read point forward to a message the server already
   * counts as read (this account sent it, or another session of this
   * account acknowledged it). Never moves it back, sends no request, and
   * drops only the mentions up to that message.
   * @param id Channel id
   * @param messageId Message read up to
   */
  advance(id: string, messageId: string): void {
    if (!this.client.user) return;
    const placeholder = {
      _id: { channel: id, user: this.client.user.id },
      last_id: null,
      mentions: [],
    };
    const entry = this.getOrCreate(id, placeholder);
    const current = entry.lastMessageId;
    if (current !== undefined && current >= messageId) return;
    batch(() => {
      this.markLocal(id, "ack");
      this.updateUnderlyingObject(id, "lastMessageId", messageId);
      for (const m of [...entry.messageMentionIds]) {
        if (m <= messageId) entry.messageMentionIds.delete(m);
      }
    });
  }

  /**
   * Load unread information from server. Existing entries are overwritten
   * with the server's data, entries the server no longer lists are cleared;
   * what this device changed while the request was in flight is kept: an ack
   * (its message id and the mentions up to it) and new mentions are tracked
   * apart, so a mention after an ack is neither lost nor resurrected.
   */
  async sync(): Promise<void> {
    const generation = this.#generation;
    this.#localAck.clear();
    this.#localMention.clear();
    const unreads = await this.client.api.get("/sync/unreads");
    // the connection was closed or restarted while waiting: drop the answer
    if (generation !== this.#generation) return;

    batch(() => {
      const listed = new Set<string>();
      for (const unread of unreads) {
        const id = unread._id.channel;
        listed.add(id);
        const serverLast = unread.last_id ?? undefined;
        const serverMentions = unread.mentions ?? [];
        if (!this.has(id)) {
          this.getOrCreate(id, unread);
          continue;
        }
        const entry = this.get(id)!;
        const ownLast = entry.lastMessageId ?? undefined;
        const acked = this.#localAck.has(id) || this.#pendingAck.has(id);
        // this device's ack is at least as new as the server's row
        const keepAck =
          acked && ownLast !== undefined && (serverLast ?? "") <= ownLast;
        if (!keepAck) {
          this.updateUnderlyingObject(id, "lastMessageId", serverLast);
        }
        const mentions = entry.messageMentionIds;
        const own = this.#localMention.has(id) ? [...mentions] : [];
        const fromServer = keepAck
          ? serverMentions.filter((m) => m > ownLast!)
          : serverMentions;
        mentions.clear();
        for (const m of [...fromServer, ...own]) mentions.add(m);
      }
      for (const id of [...this.keys()]) {
        if (
          listed.has(id) ||
          this.#localAck.has(id) ||
          this.#localMention.has(id) ||
          this.#pendingAck.has(id)
        ) {
          continue;
        }
        this.updateUnderlyingObject(id, "lastMessageId", undefined);
        this.get(id)?.messageMentionIds.clear();
      }
      this.#setLoaded(true);
    });
  }

  #timer: ReturnType<typeof setTimeout> | undefined;
  #generation = 0;

  /**
   * Load unread information without blocking the caller: a failure (429 or
   * anything else) is retried later with backoff, honouring `Retry-After`.
   * Unread state is not essential, so the client does not wait for it.
   * A refusal (401/403) ends the retries.
   * @param attempt Number of failed attempts so far
   */
  syncInBackground(attempt = 0): void {
    this.cancelBackgroundSync();
    const generation = this.#generation;
    const run = (n: number) => {
      this.sync().then(
        () => undefined,
        (error: unknown) => {
          if (generation !== this.#generation) return;
          const failure = error as
            | { retryAfter?: number; status?: number }
            | undefined;
          if (failure?.status === 401 || failure?.status === 403) return;
          const backoff = Math.min(2000 * 2 ** n, 60_000);
          const delay = Math.max(failure?.retryAfter ?? 0, backoff);
          this.#timer = setTimeout(() => {
            if (generation === this.#generation) run(n + 1);
          }, delay);
        },
      );
    };
    run(attempt);
  }

  /**
   * Stop a pending or running background sync (the connection was lost or
   * closed, or the user logged out); a late answer is ignored
   */
  cancelBackgroundSync(): void {
    this.#generation++;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /**
   * Clear all unread data
   */
  reset(): void {
    this.updateUnderlyingObject({});
  }

  /**
   * Get or create
   * @param id Id
   * @param data Data
   */
  getOrCreate(id: string, data: APIChannelUnread): ChannelUnread {
    if (this.has(id)) {
      return this.get(id)!;
    } else {
      const instance = new ChannelUnread(this, id);
      this.create(id, "channelUnread", instance, this.client, data);
      return instance;
    }
  }

  /**
   * Get channel unread data for a specific Channel
   * @param channel Channel
   * @returns Unread
   */
  for(channel: Channel): ChannelUnread {
    return this.getOrCreate(channel.id, {
      _id: {
        channel: channel.id,
        user: this.client.user!.id,
      },
      last_id: null,
      mentions: [],
    });
  }
}
