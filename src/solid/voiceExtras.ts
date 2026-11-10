/**
 * Stage, soundboard and stream preview requests. Plain functions rather than
 * class methods, so an app that loads its voice screens lazily keeps them out
 * of its first download (unused exports are dropped by bundlers; methods are
 * not). The classes keep only the state events update.
 */
import type {
  DataCreateSoundboardSound,
  DataEditSoundboardSound,
  SoundboardSound,
} from "../api/types.js";

import type { Client } from "./Client.js";
import { type StageState, toStageState } from "./classes/Channel.js";
import type { Channel } from "./classes/Channel.js";
import type { Server } from "./classes/Server.js";

async function stage(channel: Channel, answer: Promise<unknown>) {
  const state = toStageState(
    (await answer) as Parameters<typeof toStageState>[0],
  );
  channel.setStageState(state);
  return state;
}

/**
 * Fetch the live state of a stage
 * @param client Client
 * @param channel Stage channel
 */
export function fetchStage(
  client: Client,
  channel: Channel,
): Promise<StageState> {
  return stage(channel, client.api.get(`/channels/${channel.id as ""}/stage`));
}

/**
 * Set or clear the topic of a stage (needs Mute Members)
 * @param client Client
 * @param channel Stage channel
 * @param topic New topic, or nothing to clear it
 */
export function editStage(
  client: Client,
  channel: Channel,
  topic?: string,
): Promise<StageState> {
  return stage(
    channel,
    client.api.patch(`/channels/${channel.id as ""}/stage`, {
      topic: topic?.trim() || undefined,
    }),
  );
}

/**
 * End a stage: everyone leaves; topic, speakers and hands are cleared
 * (needs Mute Members)
 */
export function endStage(
  client: Client,
  channel: Channel,
): Promise<StageState> {
  return stage(
    channel,
    client.api.delete(`/channels/${channel.id as ""}/stage`),
  );
}

/** Raise your hand to speak */
export function raiseHand(
  client: Client,
  channel: Channel,
): Promise<StageState> {
  return stage(
    channel,
    client.api.put(`/channels/${channel.id as ""}/stage/hand`),
  );
}

/**
 * Lower a raised hand: your own, or (with Mute Members) someone else's
 * @param userId User, yours by default
 */
export function lowerHand(
  client: Client,
  channel: Channel,
  userId = "@me",
): Promise<StageState> {
  return stage(
    channel,
    client.api.delete(
      `/channels/${channel.id as ""}/stage/hands/${userId as ""}`,
    ),
  );
}

/**
 * Invite someone in the stage to speak (needs Mute Members)
 * @param userId User, or `@me`
 */
export function inviteToSpeak(
  client: Client,
  channel: Channel,
  userId: string,
): Promise<StageState> {
  return stage(
    channel,
    client.api.put(
      `/channels/${channel.id as ""}/stage/speakers/${userId as ""}`,
    ),
  );
}

/**
 * Move a speaker back to the audience: yourself, or (with Mute Members)
 * someone else
 * @param userId User, yours by default
 */
export function moveToAudience(
  client: Client,
  channel: Channel,
  userId = "@me",
): Promise<StageState> {
  return stage(
    channel,
    client.api.delete(
      `/channels/${channel.id as ""}/stage/speakers/${userId as ""}`,
    ),
  );
}

/**
 * Play a soundboard sound of the server into this call (you must be in it;
 * needs Use Soundboard and Speak)
 */
export async function playSound(
  client: Client,
  channel: Channel,
  soundId: string,
): Promise<void> {
  await client.api.post(
    `/channels/${channel.id as ""}/soundboard/${soundId as ""}`,
  );
}

/**
 * Send a new still of your screen share (JPEG or WebP, base64, at most
 * 20 KB). The server keeps one per 25 seconds; resolves to whether it was
 * taken.
 */
export async function sendStreamPreview(
  client: Client,
  channel: Channel,
  image: string,
): Promise<boolean> {
  try {
    await client.api.put(`/channels/${channel.id as ""}/stream_preview`, {
      image,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The latest still of someone's screen share in a channel
 * @returns A `data:` URL for an `<img>`, or undefined
 */
export async function fetchStreamPreview(
  client: Client,
  channel: Channel,
  userId: string,
): Promise<string | undefined> {
  try {
    const preview = await client.api.get(
      `/channels/${channel.id as ""}/stream_preview/${userId as ""}`,
    );
    return `data:${preview.content_type};base64,${preview.image}`;
  } catch {
    return undefined;
  }
}

const loads = new WeakMap<Server, Promise<SoundboardSound[]>>();

/**
 * Fetch a server's soundboard once; later calls share the answer (events
 * keep it current). Pass `force` to ask again.
 */
export function fetchSoundboard(
  client: Client,
  server: Server,
  force = false,
): Promise<SoundboardSound[]> {
  const known = loads.get(server);
  if (known && !force) return known;
  const load = client.api
    .get(`/servers/${server.id as ""}/soundboard`)
    .then((list) => {
      server.setSoundboard(list);
      return list.sounds;
    });
  // a failed load may be tried again
  load.catch(() => {
    if (loads.get(server) === load) loads.delete(server);
  });
  loads.set(server, load);
  return load;
}

/**
 * Add a sound uploaded to the `sounds` tag (needs Manage Soundboard)
 * @param fileId Upload id
 */
export async function createSound(
  client: Client,
  server: Server,
  fileId: string,
  data: DataCreateSoundboardSound,
): Promise<SoundboardSound> {
  const sound = await client.api.put(
    `/servers/${server.id as ""}/soundboard/${fileId as ""}`,
    data,
  );
  server.soundboardReceived(sound);
  return sound;
}

/** Change a sound (needs Manage Soundboard) */
export async function editSound(
  client: Client,
  server: Server,
  soundId: string,
  data: DataEditSoundboardSound,
): Promise<SoundboardSound> {
  const sound = await client.api.patch(
    `/servers/${server.id as ""}/soundboard/${soundId as ""}`,
    data,
  );
  server.soundboardReceived(sound);
  return sound;
}

/** Remove a sound (needs Manage Soundboard) */
export async function deleteSound(
  client: Client,
  server: Server,
  soundId: string,
): Promise<void> {
  await client.api.delete(
    `/servers/${server.id as ""}/soundboard/${soundId as ""}`,
  );
  server.soundboardRemoved(soundId);
}
