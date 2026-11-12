import { batch } from "solid-js";

import type {
  Bot as APIBot,
  ApplicationCommand,
  OwnedBotsResponse,
} from "../../api/types.js";
import { Bot } from "../classes/Bot.js";
import { PublicBot } from "../classes/PublicBot.js";
import type { HydratedBot } from "../hydration/bot.js";

import { ClassCollection } from "./Collection.js";

/** How long a bot's public page is kept (ms) */
export const PUBLIC_BOT_TTL = 5 * 60 * 1000;

/** Bots whose public page is kept at once; the oldest is dropped first */
export const PUBLIC_BOT_LIMIT = 256;

type Kept<T> = { at: number; value?: T; pending?: Promise<T> };

/**
 * A small time-limited memory of answers by bot id. Callers asking at the
 * same time share one request; a failed request is not kept.
 */
class PublicCache<T> {
  #entries = new Map<string, Kept<T>>();

  constructor(private now: () => number) {}

  get(id: string): T | undefined {
    const entry = this.#entries.get(id);
    if (!entry || entry.value === undefined) return undefined;
    if (this.now() - entry.at >= PUBLIC_BOT_TTL) {
      this.#entries.delete(id);
      return undefined;
    }
    return entry.value;
  }

  load(id: string, request: () => Promise<T>): Promise<T> {
    const kept = this.get(id);
    if (kept !== undefined) return Promise.resolve(kept);
    const entry = this.#entries.get(id);
    if (entry?.pending) return entry.pending;

    const pending = request().then(
      (value) => {
        // a newer forget() or request replaced this one: do not store over it
        if (this.#entries.get(id)?.pending === pending) {
          this.#entries.delete(id);
          this.#entries.set(id, { at: this.now(), value });
          this.#trim();
        }
        return value;
      },
      (error) => {
        if (this.#entries.get(id)?.pending === pending) {
          this.#entries.delete(id);
        }
        throw error;
      },
    );
    this.#entries.set(id, { at: this.now(), pending });
    return pending;
  }

  forget(id: string) {
    this.#entries.delete(id);
  }

  #trim() {
    // a Map keeps insertion order: the first key is the oldest
    while (this.#entries.size > PUBLIC_BOT_LIMIT) {
      const oldest = this.#entries.keys().next().value!;
      this.#entries.delete(oldest);
    }
  }
}

/**
 * Collection of Bots
 */
export class BotCollection extends ClassCollection<Bot, HydratedBot> {
  /** Clock for the public-page cache (replaceable in tests) */
  now: () => number = () => Date.now();

  #publicBots = new PublicCache<PublicBot>(() => this.now());
  #publicCommands = new PublicCache<ApplicationCommand[]>(() => this.now());
  /**
   * Fetch bot by ID
   * @param id Id
   * @returns Bot
   */
  async fetch(id: string): Promise<Bot> {
    const bot = this.get(id);
    if (bot) return bot;
    const data = await this.client.api.get(`/bots/${id as ""}`);
    this.client.users.getOrCreate(data.user._id, data.user);
    return this.getOrCreate(data.bot._id, data.bot);
  }

  /**
   * Fetch owned bots
   * @returns List of bots
   */
  async fetchOwned(): Promise<Bot[]> {
    const data = (await this.client.api.get("/bots/@me")) as OwnedBotsResponse;
    return batch(() => {
      data.users.forEach((user) =>
        this.client.users.getOrCreate(user._id, user),
      );
      return data.bots.map((bot) => this.getOrCreate(bot._id, bot));
    });
  }

  /**
   * Fetch public bot by ID. Kept for a few minutes, and callers asking at
   * the same time (a profile card's parts) share one request.
   * @param id Id
   * @returns Public Bot
   */
  fetchPublic(id: string): Promise<PublicBot> {
    return this.#publicBots.load(id, async () => {
      const data = await this.client.api.get(`/bots/${id as ""}/invite`);
      return new PublicBot(this.client, data);
    });
  }

  /**
   * The public bot already fetched and still fresh, without a request
   * @param id Id
   */
  getPublic(id: string): PublicBot | undefined {
    return this.#publicBots.get(id);
  }

  /**
   * A bot's registered global commands (`GET /bots/{id}/commands`), kept
   * like {@link fetchPublic}
   * @param id Bot id
   */
  fetchPublicCommands(id: string): Promise<ApplicationCommand[]> {
    return this.#publicCommands.load(id, () =>
      this.client.api.get(
        `/bots/${id as ""}/commands` as "/bots/{target}/commands",
      ),
    );
  }

  /**
   * Drop what is kept of a bot's public page (it changed)
   * @param id Bot id
   */
  forgetPublic(id: string) {
    this.#publicBots.forget(id);
    this.#publicCommands.forget(id);
  }

  /**
   * Get or create
   * @param id Id
   * @param data Data
   * @returns Bot
   */
  getOrCreate(id: string, data: APIBot): Bot {
    if (this.has(id)) {
      return this.get(id)!;
    } else {
      const instance = new Bot(this, id);
      this.create(id, "bot", instance, this.client, data);
      return instance;
    }
  }

  /**
   * Create a bot
   * @param name Bot name
   * @returns The newly-created bot
   */
  async createBot(name: string): Promise<Bot> {
    const { user, ...bot } = await this.client.api.post(`/bots/create`, {
      name,
    });

    this.client.users.getOrCreate(user._id, user);
    return this.getOrCreate(bot._id, bot);
  }
}
