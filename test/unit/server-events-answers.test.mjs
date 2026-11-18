// Events, Beta 5: answers (going, maybe, not going), seats and the waiting
// list, drafts, the organiser routes and the list across servers. The
// collection keeps your answer beside each event and follows the two new
// gateway events; the older "Interested" calls keep working.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_PERMISSION_SERVER, Permission } from "../../lib/index.js";
import { ERROR_CODES } from "../../lib/api/error-codes.js";
import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const SV = ID("SV");

const counts = (going = 0, maybe = 0, not_going = 0, waiting = 0) => ({
  going,
  maybe,
  not_going,
  waiting,
});

const event = (id, extra = {}) => ({
  _id: id,
  server: SV,
  creator: OTHER,
  title: `Event ${id}`,
  starts_at: "2026-12-01T18:00:00Z",
  place: { type: "External", location: "Park" },
  status: "Scheduled",
  interested_count: 0,
  counts: counts(),
  waitlist: true,
  visibility: "Place",
  attendee_list: "Everyone",
  ...extra,
});

/** A signed-in client whose requests are answered by `answer(method, path, body)` */
async function readyClient(answer) {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    requests.push({ line: `${method} ${pathname}${search}`, body });
    const data = answer(method, `${pathname}${search}`, body);
    return new Response(data === undefined ? null : JSON.stringify(data), {
      status: data === undefined ? 204 : 200,
    });
  };
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
    servers: [{ _id: SV, owner: OTHER, name: "S", channels: [], default_permissions: 0 }],
    channels: [],
    members: [],
    emojis: [],
  });
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

test("a list brings your answers with it", async () => {
  const { client, requests, restore } = await readyClient(() => ({
    events: [event(ID("E1")), event(ID("E2")), event(ID("E3")), event(ID("D1"), { status: "Draft" })],
    interested: [ID("E1")],
    answers: [
      { event: ID("E1"), answer: "Going", waiting: true },
      { event: ID("E2"), answer: "NotGoing" },
    ],
  }));
  try {
    const list = await client.serverEvents.fetchForServer(SV, { drafts: true });
    assert.equal(requests[0].line, `GET /servers/${SV}/events?drafts=true`);
    // a draft is not among the upcoming events, it has its own list
    assert.deepEqual(list.map((e) => e._id), [ID("E1"), ID("E2"), ID("E3")]);
    assert.deepEqual(client.serverEvents.draftsForServer(SV).map((e) => e._id), [ID("D1")]);
    assert.deepEqual(client.serverEvents.answerOf(ID("E1")), { answer: "Going", waiting: true });
    assert.equal(client.serverEvents.isInterested(ID("E1")), true);
    assert.deepEqual(client.serverEvents.answerOf(ID("E2")), { answer: "NotGoing", waiting: false });
    assert.equal(client.serverEvents.isInterested(ID("E2")), false);
    assert.equal(client.serverEvents.answerOf(ID("E3")), undefined);

    // without `drafts` the plain list is asked for, as before
    await client.serverEvents.fetchForServer(SV);
    assert.equal(requests[1].line, `GET /servers/${SV}/events`);
  } finally {
    restore();
  }
});

test("answering uses PUT and withdrawing DELETE on the rsvp route", async () => {
  const { client, requests, restore } = await readyClient((method) =>
    method === "PUT"
      ? {
          event: event(ID("E1"), { capacity: 1, counts: counts(1, 0, 0, 1), interested_count: 1 }),
          interested: true,
          rsvp: { answer: "Going", waiting: true, position: 1 },
          organiser: false,
        }
      : { event: event(ID("E1"), { capacity: 1, counts: counts(1) }), interested: false, organiser: false },
  );
  try {
    const answered = await client.serverEvents.setAnswer(SV, ID("E1"), "Going");
    assert.equal(requests[0].line, `PUT /servers/${SV}/events/${ID("E1")}/rsvp`);
    assert.deepEqual(requests[0].body, { answer: "Going" });
    assert.equal(answered.counts.waiting, 1);
    assert.deepEqual(client.serverEvents.answerOf(ID("E1")), {
      answer: "Going",
      waiting: true,
      position: 1,
    });
    assert.equal(client.serverEvents.isInterested(ID("E1")), true);
    assert.equal(client.serverEvents.isOrganiser(ID("E1")), false);

    await client.serverEvents.withdraw(SV, ID("E1"));
    assert.equal(requests[1].line, `DELETE /servers/${SV}/events/${ID("E1")}/rsvp`);
    assert.equal(client.serverEvents.answerOf(ID("E1")), undefined);
    assert.equal(client.serverEvents.isInterested(ID("E1")), false);
  } finally {
    restore();
  }
});

