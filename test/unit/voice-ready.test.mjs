// Voice rooms after a reconnect: Ready carries every live room, so a room that
// emptied while the gateway was down must not keep its old participants.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const V1 = ID("V1");
const V2 = ID("V2");

const base = {
  type: "Ready",
  users: [
    { _id: ME, username: "me", discriminator: "0001", relationship: "User" },
    { _id: OTHER, username: "other", discriminator: "0002", relationship: "None" },
  ],
  servers: [{ _id: ID("SV"), owner: ME, name: "S", channels: [V1, V2], default_permissions: 0 }],
  channels: [
    { channel_type: "TextChannel", _id: V1, server: ID("SV"), name: "voice-1", voice: {} },
    { channel_type: "TextChannel", _id: V2, server: ID("SV"), name: "voice-2", voice: {} },
  ],
  members: [],
  emojis: [],
};

const participant = (id) => ({
  id,
  joined_at: "2026-11-09T22:00:00.000Z",
  is_receiving: true,
  is_publishing: true,
  screensharing: false,
  camera: false,
});

function client() {
  return new Client({ baseURL: "http://localhost:1", syncUnreads: false, autoReconnect: false });
}

test("Ready fills voice rooms from voice_states", async () => {
  const c = client();
  await c.events.emit("event", { ...base, voice_states: [{ id: V1, participants: [participant(OTHER)] }] });
  assert.equal(c.channels.get(V1).voiceParticipants.size, 1);
  assert.equal(c.channels.get(V2).voiceParticipants.size, 0);
});

test("a room missing from a later Ready is emptied (it emptied during the drop)", async () => {
  const c = client();
  await c.events.emit("event", { ...base, voice_states: [{ id: V1, participants: [participant(OTHER)] }] });
  assert.equal(c.channels.get(V1).voiceParticipants.size, 1);
  await c.events.emit("event", { ...base, voice_states: [{ id: V2, participants: [participant(ME)] }] });
  assert.equal(c.channels.get(V1).voiceParticipants.size, 0, "stale room kept its participant");
  assert.equal(c.channels.get(V2).voiceParticipants.size, 1);
});

test("a Ready without voice_states leaves rooms as they are", async () => {
  const c = client();
  await c.events.emit("event", { ...base, voice_states: [{ id: V1, participants: [participant(OTHER)] }] });
  const { voice_states: _omit, ...noVoice } = { ...base };
  await c.events.emit("event", noVoice);
  assert.equal(c.channels.get(V1).voiceParticipants.size, 1);
});
