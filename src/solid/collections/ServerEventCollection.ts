import { createStore, produce, reconcile } from "solid-js/store";

import type {
  DataCreateServerEvent,
  DataEditServerEvent,
  ServerEvent,
  ServerEventInterestedPage,
  ServerEventPlace,
} from "../../api/types.js";
import type { Client } from "../Client.js";

/** What the collection keeps per event */
type Stored = {
  event: ServerEvent;
  /** Whether you marked it "Interested" */
  interested: boolean;
};

/**
 * Scheduled server events.
 *
 * Kept by id in a Solid store, so lists and counts update by themselves
 * when the gateway reports a change. `fetchForServer` loads a server's
 * upcoming events once; gateway events keep them current afterwards.
 */
export class ServerEventCollection {
  readonly client: Client;
  readonly #store: Record<string, Stored>;
  readonly #set: ReturnType<typeof createStore<Record<string, Stored>>>[1];
  readonly #loaded: Record<string, boolean>;
  readonly #setLoaded: ReturnType<
    typeof createStore<Record<string, boolean>>
  >[1];

  /**
   * Construct the collection
   * @param client Client
   */
  constructor(client: Client) {
    this.client = client;
    const [store, set] = createStore<Record<string, Stored>>({});
    this.#store = store;
    this.#set = set;
    const [loaded, setLoaded] = createStore<Record<string, boolean>>({});
    this.#loaded = loaded;
    this.#setLoaded = setLoaded;
  }

  /**
   * An event, if known
   * @param id Event id
   */
  get(id: string): ServerEvent | undefined {
    return this.#store[id]?.event;
  }

  /**
   * Whether you marked an event "Interested"
   * @param id Event id
   */
  isInterested(id: string): boolean {
    return this.#store[id]?.interested ?? false;
  }

  /**
   * Whether a server's events were loaded
   * @param serverId Server id
   */
  isLoaded(serverId: string): boolean {
    return this.#loaded[serverId] ?? false;
  }

  /**
   * Scheduled and active events of a server, happening ones first, then
   * the soonest
   * @param serverId Server id
   */
  forServer(serverId: string): ServerEvent[] {
    return Object.values(this.#store)
      .map((stored) => stored?.event)
      .filter(
        (event): event is ServerEvent =>
          !!event && event.server === serverId && isUpcoming(event),
      )
      .sort(compareEvents);
  }

  /**
   * Load a server's events (the ones you can see)
   * @param serverId Server id
   */
  async fetchForServer(serverId: string): Promise<ServerEvent[]> {
    const list = await this.client.api.get(`/servers/${serverId as ""}/events`);
    this.#set(
      produce((store) => {
        // drop what the server no longer lists
        for (const [id, stored] of Object.entries(store)) {
          if (stored?.event.server === serverId && isUpcoming(stored.event)) {
            delete store[id];
          }
        }
        for (const event of list.events) {
          store[event._id] = {
            event,
            interested: list.interested.includes(event._id),
          };
        }
      }),
    );
    this.#setLoaded(serverId, true);
    return this.forServer(serverId);
  }

  /**
   * Load one event (also a past one), e.g. from a shared link
   * @param serverId Server id
   * @param id Event id
   */
  async fetch(serverId: string, id: string): Promise<ServerEvent> {
    const response = await this.client.api.get(
      `/servers/${serverId as ""}/events/${id as ""}`,
    );
    this.#put(response.event, response.interested);
    return response.event;
  }

  /**
   * Schedule an event
   * @param serverId Server id
   * @param data Event
   */
  async create(
    serverId: string,
    data: DataCreateServerEvent,
  ): Promise<ServerEvent> {
    const event = await this.client.api.post(
      `/servers/${serverId as ""}/events`,
      data,
    );
    this.#put(event);
    return event;
  }

  /**
   * Change an event
   * @param serverId Server id
   * @param id Event id
   * @param data Changes
   */
  async edit(
    serverId: string,
    id: string,
    data: DataEditServerEvent,
  ): Promise<ServerEvent> {
    const event = await this.client.api.patch(
      `/servers/${serverId as ""}/events/${id as ""}`,
      data,
    );
    this.#put(event);
    return event;
  }

  /**
   * Start an event now
   * @param serverId Server id
   * @param id Event id
   */
  async start(serverId: string, id: string): Promise<ServerEvent> {
    const event = await this.client.api.post(
      `/servers/${serverId as ""}/events/${id as ""}/start`,
    );
    this.#put(event);
    return event;
  }

  /**
   * End an active event now
   * @param serverId Server id
   * @param id Event id
   */
  async end(serverId: string, id: string): Promise<ServerEvent> {
    const event = await this.client.api.post(
      `/servers/${serverId as ""}/events/${id as ""}/end`,
    );
    this.#put(event);
    return event;
  }

