// Hydration turns API objects into the client's shape. It runs for every
// server, channel, member and user in Ready and for every fetched message, so
// it must stay linear in the number of fields: no copy of the object per
// field, and no thrown error for a field that has no mapping.
import assert from "node:assert/strict";
import { test } from "node:test";

import { hydrate } from "../../lib/solid/hydration/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;

test("a channel keeps its mapped fields and drops unknown ones", () => {
  const debug = console.debug;
  const skipped = [];
  console.debug = (line) => skipped.push(line);
  try {
    const out = hydrate(
      "channel",
      {
        _id: ID("C1"),
        channel_type: "TextChannel",
        name: "general",
        server: ID("S1"),
        last_message_id: ID("M1"),
        default_permissions: { a: 1, d: 2 },
        not_a_field: true,
      },
      {},
    );
    assert.equal(out.id, ID("C1"));
    assert.equal(out.channelType, "TextChannel");
    assert.equal(out.name, "general");
    assert.equal(out.serverId, ID("S1"));
    assert.equal(out.lastMessageId, ID("M1"));
    assert.deepEqual(out.defaultPermissions, { a: 1n, d: 2n });
    assert.equal("not_a_field" in out, false);
    assert.equal("_id" in out, false);
    assert.deepEqual(skipped, ["Skipping key not_a_field during hydration!"]);
  } finally {
    console.debug = debug;
  }
});

test("the key order follows the input, and partial and type are handled as before", () => {
  const out = hydrate(
    "user",
    { username: "a", _id: ID("U1"), type: "UserUpdate", partial: true },
    {},
  );
  assert.deepEqual(Object.keys(out), ["username", "id", "partial"]);
  assert.equal(out.partial, true);
  assert.equal(out.id, ID("U1"));
});

test("a mapping that throws skips only its own field", () => {
  // BigInt("x") throws: permissions is skipped, the rest is kept
  const debug = console.debug;
  console.debug = () => {};
  try {
    const out = hydrate("channel", { _id: ID("C2"), permissions: "x", name: "n" }, {});
    assert.equal(out.id, ID("C2"));
    assert.equal(out.name, "n");
    assert.equal("permissions" in out, false);
  } finally {
    console.debug = debug;
  }
});

test("initial hydration fills defaults and the input wins", () => {
  const out = hydrate("channel", { _id: ID("C3"), channel_type: "TextChannel", name: "x" }, {}, true);
  assert.equal(out.id, ID("C3"));
  assert.equal(out.name, "x");
  assert.ok(out.typingIds instanceof Set || typeof out.typingIds?.has === "function");
  assert.ok(typeof out.recipientIds?.has === "function");
});

test("20000 channels hydrate quickly (Ready of a large account)", () => {
  const t = performance.now();
  for (let i = 0; i < 20000; i++) {
    hydrate(
      "channel",
      { _id: ID("C5"), channel_type: "TextChannel", name: "c", server: ID("S1"), last_message_id: ID("M1"), nsfw: false, slowmode: 0 },
      {},
      true,
    );
  }
  const ms = performance.now() - t;
  console.log(`20000 channels: ${Math.round(ms)} ms`);
  assert.ok(ms < 1500, `20000 channels took ${Math.round(ms)} ms`);
});
