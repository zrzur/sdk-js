import { createStore, produce, reconcile } from "solid-js/store";

import type {
  DataCreateServerEvent,
  DataEditServerEvent,
  MyServerEvents,
  ServerEvent,
  ServerEventAnswer,
  ServerEventAttendeesPage,
  ServerEventCounts,
  ServerEventInterestedPage,
  ServerEventPlace,
  ServerEventRsvp,
  ServerEventStats,
} from "../../api/types.js";
import type { Client } from "../Client.js";

/** What the collection keeps per event */
type Stored = {
  event: ServerEvent;
  /** Whether you take part (going or maybe) */
  interested: boolean;
  /** Your answer, if you gave one */
  rsvp?: ServerEventRsvp;
  /** Whether you may manage it (known once the event was fetched by itself) */
  organiser?: boolean;
};

/** Which answers a page of attendees holds */
export type ServerEventAttendeeFilter =
  | "Going"
  | "Waiting"
  | "Maybe"
  | "NotGoing";

/** A time and place to check for clashing events */
export type ServerEventClashQuery = {
  /** Start (ISO 8601) */
  starts_at: string;
  /** End (ISO 8601); without it the default length of an event */
  ends_at?: string;
  /** Only events in this channel */
  channel?: string;
  /** Only events at this outside place */
  location?: string;
  /** Leave this event out (the one being edited) */
  exclude?: string;
};

