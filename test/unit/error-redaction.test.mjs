// An error is often logged whole (the default `onError` does it): none of
// its fields may hold an interaction or webhook token.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";

import { ApiError } from "../../lib/index.js";

const SECRET = "SECRETTOKEN123";

for (const path of [
  `/interactions/01HZZZZZZZZZZZZZZZZZZZZZZZ/${SECRET}/callback`,
  `/webhooks/01HZZZZZZZZZZZZZZZZZZZZZZZ/${SECRET}?wait=true`,
  `/webhooks/01HZZZZZZZZZZZZZZZZZZZZZZZ/${SECRET}/messages/01J`,
]) {
  test(`no token in an error for ${path.split("/")[1]} (${path.split("/").length} parts)`, () => {
    const error = new ApiError(410, "POST", path, {
      type: "InteractionExpired",
    });
    assert.ok(
      !inspect(error, { depth: 5 }).includes(SECRET),
      "console.error(error)",
    );
    assert.ok(!JSON.stringify(error).includes(SECRET), "JSON.stringify(error)");
    assert.ok(!String(error.stack).includes(SECRET), "error.stack");
    assert.ok(!error.path.includes(SECRET), "error.path");
    assert.ok(
      error.path.includes("***"),
      "the token is replaced, the rest stays",
    );
  });
}