test("the gateway moves the counts and your own answer, and names nobody", async () => {
  const { client, restore } = await readyClient(() => ({ events: [], interested: [], answers: [] }));
  try {
    await client.events.emit("event", { type: "ServerEventCreate", ...event(ID("E1"), { capacity: 1 }) });

    // someone answers: counts only
    await client.events.emit("event", {
      type: "ServerEventCounts",
      id: ID("E1"),
      server: SV,
      counts: counts(1, 2, 3, 4),
    });
    const stored = client.serverEvents.get(ID("E1"));
    assert.deepEqual({ ...stored.counts }, counts(1, 2, 3, 4));
    assert.equal(stored.interested_count, 3, "going plus maybe");
    assert.equal(client.serverEvents.answerOf(ID("E1")), undefined);

    // the older event comes without a name: your own mark does not move
    await client.events.emit("event", {
      type: "ServerEventInterest",
      id: ID("E1"),
      server: SV,
      user: "",
      interested: true,
      count: 3,
    });
    assert.equal(client.serverEvents.isInterested(ID("E1")), false);

    // you answered on another device, and wait for a seat
    await client.events.emit("event", {
      type: "ServerEventRsvpUpdate",
      id: ID("E1"),
      server: SV,
      rsvp: { answer: "Going", waiting: true, position: 2 },
    });
    assert.equal(client.serverEvents.answerOf(ID("E1")).position, 2);
    assert.equal(client.serverEvents.isInterested(ID("E1")), true);
    // a seat became yours
    await client.events.emit("event", {
      type: "ServerEventRsvpUpdate",
      id: ID("E1"),
      server: SV,
      rsvp: { answer: "Going", waiting: false },
    });
    assert.equal(client.serverEvents.answerOf(ID("E1")).waiting, false);

    // it starts: someone going hears about it
    const started = [];
    client.on("serverEventStarted", (e) => started.push(e._id));
    await client.events.emit("event", {
      type: "ServerEventUpdate",
      event: event(ID("E1"), { status: "Active" }),
    });
    assert.deepEqual(started, [ID("E1")]);
    assert.equal(client.serverEvents.answerOf(ID("E1")).answer, "Going", "the answer stays");

    // an organiser removed you
    await client.events.emit("event", { type: "ServerEventRsvpUpdate", id: ID("E1"), server: SV });
    assert.equal(client.serverEvents.answerOf(ID("E1")), undefined);
    assert.equal(client.serverEvents.isInterested(ID("E1")), false);

    // events about something you do not know are ignored
    await client.events.emit("event", {
      type: "ServerEventCounts",
      id: ID("ZZ"),
      server: SV,
      counts: counts(9),
    });
    await client.events.emit("event", { type: "ServerEventRsvpUpdate", id: ID("ZZ"), server: SV });
    assert.equal(client.serverEvents.get(ID("ZZ")), undefined);
  } finally {
    restore();
  }
});