/** Which of your events across servers to load */
export type MyServerEventsQuery = {
  /** Events that start at or after this time (ISO 8601) */
  from?: string;
  /** Events that start before this time (ISO 8601) */
  to?: string;
  /** Only events you answered this way; `Any` for every answer */
  answer?: ServerEventAttendeeFilter | "Any";
  /** How many (1 to 200) */
  limit?: number;
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
   * Whether you take part in an event (you answered going or maybe)
   * @param id Event id
   */
  isInterested(id: string): boolean {
    return this.#store[id]?.interested ?? false;
  }

  /**
   * Your answer to an event, if you gave one. `waiting` says you are on
   * the waiting list, `position` where (1 is next).
   * @param id Event id
   */
  answerOf(id: string): ServerEventRsvp | undefined {
    return this.#store[id]?.rsvp;
  }

  /**
   * Whether you may manage an event; undefined until it was fetched by
   * itself (`fetch`) or you answered it
   * @param id Event id
   */
  isOrganiser(id: string): boolean | undefined {
    return this.#store[id]?.organiser;
  }

  /**
   * The drafts of a server that you manage (loaded by `fetchForServer`
   * with `drafts`), soonest first
   * @param serverId Server id
   */
  draftsForServer(serverId: string): ServerEvent[] {
    return Object.values(this.#store)
      .map((stored) => stored?.event)
      .filter(
        (event): event is ServerEvent =>
          !!event && event.server === serverId && event.status === "Draft",
      )
      .sort(compareEvents);
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
   * @param options `drafts`: also the drafts you manage
   */
  async fetchForServer(
    serverId: string,
    options?: { drafts?: boolean },
  ): Promise<ServerEvent[]> {
    const drafts = options?.drafts === true;
    const list = await this.client.api.get(
      `/servers/${serverId as ""}/events`,
      drafts ? { drafts: true } : {},
    );
    this.#set(
      produce((store) => {
        // drop what the server no longer lists
        for (const [id, stored] of Object.entries(store)) {
          if (
            stored?.event.server === serverId &&
            (isUpcoming(stored.event) ||
              (drafts && stored.event.status === "Draft"))
          ) {
            delete store[id];
          }
        }
        for (const event of list.events) {
          store[event._id] = {
            event,
            interested: list.interested.includes(event._id),
            rsvp: ownAnswer(list.answers, event._id),
          };
        }
      }),
    );
    this.#setLoaded(serverId, true);
    return this.forServer(serverId);
  }

  /**
   * Load every event of a server that starts in a time range, past and
   * cancelled ones too (for a calendar). They are kept like the others.
   * @param serverId Server id
   * @param from Start of the range (ISO 8601)
   * @param to End of the range (ISO 8601)
   */
  async fetchRange(
    serverId: string,
    from: string,
    to: string,
  ): Promise<ServerEvent[]> {
    const list = await this.client.api.get(
      `/servers/${serverId as ""}/events`,
      { from, to },
    );
    for (const event of list.events) {
      this.#put(event, {
        interested: list.interested.includes(event._id),
        rsvp: ownAnswer(list.answers, event._id) ?? null,
      });
    }
    return list.events;
  }

  /**
   * Load your events across all your servers (the ones you can see),
   * soonest first. They are kept like the others.
   * @param query Time range, answer and size
   */
  async fetchMine(query: MyServerEventsQuery = {}): Promise<MyServerEvents> {
    const mine = await this.client.api.get("/users/@me/events", query);
    for (const event of mine.events) {
      const rsvp = ownAnswer(mine.answers, event._id);
      this.#put(event, {
        interested: !!rsvp && rsvp.answer !== "NotGoing",
        rsvp: rsvp ?? null,
      });
    }
    return mine;
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
    this.#put(response.event, {
      interested: response.interested,
      rsvp: response.rsvp ?? null,
      organiser: response.organiser,
    });
    return response.event;
  }

  /**
   * Schedule an event (or, with `draft`, save a draft)
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
   * Delete an event for good. For a repeating event the server writes the
   * next occurrence, unless `series` is set: then the series ends here.
   * @param serverId Server id
   * @param id Event id
   * @param series Delete the whole series (nothing next is scheduled)
   */
  async delete(serverId: string, id: string, series = false): Promise<void> {
    await this.client.api.delete(
      `/servers/${serverId as ""}/events/${id as ""}`,
      series ? { series: true } : {},
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
    this.#put(response.event, {
      interested: response.interested,
      rsvp: response.rsvp ?? null,
      organiser: response.organiser,
    });
    return response.event;
  }

  /**
   * Answer an event: going, maybe or not going. A second answer replaces
   * the first. With a seat limit, "going" takes a seat or a place on the
   * waiting list (`answerOf` then says `waiting` and your `position`); the
   * request fails with `ServerEventFull` when there is neither.
   * @param serverId Server id
   * @param id Event id
   * @param answer Your answer
   */
  async setAnswer(
    serverId: string,
    id: string,
    answer: ServerEventAnswer,
  ): Promise<ServerEvent> {
    const response = await this.client.api.put(
      `/servers/${serverId as ""}/events/${id as ""}/rsvp`,
      { answer },
    );
    this.#put(response.event, {
      interested: response.interested,
      rsvp: response.rsvp ?? null,
      organiser: response.organiser,
    });
    return response.event;
  }

  /**
   * Take your answer back; a seat you held goes to the next waiting person
   * @param serverId Server id
   * @param id Event id
   */
  async withdraw(serverId: string, id: string): Promise<ServerEvent> {
    const response = await this.client.api.delete(
      `/servers/${serverId as ""}/events/${id as ""}/rsvp`,
    );
    this.#put(response.event, {
      interested: false,
      rsvp: null,
      organiser: response.organiser,
    });
    return response.event;
  }

  /**
   * A page of the people taking part; the users are added to the user
   * collection. Who may read it is the event's `attendee_list` setting.
   * @param serverId Server id
   * @param id Event id
   * @param options `answer` narrows the page (default: going, with the
   *   waiting list, and maybe; `NotGoing` is for organisers), `after` is
   *   `next` of the page before, `limit` 1 to 100
   */
  async fetchAttendees(
    serverId: string,
    id: string,
    options: {
      answer?: ServerEventAttendeeFilter;
      after?: string;
      limit?: number;
    } = {},
  ): Promise<ServerEventAttendeesPage> {
    const page = await this.client.api.get(
      `/servers/${serverId as ""}/events/${id as ""}/attendees`,
      options,
    );
    for (const attendee of page.attendees) {
      this.client.users.getOrCreate(attendee.user._id, attendee.user);
    }
    return page;
  }

  /**
   * Organisers: take a person's answer away (they can answer again)
   * @param serverId Server id
   * @param id Event id
   * @param userId Who
   */
  async removeAttendee(
    serverId: string,
    id: string,
    userId: string,
  ): Promise<void> {
    await this.client.api.delete(
      `/servers/${serverId as ""}/events/${id as ""}/attendees/${userId as ""}`,
    );
  }

  /**
   * Organisers: give a person on the waiting list a seat now, also beyond
   * the seat limit
   * @param serverId Server id
   * @param id Event id
   * @param userId Who
   */
  async seatAttendee(
    serverId: string,
    id: string,
    userId: string,
  ): Promise<ServerEvent> {
    const event = await this.client.api.post(
      `/servers/${serverId as ""}/events/${id as ""}/attendees/${userId as ""}/seat`,
    );
    this.#put(event);
    return event;
  }

  /**
   * Organisers: schedule a draft
   * @param serverId Server id
   * @param id Event id
   */
  async publish(serverId: string, id: string): Promise<ServerEvent> {
    const event = await this.client.api.post(
      `/servers/${serverId as ""}/events/${id as ""}/publish`,
    );
    this.#put(event, { organiser: true });
    return event;
  }

  /**
   * Make a draft with the same settings as an event (nobody's answer is
   * copied). Needs Manage Events.
   * @param serverId Server id
   * @param id Event id
   */
  async copy(serverId: string, id: string): Promise<ServerEvent> {
    const event = await this.client.api.post(
      `/servers/${serverId as ""}/events/${id as ""}/copy`,
    );
    this.#put(event, { organiser: true });
    return event;
  }

  /**
   * Events of a server that overlap a time (and a place): a warning for
   * the editor, nothing is blocked
   * @param serverId Server id
   * @param query Time, place and the event to leave out
   */
  async fetchClashes(
    serverId: string,
    query: ServerEventClashQuery,
  ): Promise<ServerEvent[]> {
    const clashes = await this.client.api.get(
      `/servers/${serverId as ""}/events/clashes`,
      query,
    );
    return clashes.events;
  }

  /**
   * Organisers: the numbers of an event
   * @param serverId Server id
   * @param id Event id
   */
  async fetchStats(serverId: string, id: string): Promise<ServerEventStats> {
    return await this.client.api.get(
      `/servers/${serverId as ""}/events/${id as ""}/stats`,
    );
  }

  /**
   * A page of the members who take part in an event (the older form of
   * `fetchAttendees`); the users are added to the user collection
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
   * Gateway: the number of people taking part changed (the older event;
   * it names a person only on the copy sent to that person)
   * @param id Event id
   * @param userId Who, or empty
   * @param interested Whether they take part
   * @param count New count
   */
  interest(id: string, userId: string, interested: boolean, count: number) {
    if (!this.#store[id]) return;
    this.#set(id, "event", "interested_count", count);
    if (userId && userId === this.client.user?.id) {
      this.#set(id, "interested", interested);
    }
  }

  /**
   * Gateway: the answer counts of an event changed
   * @param id Event id
   * @param counts New counts
   */
  counts(id: string, counts: ServerEventCounts) {
    if (!this.#store[id]) return;
    this.#set(id, "event", "counts", { ...counts });
    this.#set(id, "event", "interested_count", counts.going + counts.maybe);
  }

  /**
   * Gateway: your own answer changed (on another device, a seat became
   * yours, or an organiser removed you)
   * @param id Event id
   * @param rsvp Your answer now, if any
   */
  ownAnswer(id: string, rsvp: ServerEventRsvp | undefined) {
    if (!this.#store[id]) return;
    this.#set(id, "rsvp", rsvp ? { ...rsvp } : undefined);
    this.#set(id, "interested", !!rsvp && rsvp.answer !== "NotGoing");
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

  /**
   * Keep an event, and what is known about you and it (`rsvp: null` means
   * you have no answer; left out, what was known stays)
   */
  #put(
    event: ServerEvent,
    mine: {
      interested?: boolean;
      rsvp?: ServerEventRsvp | null;
      organiser?: boolean;
    } = {},
  ) {
    // reconcile keeps the same objects for what did not change, so lists
    // keyed by them keep their rows (and the focus in them)
    if (this.#store[event._id]) {
      this.#set(event._id, "event", reconcile(event));
      if (mine.interested !== undefined)
        this.#set(event._id, "interested", mine.interested);
      if (mine.rsvp !== undefined)
        this.#set(event._id, "rsvp", mine.rsvp ?? undefined);
      if (mine.organiser !== undefined)
        this.#set(event._id, "organiser", mine.organiser);
    } else {
      this.#set(event._id, {
        event,
        interested: mine.interested ?? false,
        rsvp: mine.rsvp ?? undefined,
        organiser: mine.organiser,
      });
    }
  }
}

/** Your answer to one event out of a list's answers */
function ownAnswer(
  answers:
    | { event: string; answer: ServerEventAnswer; waiting?: boolean }[]
    | undefined,
  id: string,
): ServerEventRsvp | undefined {
  const own = answers?.find((answer) => answer.event === id);
  return own
    ? { answer: own.answer, waiting: own.waiting ?? false }
    : undefined;
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
