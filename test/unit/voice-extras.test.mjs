// Stage channels, soundboard and stream previews in the solid client.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";
import { DEFAULT_PERMISSION_SERVER, Permission } from "../../lib/index.js";
import { fetchSoundboard, fetchStreamPreview } from "../../lib/solid/voiceExtras.js";

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

const sound = (id, name) => ({
  _id: id,
  server: SERVER,
  creator_id: ME,
  name,
  duration_ms: 1200,
  volume: 100,
});

test("a stage channel says so; a plain voice channel does not", async () => {
  const c = await client();
  assert.equal(c.channels.get(STAGE).isStage, true);
  assert.equal(c.channels.get(VOICE).isStage, false);
  assert.equal(c.channels.get(VOICE).isVoiceRoom, true);
});

test("StageUpdate replaces the whole stage state", async () => {
  const c = await client();
  const stage = c.channels.get(STAGE);
  assert.deepEqual(stage.stage(), { speakers: [], hands: [] });
  await c.events.emit("event", {
    type: "StageUpdate",
    id: STAGE,
    data: { topic: "Launch", speakers: [ME], hands: [OTHER] },
  });
  assert.deepEqual(stage.stage(), { topic: "Launch", speakers: [ME], hands: [OTHER] });
  assert.equal(stage.isStageSpeaker(ME), true);
  assert.equal(stage.isStageSpeaker(OTHER), false);

  // an ended stage comes back empty
  await c.events.emit("event", { type: "StageUpdate", id: STAGE, data: { speakers: [], hands: [] } });
  assert.deepEqual(stage.stage(), { topic: undefined, speakers: [], hands: [] });
});

test("leaving the call takes the stage seat with it", async () => {
  const c = await client();
  const stage = c.channels.get(STAGE);
  await c.events.emit("event", {
    type: "StageUpdate",
    id: STAGE,
    data: { speakers: [ME, OTHER], hands: [] },
  });
  await c.events.emit("event", { type: "VoiceChannelLeave", id: STAGE, user: OTHER });
  assert.deepEqual(stage.stage().speakers, [ME]);
});

test("SoundboardPlay is handed to the app", async () => {
  const c = await client();
  const heard = [];
  c.on("soundboardPlay", (...args) => heard.push(args));
  await c.events.emit("event", {
    type: "SoundboardPlay",
    channel_id: VOICE,
    sound_id: ID("S1"),
    user: OTHER,
  });
  assert.deepEqual(heard, [[VOICE, ID("S1"), OTHER]]);
});

test("the voice requests are not in the solid entry (apps load them lazily)", async () => {
  const solid = await import("../../lib/solid/index.js");
  assert.equal(solid.fetchSoundboard, undefined);
  assert.equal(solid.raiseHand, undefined);
});

test("the soundboard is fetched once and kept current by events", async () => {
  const c = await client();
  const server = c.servers.get(SERVER);
  let asked = 0;
  c.api.get = async (path) => {
    asked++;
    assert.equal(path, `/servers/${SERVER}/soundboard`);
    return { sounds: [sound(ID("S1"), "Tada")], limit: 8 };
  };

  // events before the first load are not kept (the load brings them)
  await c.events.emit("event", { type: "SoundboardSoundCreate", ...sound(ID("S0"), "early") });
  assert.equal(server.soundboard.size, 0);

  await Promise.all([fetchSoundboard(c, server), fetchSoundboard(c, server)]);
  await fetchSoundboard(c, server);
  assert.equal(asked, 1, "fetched once");
  assert.equal(server.soundboardLimit(), 8);
  assert.equal(server.soundboard.get(ID("S1")).name, "Tada");

  await c.events.emit("event", { type: "SoundboardSoundCreate", ...sound(ID("S2"), "Horn") });
  await c.events.emit("event", { type: "SoundboardSoundUpdate", ...sound(ID("S1"), "Fanfare") });
  await c.events.emit("event", { type: "SoundboardSoundDelete", id: ID("S2"), server: SERVER });
  assert.deepEqual([...server.soundboard.keys()], [ID("S1")]);
  assert.equal(server.soundboard.get(ID("S1")).name, "Fanfare");
  assert.equal(server.soundboard.get(ID("S1")).type, undefined, "no event type left on the sound");
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
