/**
 * Stage, soundboard and stream preview requests, and the helpers to keep a
 * stage's state from its events. Plain functions in their own entry point,
 * so an app that loads its voice screens lazily keeps all of it out of its
 * first download: the solid client only hands the events on (`voiceEvent`).
 */
import type {
  DataAddLibrarySound,
  DataCreateSoundboardSound,
  DataEditSoundboardSound,
  SoundLibrary,
  SoundLibraryCategory,
  SoundLibrarySound,
  SoundboardList,
  SoundboardSound,
  StageChange,
} from "../api/types.js";

import type { Client } from "./Client.js";
import type { Channel } from "./classes/Channel.js";
import type { Server } from "./classes/Server.js";

export type {
  DataAddLibrarySound,
  SoundLibrary,
  SoundLibraryCategory,
  SoundLibrarySound,
  SoundboardList,
  SoundboardSound,
  StageChange,
};

/**
 * Live state of a stage channel
 */
export type StageState = {
  /** Topic of the talk */
  topic?: string;
  /** Users who may speak */
  speakers: string[];
  /** Audience members with a raised hand, oldest first */
  hands: string[];
};

/** A stage nobody started */
export const EMPTY_STAGE: StageState = { speakers: [], hands: [] };

/** The API's stage answer, in the SDK's shape */
export function toStageState(data: {
  topic?: string | null;
  speakers?: string[];
  hands?: string[];
}): StageState {
  return {
    topic: data.topic || undefined,
    speakers: data.speakers ?? [],
    hands: data.hands ?? [],
  };
}

/**
 * The state after a `StageUpdate`
 * @param state State before
 * @param change What the event says changed
 */
export function applyStageChange(
  state: StageState,
  change: StageChange,
): StageState {
  if (change.ended) return EMPTY_STAGE;
  const without = (list: string[], gone?: string[]) =>
    gone?.length ? list.filter((id) => !gone.includes(id)) : list;
  const plus = (list: string[], added?: string[]) => [
    ...new Set([...list, ...(added ?? [])]),
  ];
  return {
    topic:
      change.topic === undefined || change.topic === null
        ? state.topic
        : change.topic || undefined,
    speakers: plus(
      without(state.speakers, change.speakers_removed),
      change.speakers_added,
    ),
    hands: without(plus(state.hands, change.hands_raised), [
      ...(change.hands_lowered ?? []),
      ...(change.speakers_added ?? []),
    ]),
  };
}

const stage = async (answer: Promise<unknown>) =>
  toStageState((await answer) as Parameters<typeof toStageState>[0]);

/** Fetch the live state of a stage */
export function fetchStage(
  client: Client,
  channel: Channel,
): Promise<StageState> {
  return stage(client.api.get(`/channels/${channel.id as ""}/stage`));
}

/**
 * Set or clear the topic of a stage (needs Mute Members)
 * @param topic New topic, or nothing to clear it
 */
export function editStage(
  client: Client,
  channel: Channel,
  topic?: string,
): Promise<StageState> {
  return stage(
    client.api.patch(`/channels/${channel.id as ""}/stage`, {
      topic: topic?.trim() || undefined,
    }),
  );
}

/**
 * Close a stage: everyone leaves; topic, speakers and hands are cleared
 * (needs Mute Members and Move Members)
 */
export function endStage(
  client: Client,
  channel: Channel,
): Promise<StageState> {
  return stage(client.api.delete(`/channels/${channel.id as ""}/stage`));
}

/** Ask to speak (once every 20 seconds) */
export function raiseHand(
  client: Client,
  channel: Channel,
): Promise<StageState> {
  return stage(client.api.put(`/channels/${channel.id as ""}/stage/hand`));
}

/**
 * Put a hand down: your own, or (with Mute Members) someone else's
 * @param userId User, yours by default
 */
export function lowerHand(
  client: Client,
  channel: Channel,
  userId = "@me",
): Promise<StageState> {
  return stage(
    client.api.delete(
      `/channels/${channel.id as ""}/stage/hands/${userId as ""}`,
    ),
  );
}

/**
 * Give someone in the stage the floor (needs Mute Members and a higher rank)
 * @param userId User, or `@me`
 */
