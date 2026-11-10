// Server insights: one GET with the range and the viewer's time zone, the
// answer passed through as the API sends it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const SV = ID("SV");

const page = {
  days: 7,
  time_zone: "Europe/Vienna",
  rows: [
    // small numbers come as null ("fewer than 5")
    { day: "2026-11-10", joins: 1, leaves: 0, members: 9, messages: 6, active_members: null, voice_minutes: null },
  ],
  totals: { joins: 1, leaves: 0, messages: 6, voice_minutes: null, active_members: null },
  counted_since: "2026-11-03",
  join_sources: { invite: 1, discover: 0, vanity: 0, other: 2 },
  top_channels: [{ channel: ID("C1"), messages: null }],
};

async function readyClient() {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    requests.push(`${init?.method ?? "GET"} ${parsed.pathname}${parsed.search}`);
    if (parsed.pathname.endsWith(`/servers/${SV}/insights`)) {
      return new Response(JSON.stringify(page), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", {
    type: "Ready",
    users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
    servers: [{ _id: SV, owner: ME, name: "S", channels: [], default_permissions: 0 }],
    channels: [],
    members: [],
    emojis: [],
  });
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

test("insights are one request with the range and time zone", async () => {
  const { client, requests, restore } = await readyClient();
  try {
    const result = await client.servers
      .get(SV)
      .fetchInsights({ days: 7, timeZone: "Europe/Vienna", utcOffset: 60 });
    assert.deepEqual(result, page);
    const calls = requests.filter((r) => r.includes("/insights"));
    assert.equal(calls.length, 1);
    const [method, path] = calls[0].split(" ");
    assert.equal(method, "GET");
    const url = new URL(path, "http://x");
    assert.equal(url.pathname, `/servers/${SV}/insights`);
    assert.equal(url.searchParams.get("days"), "7");
    assert.equal(url.searchParams.get("time_zone"), "Europe/Vienna");
    assert.equal(url.searchParams.get("utc_offset"), "60");
  } finally {
    restore();
  }
});

test("without options the server picks its default range", async () => {
  const { client, requests, restore } = await readyClient();
  try {
    await client.servers.get(SV).fetchInsights();
    const call = requests.find((r) => r.includes("/insights"));
    const url = new URL(call.split(" ")[1], "http://x");
    assert.equal(url.searchParams.has("days"), false);
    assert.equal(url.searchParams.has("time_zone"), false);
  } finally {
    restore();
  }
});