  /**
   * Call an event off: this occurrence (a repeating event goes on with the
   * next one), or with `series` the whole series
   * @param serverId Server id
   * @param id Event id
   * @param series Stop the whole series
   */
  async cancel(
    serverId: string,
    id: string,
    series = false,
  ): Promise<ServerEvent> {
    const event = await this.client.api.post(
      `/servers/${serverId as ""}/events/${id as ""}/cancel`,
      series ? { series: true } : {},
    );
    this.#put(event);
    return event;
  }

  /**
   * Delete an event for good
   * @param serverId Server id
   * @param id Event id
   */
  async delete(serverId: string, id: string): Promise<void> {
    await this.client.api.delete(
      `/servers/${serverId as ""}/events/${id as ""}`,
    );
    this.remove(id);
  }

  /**
   * Mark or unmark an event "Interested"
   * @param serverId Server id
   * @param id Event id
   * @param interested Whether you are interested
   */
  async setInterested(
    serverId: string,
    id: string,
    interested: boolean,
  ): Promise<ServerEvent> {
    const response = interested
      ? await this.client.api.put(
          `/servers/${serverId as ""}/events/${id as ""}/interested`,
        )
      : await this.client.api.delete(
          `/servers/${serverId as ""}/events/${id as ""}/interested`,
        );
    this.#put(response.event, response.interested);
    return response.event;
  }

  /**
   * A page of the members who marked an event "Interested"; the users are
   * added to the user collection
   * @param serverId Server id
   * @param id Event id
   * @param after Start after this user id (`next` of the page before)
   * @param limit Page size, 1 to 100
   */
  async fetchInterested(
    serverId: string,
    id: string,
    after?: string,
    limit = 50,
  ): Promise<ServerEventInterestedPage> {
    const page = await this.client.api.get(
      `/servers/${serverId as ""}/events/${id as ""}/interested`,
      after ? { after, limit } : { limit },
    );
    for (const user of page.users) {
      this.client.users.getOrCreate(user._id, user);
    }
    return page;
  }

  /**
   * Gateway: an event was made or changed
   * @param event Event
   * @returns The event as it was before, if known
   */
  upsert(event: ServerEvent): ServerEvent | undefined {
    // a copy: the stored object itself changes in place
    const known = this.get(event._id);
    const before = known ? { ...known } : undefined;
    this.#put(event);
    return before;
  }

  /**
   * Gateway: an event is gone (or no longer visible)
   * @param id Event id
   */
  remove(id: string): void {
    this.#set(
      produce((store) => {
        delete store[id];
      }),
    );
  }

  /**
   * Gateway: someone marked or unmarked an event
   * @param id Event id
   * @param userId Who
   * @param interested Marked or not
   * @param count New count
   */
  interest(id: string, userId: string, interested: boolean, count: number) {
    if (!this.#store[id]) return;
    this.#set(id, "event", "interested_count", count);
    if (userId === this.client.user?.id) {
      this.#set(id, "interested", interested);
    }
  }

  /**
   * Forget everything (log out)
   */
  clear(): void {
    this.#set(reconcile({}));
    this.#setLoaded(reconcile({}));
  }

  /**
   * Forget the events of a server (you left it, or it is gone)
   * @param serverId Server id
   */
  forgetServer(serverId: string): void {
    this.#set(
      produce((store) => {
        for (const [id, stored] of Object.entries(store)) {
          if (stored?.event.server === serverId) delete store[id];
        }
      }),
    );
    this.#setLoaded(serverId, false);
  }

  /**
   * After a new Ready the lists may have missed changes: load them again
   * when they are next shown
   */
  resetLoaded(): void {
    this.#setLoaded(reconcile({}));
  }

  #put(event: ServerEvent, interested?: boolean) {
    // reconcile keeps the same objects for what did not change, so lists
    // keyed by them keep their rows (and the focus in them)
    if (this.#store[event._id]) {
      this.#set(event._id, "event", reconcile(event));
      if (interested !== undefined)
        this.#set(event._id, "interested", interested);
    } else {
      this.#set(event._id, { event, interested: interested ?? false });
    }
  }
}

/**
 * Scheduled or happening now
 * @param event Event
 */
export function isUpcoming(event: ServerEvent): boolean {
  return event.status === "Scheduled" || event.status === "Active";
}

/**
 * Happening ones first, then by start time
 * @param a Event
 * @param b Event
 */
export function compareEvents(a: ServerEvent, b: ServerEvent): number {
  const active = Number(b.status === "Active") - Number(a.status === "Active");
  if (active !== 0) return active;
  return (
    Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
    a._id.localeCompare(b._id)
  );
}

/**
 * The channel of a channel place
 * @param place Place
 */
export function serverEventChannel(
  place: ServerEventPlace,
): string | undefined {
  return place.type === "External" ? undefined : place.channel;
}

/**
 * Whether an external place reads as a web address
 * @param place Place
 */
export function serverEventLink(place: ServerEventPlace): string | undefined {
  if (place.type !== "External") return undefined;
  const text = place.location.trim();
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
