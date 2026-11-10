// Scheduled server events: the collection loads a server's list, follows the
// gateway (create, update, delete, interest counts) and tells the app when an
// event you marked starts.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Client,
  compareEvents,
  serverEventChannel,
  serverEventLink,
} from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const SV = ID("SV");
const VOICE = ID("VC");

const event = (id, extra = {}) => ({
  _id: id,
  server: SV,
  creator: OTHER,
  title: `Event ${id}`,
  starts_at: "2026-12-01T18:00:00Z",
  place: { type: "Voice", channel: VOICE },
  status: "Scheduled",
  interested_count: 0,
  ...extra,
});

async function readyClient(listing) {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${new URL(url).pathname}${new URL(url).search}`);
    if (String(url).endsWith(`/servers/${SV}/events`)) {
      return new Response(JSON.stringify(listing), { status: 200 });
    }
    if (String(url).includes("/interested")) {
      return new Response(
        JSON.stringify({ event: event(ID("E1"), { interested_count: 1 }), interested: true }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  };
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
    servers: [{ _id: SV, owner: OTHER, name: "S", channels: [VOICE], default_permissions: 0 }],
    channels: [],
    members: [],
    emojis: [],
  });
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

test("a server's events load with your marks, happening ones first", async () => {
  const later = event(ID("E2"), { starts_at: "2026-12-05T18:00:00Z" });
  const soon = event(ID("E1"));
  const now = event(ID("E3"), { starts_at: "2026-12-09T18:00:00Z", status: "Active" });
  const { client, restore } = await readyClient({
    events: [soon, later, now],
    interested: [ID("E2")],
  });
  try {
    assert.equal(client.serverEvents.isLoaded(SV), false);
    const list = await client.serverEvents.fetchForServer(SV);
    assert.deepEqual(
      list.map((e) => e._id),
      [ID("E3"), ID("E1"), ID("E2")],
    );
    assert.equal(client.serverEvents.isLoaded(SV), true);
    assert.equal(client.serverEvents.isInterested(ID("E2")), true);
    assert.equal(client.serverEvents.isInterested(ID("E1")), false);
  } finally {
    restore();
  }
});

test("gateway events keep the list current", async () => {
  const { client, restore } = await readyClient({ events: [], interested: [] });
  try {
    await client.serverEvents.fetchForServer(SV);
    await client.events.emit("event", { type: "ServerEventCreate", ...event(ID("E1")) });
    assert.equal(client.serverEvents.forServer(SV).length, 1);
    assert.equal(client.serverEvents.get(ID("E1")).title, `Event ${ID("E1")}`);

    // someone else marks it: the count moves, your mark does not
    await client.events.emit("event", {
      type: "ServerEventInterest",
      id: ID("E1"),
      server: SV,
      user: OTHER,
      interested: true,
      count: 1,
    });
    assert.equal(client.serverEvents.get(ID("E1")).interested_count, 1);
    assert.equal(client.serverEvents.isInterested(ID("E1")), false);

    // you mark it on another device
    await client.events.emit("event", {
      type: "ServerEventInterest",
      id: ID("E1"),
      server: SV,
      user: ME,
      interested: true,
      count: 2,
    });
    assert.equal(client.serverEvents.isInterested(ID("E1")), true);

    // it starts: you hear about it once
    const started = [];
    client.on("serverEventStarted", (e) => started.push(e._id));
    const active = event(ID("E1"), { status: "Active", interested_count: 2 });
    await client.events.emit("event", { type: "ServerEventUpdate", event: active });
    await client.events.emit("event", { type: "ServerEventUpdate", event: active });
    assert.deepEqual(started, [ID("E1")]);
    assert.equal(client.serverEvents.isInterested(ID("E1")), true, "the mark stays");

    // cancelled: no longer upcoming; deleted: gone
    await client.events.emit("event", {
      type: "ServerEventUpdate",
      event: event(ID("E1"), { status: "Cancelled" }),
    });
    assert.equal(client.serverEvents.forServer(SV).length, 0);
    assert.equal(client.serverEvents.get(ID("E1")).status, "Cancelled");
    await client.events.emit("event", { type: "ServerEventDelete", id: ID("E1"), server: SV });
    assert.equal(client.serverEvents.get(ID("E1")), undefined);
  } finally {
    restore();
  }
});

test("marking uses PUT and unmarking DELETE on the interested route", async () => {
  const { client, requests, restore } = await readyClient({ events: [], interested: [] });
  try {
    const marked = await client.serverEvents.setInterested(SV, ID("E1"), true);
    assert.equal(marked.interested_count, 1);
    assert.equal(client.serverEvents.isInterested(ID("E1")), true);
    await client.serverEvents.setInterested(SV, ID("E1"), false);
    assert.ok(requests.includes(`PUT /servers/${SV}/events/${ID("E1")}/interested`));
    assert.ok(requests.includes(`DELETE /servers/${SV}/events/${ID("E1")}/interested`));
  } finally {
    restore();
  }
});

test("helpers: place channel, safe links only, order", () => {
  assert.equal(serverEventChannel({ type: "Text", channel: "c" }), "c");
  assert.equal(serverEventChannel({ type: "External", location: "Park" }), undefined);
  assert.equal(
    serverEventLink({ type: "External", location: " https://example.org/meet " }),
    "https://example.org/meet",
  );
  assert.equal(serverEventLink({ type: "External", location: "javascript:alert(1)" }), undefined);
  assert.equal(serverEventLink({ type: "External", location: "Main square 1" }), undefined);
  assert.equal(serverEventLink({ type: "Voice", channel: "c" }), undefined);
  const a = event("a", { starts_at: "2026-12-01T10:00:00Z" });
  const b = event("b", { starts_at: "2026-12-01T09:00:00Z" });
  assert.deepEqual([a, b].sort(compareEvents).map((e) => e._id), ["b", "a"]);
});

test("an update keeps the same event object, so list rows and focus stay", async () => {
  const { client, restore } = await readyClient({ events: [event(ID("E1"))], interested: [] });
  try {
    await client.serverEvents.fetchForServer(SV);
    const before = client.serverEvents.get(ID("E1"));
    await client.events.emit("event", {
      type: "ServerEventUpdate",
      event: event(ID("E1"), { interested_count: 3, title: "Renamed" }),
    });
    const after = client.serverEvents.get(ID("E1"));
    assert.equal(after, before, "same object");
    assert.equal(after.title, "Renamed");
    assert.equal(client.serverEvents.forServer(SV)[0], before);
  } finally {
    restore();
  }
});

test("cancelling the whole series asks for it; one occurrence does not", async () => {
  const { client, requests, restore } = await readyClient({ events: [], interested: [] });
  try {
    await client.serverEvents.cancel(SV, ID("E1"), true).catch(() => undefined);
    await client.serverEvents.cancel(SV, ID("E2")).catch(() => undefined);
    assert.ok(requests.some((r) => r.startsWith(`POST /servers/${SV}/events/${ID("E1")}/cancel`)));
    assert.ok(requests.includes(`POST /servers/${SV}/events/${ID("E1")}/cancel?series=true`), requests.join(", "));
    assert.ok(requests.includes(`POST /servers/${SV}/events/${ID("E2")}/cancel`), requests.join(", "));
  } finally {
    restore();
  }
});

test("leaving a server forgets its events; a new Ready loads them again", async () => {
  const { client, restore } = await readyClient({ events: [event(ID("E1"))], interested: [] });
  try {
    await client.serverEvents.fetchForServer(SV);
    assert.equal(client.serverEvents.isLoaded(SV), true);
    await client.events.emit("event", { type: "Ready", users: [], servers: [], channels: [], members: [], emojis: [] });
    assert.equal(client.serverEvents.isLoaded(SV), false, "reloaded after a reconnect");
    await client.serverEvents.fetchForServer(SV);
    await client.events.emit("event", { type: "ServerMemberLeave", id: SV, user: ME });
    assert.equal(client.serverEvents.get(ID("E1")), undefined);
    assert.equal(client.serverEvents.isLoaded(SV), false);
  } finally {
    restore();
  }
});
