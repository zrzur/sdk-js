// Changes to the public Designs gallery arrive over the WebSocket and the
// client hands them on as `designEvent`, as they are, for the gallery to
// apply in place (no refetch).
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";

const design = {
  _id: "01DESIGN",
  kind: "Decoration",
  name: "Crown",
  creator_id: "01CREATOR",
  file: { _id: "f", tag: "decorations", filename: "c.png", metadata: { type: "Image", width: 1, height: 1 }, content_type: "image/png", size: 1 },
  status: "Published",
  revision: 1,
  popularity: 0,
};

test("design events are handed on as they are", async () => {
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  const seen = [];
  const voice = [];
  client.on("designEvent", (event) => seen.push(event));
  client.on("voiceEvent", (event) => voice.push(event));
  await client.events.emit("event", { type: "Ready", users: [], servers: [], channels: [], members: [], emojis: [] });
  const events = [
    { type: "CommunityItemCreate", ...design },
    { type: "CommunityItemUpdate", ...design, name: "Big crown" },
    { type: "CommunityItemPopularity", id: "01DESIGN", popularity: 2 },
    { type: "CommunityItemDelete", id: "01DESIGN" },
  ];
  for (const event of events) await client.events.emit("event", event);
  assert.deepEqual(seen, events);
  assert.deepEqual(voice, [], "not a voice event");
});

test("other events are not design events", async () => {
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  const seen = [];
  client.on("designEvent", (event) => seen.push(event));
  await client.events.emit("event", { type: "Ready", users: [], servers: [], channels: [], members: [], emojis: [] });
  await client.events.emit("event", { type: "SoundboardSoundDelete", id: "s", server: "x" });
  assert.deepEqual(seen, []);
});
