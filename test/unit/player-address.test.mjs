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
    // each address exactly as the link service builds it
    "https://www.tiktok.com/player/v1/7301234567890123456",
    "https://www.instagram.com/reel/CxYz12ab/embed",
    "https://www.dailymotion.com/embed/video/x8abcd1",
    "https://player.kick.com/somechannel",
    "https://embed.tidal.com/tracks/12345678",
    "https://www.mixcloud.com/widget/iframe/?hide_cover=1&feed=%2Fsomeone%2Fa-mix%2F",
    "https://embed.podcasts.apple.com/us/podcast/some-show/id1200361736",
    "https://embed.ted.com/talks/ken_robinson_do_schools_kill_creativity",
    "https://coub.com/embed/2pc24rpb",
    "https://codepen.io/team/embed/PNaGbb?default-tab=result",
    "https://codesandbox.io/embed/react-editor-js-example-m9e49",
    "https://stackblitz.com/edit/angular?embed=1",
    "https://jsfiddle.net/zalun/NmudS/embedded/result,js,html,css/",
    "https://jsfiddle.net/zalun/NmudS/3/embedded/result,js,html,css/",
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
    // a listed host, but not its player page
    "https://www.facebook.com/login",
    "https://codepen.io/login",
    "https://store.steampowered.com/account/",
    "https://www.loom.com/login",
    "https://player.vimeo.com/video/1/../../login",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(playerAddress(address), undefined, String(address));
  }
});
