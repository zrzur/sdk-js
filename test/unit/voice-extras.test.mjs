// Stage channels, soundboard and stream previews in the solid client.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_PERMISSION_SERVER, Permission } from "../../lib/index.js";
import { Client } from "../../lib/solid/index.js";
import {
  EMPTY_STAGE,
  applyStageChange,
  fetchSoundboard,
  fetchStreamPreview,
  raiseHand,
} from "../../lib/solid/voiceExtras.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const SERVER = ID("SV");
const STAGE = ID("ST");
const VOICE = ID("VC");

const ready = {
  type: "Ready",
  users: [
    { _id: ME, username: "me", discriminator: "0001", relationship: "User" },
    { _id: OTHER, username: "other", discriminator: "0002", relationship: "None" },
  ],
  servers: [{ _id: SERVER, owner: ME, name: "S", channels: [STAGE, VOICE], default_permissions: 0 }],
  channels: [
    { channel_type: "TextChannel", _id: STAGE, server: SERVER, name: "talks", voice: { stage: true } },
    { channel_type: "TextChannel", _id: VOICE, server: SERVER, name: "voice", voice: {} },
  ],
  members: [],
  emojis: [],
};

async function client() {
  const c = new Client({ baseURL: "http://localhost:1", syncUnreads: false, autoReconnect: false });
  await c.events.emit("event", ready);
  return c;
}

test("a stage channel says so; a plain voice channel does not", async () => {
  const c = await client();
  assert.equal(c.channels.get(STAGE).isStage, true);
  assert.equal(c.channels.get(VOICE).isStage, false);
  assert.equal(c.channels.get(VOICE).isVoiceRoom, true);
});

test("stage and soundboard events are handed to the app as they are", async () => {
  const c = await client();
  const seen = [];
  c.on("voiceEvent", (event) => seen.push(event.type));
  for (const event of [
    { type: "StageUpdate", id: STAGE, data: { hands_raised: [OTHER] } },
    { type: "SoundboardPlay", channel_id: VOICE, sound_id: ID("S1"), user: OTHER },
    { type: "SoundboardSoundDelete", id: ID("S1"), server: SERVER },
  ])
    await c.events.emit("event", event);
  assert.deepEqual(seen, ["StageUpdate", "SoundboardPlay", "SoundboardSoundDelete"]);
});

test("a stage change applies only what it says", () => {
  let state = { topic: "Q&A", speakers: [ME], hands: [OTHER, ID("CC")] };
  state = applyStageChange(state, { speakers_added: [OTHER] });
  assert.deepEqual(state, { topic: "Q&A", speakers: [ME, OTHER], hands: [ID("CC")] });
  state = applyStageChange(state, { speakers_removed: [ME], hands_lowered: [ID("CC")] });
  assert.deepEqual(state, { topic: "Q&A", speakers: [OTHER], hands: [] });
  state = applyStageChange(state, { topic: "" });
  assert.equal(state.topic, undefined);
  state = applyStageChange(state, { hands_raised: [ME, ME] });
  assert.deepEqual(state.hands, [ME]);
  assert.equal(applyStageChange(state, { ended: true }), EMPTY_STAGE);
});

test("requests answer with the state in the SDK's shape", async () => {
  const c = await client();
  c.api.put = async (path) => {
    assert.equal(path, `/channels/${STAGE}/stage/hand`);
    return { topic: null, speakers: [], hands: [ME] };
  };
  assert.deepEqual(await raiseHand(c, c.channels.get(STAGE)), {
    topic: undefined,
    speakers: [],
    hands: [ME],
  });
  c.api.get = async (path) => {
    assert.equal(path, `/servers/${SERVER}/soundboard`);
    return { sounds: [], limit: 8 };
  };
  assert.deepEqual(await fetchSoundboard(c, c.servers.get(SERVER)), { sounds: [], limit: 8 });
});

test("the voice requests are not in the solid entry (apps load them lazily)", async () => {
  const solid = await import("../../lib/solid/index.js");
  assert.equal(solid.fetchSoundboard, undefined);
  assert.equal(solid.raiseHand, undefined);
  assert.equal(solid.applyStageChange, undefined);
});

test("a stream preview comes back as a data URL, a missing one as nothing", async () => {
  const c = await client();
  const voice = c.channels.get(VOICE);
  c.api.get = async () => ({ image: "/9j/4AAQ", content_type: "image/jpeg" });
  assert.equal(await fetchStreamPreview(c, voice, OTHER), "data:image/jpeg;base64,/9j/4AAQ");
  c.api.get = async () => {
    throw new Error("NotFound");
  };
  assert.equal(await fetchStreamPreview(c, voice, OTHER), undefined);
});

test("new servers may use the soundboard; managing it is never a default", () => {
  assert.equal(Permission.UseSoundboard, 2n ** 47n);
  assert.equal(Permission.ManageSoundboard, 2n ** 48n);
  assert.equal(DEFAULT_PERMISSION_SERVER & Permission.UseSoundboard, Permission.UseSoundboard);
  assert.equal(DEFAULT_PERMISSION_SERVER & Permission.ManageSoundboard, 0n);
});
