// DM and group call ringing: the gateway's call events reach the app.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const DM = ID("DM");

async function client() {
  const c = new Client({ baseURL: "http://127.0.0.1:1" });
  await c.events.emit("event", {
    type: "Ready",
    users: [
      { _id: ME, username: "me", discriminator: "0001", relationship: "User" },
      { _id: OTHER, username: "other", discriminator: "0002", relationship: "Friend" },
    ],
    servers: [],
    channels: [{ _id: DM, channel_type: "DirectMessage", active: true, recipients: [ME, OTHER] }],
    members: [],
    emojis: [],
  });
  return c;
}

test("ringing starts and ends reach the app as voice events", async () => {
  const c = await client();
  const seen = [];
  c.on("voiceEvent", (event) => seen.push([event.type, event.reason ?? event.ended]));
  for (const event of [
    { type: "VoiceCallUpdate", initiator_id: OTHER, channel_id: DM, started_at: "2026-11-15T10:00:00Z", ended: false },
    { type: "VoiceRingEnd", channel_id: DM, user: ME, reason: "Declined" },
    { type: "VoiceCallUpdate", initiator_id: OTHER, channel_id: DM, started_at: null, ended: true },
  ])
    await c.events.emit("event", event);
  assert.deepEqual(seen, [
    ["VoiceCallUpdate", false],
    ["VoiceRingEnd", "Declined"],
    ["VoiceCallUpdate", true],
  ]);
});

test("a call message knows when it was missed", async () => {
  const { SystemMessage } = await import("../../lib/solid/classes/SystemMessage.js");
  const c = await client();
  const missed = SystemMessage.from(c, { _id: ID("M1") }, {
    type: "call_started",
    by: OTHER,
    finished_at: "2026-11-15T10:00:45Z",
    missed: true,
  });
  const answered = SystemMessage.from(c, { _id: ID("M2") }, {
    type: "call_started",
    by: OTHER,
    finished_at: "2026-11-15T10:05:00Z",
  });
  assert.equal(missed.missed, true);
  assert.equal(answered.missed, false);
});
