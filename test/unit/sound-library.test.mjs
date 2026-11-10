// The sound library: listing (fetched once), preview addresses, adding a
// library sound to a server, names per language and search.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";
import {
  addLibrarySound,
  fetchSoundLibrary,
  searchSoundLibrary,
  soundLibraryName,
  soundLibraryPreviewUrl,
} from "../../lib/solid/voiceExtras.js";

const SERVER = "01ARZ3NDEKTSV4RRFFQ69G5FSV";

const library = {
  categories: [
    { id: "voice", names: { en: "Voice lines (English)", ar: "عبارات صوتية (بالإنجليزية)" } },
    { id: "alerts", names: { en: "Alerts", ar: "تنبيهات" } },
  ],
  sounds: [
    { id: "voice-go", category: "voice", emoji: "🏁", duration_ms: 500, size: 6000, version: "abcdef012345",
      names: { en: "“Go”", ar: "«Go»: انطلق", de: "„Go“: Los", "zh-Hans": "“Go”：出发" } },
    { id: "alert-success", category: "alerts", emoji: "✔️", duration_ms: 700, size: 7000, version: "0123456789ab",
      names: { en: "Success", ar: "نجاح", de: "Erfolg" } },
    { id: "alert-error", category: "alerts", emoji: "⛔", duration_ms: 400, size: 5000, version: "fedcba987654",
      names: { en: "Error", ar: "خطأ", de: "Fehler" } },
  ],
};

function client() {
  return new Client({ baseURL: "https://api.example/", syncUnreads: false, autoReconnect: false });
}

test("the library is fetched once per client, and again after a failure", async () => {
  const c = client();
  let calls = 0;
  c.api.get = async (path) => {
    calls++;
    assert.equal(path, "/soundboard/library");
    if (calls === 1) throw new Error("offline");
    return library;
  };
  await assert.rejects(fetchSoundLibrary(c), /offline/);
  assert.equal(await fetchSoundLibrary(c), library);
  assert.equal(await fetchSoundLibrary(c), library);
  assert.equal(calls, 2);
});

test("a preview address holds the file's version", () => {
  const c = client();
  assert.equal(
    soundLibraryPreviewUrl(c, library.sounds[0]),
    "https://api.example/soundboard/library/voice-go/audio?v=abcdef012345",
  );
});

test("adding a library sound puts it on the server", async () => {
  const c = client();
  const server = { id: SERVER };
  c.api.put = async (path, body) => {
    assert.equal(path, `/servers/${SERVER}/soundboard/library/voice-go`);
    assert.deepEqual(body, { name: "Los!" });
    return { _id: "S1", library_id: "voice-go", name: "Los!" };
  };
  const sound = await addLibrarySound(c, server, "voice-go", { name: "Los!" });
  assert.equal(sound.library_id, "voice-go");

  c.api.put = async (_path, body) => {
    assert.deepEqual(body, {});
    return { _id: "S2" };
  };
  await addLibrarySound(c, server, "voice-go");
});

test("names follow the language, then English", () => {
  const go = library.sounds[0];
  assert.equal(soundLibraryName(go.names, "ar"), "«Go»: انطلق");
  assert.equal(soundLibraryName(go.names, "de-AT"), "„Go“: Los");
  assert.equal(soundLibraryName(go.names, "zh-CN"), "“Go”：出发");
  assert.equal(soundLibraryName(go.names, "fr"), "“Go”");
  assert.equal(soundLibraryName({}, "fr"), "");
});

test("search looks in the category, the page language and English", () => {
  assert.deepEqual(
    searchSoundLibrary(library, { category: "alerts" }).map((s) => s.id),
    ["alert-success", "alert-error"],
  );
  assert.deepEqual(searchSoundLibrary(library, { query: "نجاح", locale: "ar" }).map((s) => s.id), ["alert-success"]);
  // English works whatever the page language
  assert.deepEqual(searchSoundLibrary(library, { query: "ERR", locale: "ar" }).map((s) => s.id), ["alert-error"]);
  assert.deepEqual(searchSoundLibrary(library, { query: "fehl", locale: "de" }).map((s) => s.id), ["alert-error"]);
  // quotes and marks don't get in the way
  assert.deepEqual(searchSoundLibrary(library, { query: "go", locale: "de" }).map((s) => s.id), ["voice-go"]);
  assert.deepEqual(searchSoundLibrary(library, { query: "  ", category: "voice" }).map((s) => s.id), ["voice-go"]);
  assert.deepEqual(searchSoundLibrary(library, { query: "nothing", locale: "en" }), []);
});
