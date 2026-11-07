// Select menus are checked against the server's limits before sending: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SELECT_LIMITS, toBlocks, toModal } from "../../lib/bot/index.js";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const options = (n) =>
  Array.from({ length: n }, (_, i) => ({
    label: `خريطة ${i}`,
    value: `m${i}`,
  }));
const select = (extra) => [
  { type: "select", customId: "maps", options: options(3), ...extra },
];

test("limits match the server", () => {
  assert.deepEqual(SELECT_LIMITS, {
    options: 25,
    values: 25,
    optionText: 100,
    placeholder: 150,
    customId: 100,
    emoji: 32,
    defaultValues: 25,
  });
});

test("at the limit is accepted, one past it is refused", () => {
  assert.doesNotThrow(() =>
    toBlocks(select({ options: options(25), minValues: 25, maxValues: 25 })),
  );
  assert.throws(() => toBlocks(select({ options: options(26) })), RangeError);
  assert.throws(() => toBlocks(select({ options: [] })), RangeError);
  const long = (key, n) => [{ label: "L", value: "v", [key]: "ع".repeat(n) }];
  for (const key of ["label", "value", "description"]) {
    assert.doesNotThrow(
      () => toBlocks(select({ options: long(key, 100) })),
      key,
    );
    assert.throws(
      () => toBlocks(select({ options: long(key, 101) })),
      RangeError,
      key,
    );
  }
  assert.doesNotThrow(() => toBlocks(select({ placeholder: "ض".repeat(150) })));
  assert.throws(
    () => toBlocks(select({ placeholder: "x".repeat(151) })),
    RangeError,
  );
  assert.throws(
    () => toBlocks(select({ customId: "c".repeat(101) })),
    RangeError,
  );
  assert.throws(
    () =>
      toBlocks(
        select({
          options: [{ label: "L", value: "v", emoji: "e".repeat(33) }],
        }),
      ),
    RangeError,
  );
});

test("menu text stays on one line", () => {
  for (const bad of ["two\nlines", "tab\there"]) {
    assert.throws(
      () => toBlocks(select({ options: [{ label: bad, value: "v" }] })),
      RangeError,
    );
    assert.throws(() => toBlocks(select({ placeholder: bad })), RangeError);
  }
});

test("picks: counts, duplicates and defaults", () => {
  assert.doesNotThrow(() => toBlocks(select({ minValues: 0, maxValues: 1 })));
  assert.throws(
    () => toBlocks(select({ minValues: 2, maxValues: 1 })),
    RangeError,
  );
  assert.throws(() => toBlocks(select({ maxValues: 0 })), RangeError);
  assert.throws(
    () => toBlocks(select({ maxValues: 4 })),
    RangeError,
    "more than offered",
  );
  assert.throws(
    () =>
      toBlocks(
        select({
          options: [
            { label: "A", value: "x" },
            { label: "B", value: "x" },
          ],
        }),
      ),
    RangeError,
  );
  const twoDefaults = options(3).map((o, i) => ({ ...o, default: i < 2 }));
  assert.throws(() => toBlocks(select({ options: twoDefaults })), RangeError);
  assert.doesNotThrow(() =>
    toBlocks(select({ options: twoDefaults, maxValues: 2 })),
  );
});

test("user, role, channel and mentionable menus", () => {
  const typed = (extra) => [
    { type: "roleSelect", customId: "roles", ...extra },
  ];
  assert.doesNotThrow(() =>
    toBlocks(typed({ defaultValues: [ID], maxValues: 1 })),
  );
  assert.throws(
    () => toBlocks(typed({ defaultValues: [ID, ID], maxValues: 2 })),
    RangeError,
  );
  assert.throws(
    () => toBlocks(typed({ defaultValues: ["admin"] })),
    RangeError,
  );
  assert.throws(
    () => toBlocks(typed({ defaultValues: [ID, ID.replace("V", "W")] })),
    RangeError,
    "over max",
  );
  assert.throws(() => toBlocks(typed({ maxValues: 26 })), RangeError);
  assert.throws(
    () =>
      toBlocks([{ type: "channelSelect", customId: "c", channelTypes: [] }]),
    RangeError,
  );
});

test("menus in wire format and in forms are checked too", () => {
  assert.throws(
    () =>
      toBlocks([
        {
          type: "ActionRow",
          components: [
            { type: "StringSelect", custom_id: "x", options: options(26) },
          ],
        },
      ]),
    RangeError,
  );
  assert.throws(
    () =>
      toModal({
        customId: "m",
        title: "T",
        fields: [
          { type: "userSelect", customId: "u", label: "Who", maxValues: 30 },
        ],
      }),
    RangeError,
  );
});
