// A "Player" embed loads only https addresses on the client's own list of
// player hosts, whatever the link service sent: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PLAYER_HOSTS, playerAddress } from "../../lib/solid/classes/MessageEmbed.js";

test("listed players load", () => {
  for (const address of [
    "https://player.vimeo.com/video/76979871",
    "https://www.tiktok.com/embed/v2/7301234567890123456",
    "https://www.instagram.com/p/CxYz/embed",
    "https://widget.deezer.com/widget/dark/playlist/1479458365",
    "https://embed.podcasts.apple.com/us/podcast/x/id1?i=2",
    "https://www.mixcloud.com/widget/iframe/?feed=%2Fa%2Fb%2F",
  ]) {
    assert.equal(playerAddress(address), new URL(address).toString(), address);
  }
  assert.ok(PLAYER_HOSTS.length >= 9);
});

test("anything else does not", () => {
  for (const address of [
    undefined,
    "",
    "http://player.vimeo.com/video/1",
    "https://evil.example/video/1",
    "https://player.vimeo.com.evil.example/video/1",
    "https://user:pass@player.vimeo.com/video/1",
    "https://player.vimeo.com:8443/video/1",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(playerAddress(address), undefined, String(address));
  }
});
