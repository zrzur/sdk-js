// EmbedBuilder limits in the builder match the server: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { EMBED_LIMITS, EmbedBuilder, embedTextLength } from "../../lib/bot/index.js";

test("limits match the server", () => {
  assert.equal(EMBED_LIMITS.title, 256);
  assert.equal(EMBED_LIMITS.description, 4096);
  assert.equal(EMBED_LIMITS.fields, 25);
  assert.equal(EMBED_LIMITS.fieldName, 256);
  assert.equal(EMBED_LIMITS.fieldValue, 1024);
  assert.equal(EMBED_LIMITS.footer, 2048);
  assert.equal(EMBED_LIMITS.author, 256);
  assert.equal(EMBED_LIMITS.total, 6000);
});

test("full-length text fits, one more character is refused", () => {
  assert.doesNotThrow(() => new EmbedBuilder().title("ع".repeat(256)).description("ع".repeat(4096)));
  assert.throws(() => new EmbedBuilder().title("x".repeat(257)), RangeError);
  assert.throws(() => new EmbedBuilder().description("x".repeat(4097)), RangeError);
  assert.throws(() => new EmbedBuilder().field("x".repeat(257), "v"), RangeError);
  assert.throws(() => new EmbedBuilder().field("n", "x".repeat(1025)), RangeError);
  assert.throws(() => new EmbedBuilder().footer("x".repeat(2049)), RangeError);
  assert.throws(() => new EmbedBuilder().author("x".repeat(257)), RangeError);
  assert.throws(() => new EmbedBuilder().title(""), RangeError);
});

test("characters are counted as the server counts them", () => {
  const embed = new EmbedBuilder()
    .title("عنوان")
    .description("وصف 🎮")
    .author("مؤلف")
    .field("اسم", "قيمة")
    .footer("تذييل");
  // emoji is one character, as on the server
  assert.equal(embedTextLength(embed), 5 + 5 + 4 + 3 + 4 + 5);
});

test("links must be web addresses", () => {
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,x", "//evil.example", "file:///etc/passwd"]) {
    assert.throws(() => new EmbedBuilder().url(bad), RangeError, bad);
    assert.throws(() => new EmbedBuilder().icon(bad), RangeError, bad);
    assert.throws(() => new EmbedBuilder().author("a", { url: bad }), RangeError, bad);
    assert.throws(() => new EmbedBuilder().footer("f", bad), RangeError, bad);
  }
  assert.doesNotThrow(() => new EmbedBuilder().url("https://zrzur.com").icon("http://example.com/i.png"));
});

test("an invalid time is refused", () => {
  assert.throws(() => new EmbedBuilder().timestamp("not a date"), RangeError);
});
