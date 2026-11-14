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
    "https://www.loom.com/embed/ae4bdcb7209f4769b5e5e43194a2b76d",
    "https://player.bilibili.com/player.html?bvid=BV1MRWV6jEuy&autoplay=0",
    "https://store.steampowered.com/widget/730/",
    "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D1&show_text=false",
  ]) {
    assert.equal(playerAddress(address), new URL(address).toString(), address);
  }
  assert.ok(PLAYER_HOSTS.length >= 19);
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
    "https://facebook.com/plugins/video.php",
    "https://evil.codepen.io/embed/x",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(playerAddress(address), undefined, String(address));
  }
});
