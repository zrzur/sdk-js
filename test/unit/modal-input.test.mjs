// Forms (modals) built from friendly input: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { toModal } from "../../lib/bot/index.js";

const field = { type: "textInput", customId: "name", label: "Name" };

test("fields may be given as `fields` or `components`", () => {
  const a = toModal({ customId: "m", title: "T", fields: [field] });
  const b = toModal({ customId: "m", title: "T", components: [field] });
  assert.deepEqual(a, b);
  assert.equal(a.components[0].type, "Field");
});

test("a form without fields fails with a clear message", () => {
  assert.throws(
    () => toModal({ customId: "m", title: "T" }),
    (error) => error instanceof TypeError && /fields/.test(error.message),
  );
});