test("organiser calls go to their routes", async () => {
  const { client, requests, restore } = await readyClient((method, path) => {
    if (path.includes("/attendees?") || path.endsWith("/attendees")) {
      return {
        attendees: [
          {
            user: { _id: OTHER, username: "other", discriminator: "0002" },
            answer: "Going",
            waiting: true,
            since: "2026-11-18T10:00:00Z",
          },
        ],
        next: OTHER,
      };
    }
    if (path.includes("/clashes")) return { events: [event(ID("E2"))] };
    if (path.endsWith("/stats")) {
      return { counts: counts(1), registrations: [{ day: "2026-11-18", going: 1, maybe: 0, not_going: 0 }] };
    }
    if (method === "DELETE") return undefined;
    if (path.endsWith("/copy")) return event(ID("D2"), { status: "Draft" });
    return event(ID("E1"));
  });
  try {
    const page = await client.serverEvents.fetchAttendees(SV, ID("E1"), { answer: "Waiting", limit: 10 });
    assert.equal(requests[0].line, `GET /servers/${SV}/events/${ID("E1")}/attendees?answer=Waiting&limit=10`);
    assert.equal(page.next, OTHER);
    assert.equal(client.users.get(OTHER)?.username, "other");

    await client.serverEvents.removeAttendee(SV, ID("E1"), OTHER);
    assert.equal(requests[1].line, `DELETE /servers/${SV}/events/${ID("E1")}/attendees/${OTHER}`);
    await client.serverEvents.seatAttendee(SV, ID("E1"), OTHER);
    assert.equal(requests[2].line, `POST /servers/${SV}/events/${ID("E1")}/attendees/${OTHER}/seat`);

    await client.serverEvents.publish(SV, ID("E1"));
    assert.equal(requests[3].line, `POST /servers/${SV}/events/${ID("E1")}/publish`);
    assert.equal(client.serverEvents.isOrganiser(ID("E1")), true);
    const copy = await client.serverEvents.copy(SV, ID("E1"));
    assert.equal(requests[4].line, `POST /servers/${SV}/events/${ID("E1")}/copy`);
    assert.equal(copy.status, "Draft");
    assert.deepEqual(client.serverEvents.draftsForServer(SV).map((e) => e._id), [ID("D2")]);

    const clashes = await client.serverEvents.fetchClashes(SV, {
      starts_at: "2026-12-01T18:00:00Z",
      exclude: ID("E1"),
    });
    assert.equal(
      requests[5].line,
      `GET /servers/${SV}/events/clashes?starts_at=2026-12-01T18%3A00%3A00Z&exclude=${ID("E1")}`,
    );
    assert.deepEqual(clashes.map((e) => e._id), [ID("E2")]);

    const stats = await client.serverEvents.fetchStats(SV, ID("E1"));
    assert.equal(requests[6].line, `GET /servers/${SV}/events/${ID("E1")}/stats`);
    assert.equal(stats.registrations[0].going, 1);
  } finally {
    restore();
  }
});

test("my events across servers and a time range are kept like the others", async () => {
  const { client, requests, restore } = await readyClient((_, path) =>
    path.startsWith("/users/@me/events")
      ? {
          events: [event(ID("E1")), event(ID("E2"))],
          answers: [{ event: ID("E2"), answer: "Maybe" }],
        }
      : {
          events: [event(ID("E9"), { status: "Completed" })],
          interested: [],
          answers: [{ event: ID("E9"), answer: "Going" }],
        },
  );
  try {
    const mine = await client.serverEvents.fetchMine({ answer: "Any", limit: 50 });
    assert.equal(requests[0].line, "GET /users/@me/events?answer=Any&limit=50");
    assert.equal(mine.events.length, 2);
    assert.equal(client.serverEvents.answerOf(ID("E2")).answer, "Maybe");
    assert.equal(client.serverEvents.isInterested(ID("E2")), true);
    assert.equal(client.serverEvents.answerOf(ID("E1")), undefined);

    const month = await client.serverEvents.fetchRange(SV, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
    assert.equal(
      requests[1].line,
      `GET /servers/${SV}/events?from=2026-11-01T00%3A00%3A00Z&to=2026-12-01T00%3A00%3A00Z`,
    );
    assert.equal(month[0].status, "Completed");
    assert.equal(client.serverEvents.get(ID("E9")).status, "Completed");
    assert.equal(client.serverEvents.answerOf(ID("E9")).answer, "Going");
    // a past event is not among the upcoming ones
    assert.equal(client.serverEvents.forServer(SV).some((e) => e._id === ID("E9")), false);
  } finally {
    restore();
  }
});

test("Manage Events is bit 49, never a default, and the new error codes are known", () => {
  assert.equal(Permission.ManageEvents, 2n ** 49n);
  assert.equal(DEFAULT_PERMISSION_SERVER & Permission.ManageEvents, 0n);
  assert.equal(Permission.GrantAllSafe & Permission.ManageEvents, Permission.ManageEvents);
  for (const code of ["ServerEventInvalid", "ServerEventFull", "TooManyServerEventDrafts"]) {
    assert.ok(ERROR_CODES.includes(code), code);
  }
});