export function inviteToSpeak(
  client: Client,
  channel: Channel,
  userId: string,
): Promise<StageState> {
  return stage(
    client.api.put(
      `/channels/${channel.id as ""}/stage/speakers/${userId as ""}`,
    ),
  );
}

/**
 * Back to the listeners: yourself, or (with Mute Members and a higher rank)
 * someone else
 * @param userId User, yours by default
 */
export function moveToAudience(
  client: Client,
  channel: Channel,
  userId = "@me",
): Promise<StageState> {
  return stage(
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
 * @returns A `data:` URL for an `<img>`, or undefined when there is none
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

/** A server's sounds and how many it may have */
export function fetchSoundboard(
  client: Client,
  server: Server,
): Promise<SoundboardList> {
  return client.api.get(`/servers/${server.id as ""}/soundboard`);
}

/**
 * Add a sound uploaded to the `sounds` tag (needs Manage Soundboard)
 * @param fileId Upload id
 */
export function createSound(
  client: Client,
  server: Server,
  fileId: string,
  data: DataCreateSoundboardSound,
): Promise<SoundboardSound> {
  return client.api.put(
    `/servers/${server.id as ""}/soundboard/${fileId as ""}`,
    data,
  );
}

/** Change a sound (needs Manage Soundboard) */
export function editSound(
  client: Client,
  server: Server,
  soundId: string,
  data: DataEditSoundboardSound,
): Promise<SoundboardSound> {
  return client.api.patch(
    `/servers/${server.id as ""}/soundboard/${soundId as ""}`,
    data,
  );
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
}

/** The library list, fetched once per client (it changes only with a server update) */
const libraries = new WeakMap<Client, Promise<SoundLibrary>>();

/**
 * The sound library: ready-made sounds any server can add. Fetched once per
 * client; a failed fetch is tried again next time.
 */
export function fetchSoundLibrary(client: Client): Promise<SoundLibrary> {
  let library = libraries.get(client);
  if (!library) {
    library = client.api.get("/soundboard/library");
    libraries.set(client, library);
    library.catch(() => libraries.delete(client));
  }
  return library;
}

/**
 * Address of a library sound's file. It holds the file's version, so the
 * browser keeps the answer for good; nothing is fetched until it is played.
 */
export function soundLibraryPreviewUrl(
  client: Client,
  sound: Pick<SoundLibrarySound, "id" | "version">,
): string {
  const base = client.options.baseURL.replace(/\/+$/, "");
  return `${base}/soundboard/library/${encodeURIComponent(sound.id)}/audio?v=${encodeURIComponent(sound.version)}`;
}

/**
 * Add a library sound to a server's soundboard (needs Manage Soundboard).
 * Without a name it gets the library name in your language.
 */
export function addLibrarySound(
  client: Client,
  server: Pick<Server, "id">,
  libraryId: string,
  data: DataAddLibrarySound = {},
): Promise<SoundboardSound> {
  return client.api.put(
    `/servers/${server.id as ""}/soundboard/library/${libraryId as ""}`,
    data,
  );
}

/**
 * A library name in a language (`ar`, `de-AT`, `zh-CN` …), English when the
 * library has none in it
 */
export function soundLibraryName(
  names: Record<string, string>,
  locale: string,
): string {
  if (names[locale]) return names[locale];
  const base = locale.split(/[-_]/)[0];
  const near = Object.keys(names).find((lang) => lang.split("-")[0] === base);
  return (near && names[near]) || names.en || "";
}

/** Lower case without quotes, marks or extra spaces, for matching */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Library sounds of a category whose name (in the page language or in
 * English) contains the query, in library order
 */
export function searchSoundLibrary(
  library: SoundLibrary,
  options: { category?: string; query?: string; locale?: string },
): SoundLibrarySound[] {
  const query = fold(options.query ?? "");
  const locale = options.locale ?? "en";
  return library.sounds.filter((sound) => {
    if (options.category && sound.category !== options.category) return false;
    if (!query) return true;
    return (
      fold(soundLibraryName(sound.names, locale)).includes(query) ||
      fold(sound.names.en ?? "").includes(query)
    );
  });
}
