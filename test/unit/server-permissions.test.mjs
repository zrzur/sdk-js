import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOW_IN_TIMEOUT,
  DEFAULT_PERMISSION_SERVER,
  Permission,
  serverChannelPermission,
} from "../../lib/index.js";

// The order must be the API's (revolt-permissions `granted_in_channel`):
// server default, channel default, server roles, channel roles, member.
const view = Permission.ViewChannel;
const send = Permission.SendMessage;
const none = { a: 0, d: 0 };
const denyView = { a: 0, d: Number(view) };
const allowView = { a: Number(view), d: 0 };

const base = {
  serverDefault: DEFAULT_PERMISSION_SERVER,
  channelDefault: undefined,
  serverRoles: [],
  channelRoles: [],
  member: undefined,
  timedOut: false,
};

test("a channel denied to @everyone is hidden from a plain member", () => {
  const perm = serverChannelPermission({ ...base, channelDefault: denyView });
  assert.equal(perm, 0n);
});

test("a role allowing View server-wide sees a channel denied to @everyone, as the API says", () => {
  const perm = serverChannelPermission({
    ...base,
    channelDefault: denyView,
    serverRoles: [allowView],
  });
  assert.equal(perm & view, view);
  assert.equal(perm & send, send);
});

test("a role with View on inherit does not see it", () => {
  const perm = serverChannelPermission({
    ...base,
    channelDefault: denyView,
    serverRoles: [{ a: Number(Permission.ManageServer | Permission.ManageRole), d: 0 }],
  });
  assert.equal(perm, 0n);
});

test("a channel override for the role wins over its server-wide allow", () => {
  const perm = serverChannelPermission({
    ...base,
    serverRoles: [allowView],
    channelRoles: [denyView],
  });
  assert.equal(perm, 0n);
});

test("a channel role allow opens a private channel", () => {
  const perm = serverChannelPermission({
    ...base,
    channelDefault: denyView,
    serverRoles: [none],
    channelRoles: [allowView],
  });
  assert.equal(perm & view, view);
});

test("the member's own override comes last", () => {
  const perm = serverChannelPermission({
    ...base,
    channelRoles: [allowView],
    member: denyView,
  });
  assert.equal(perm, 0n);
});

test("higher roles come later and win", () => {
  // lowest first, as `orderedRoles` gives them
  const perm = serverChannelPermission({
    ...base,
    serverRoles: [{ a: 0, d: Number(send) }, { a: Number(send), d: 0 }],
  });
  assert.equal(perm & send, send);
});

test("timeout keeps only what the API allows in timeout", () => {
  const perm = serverChannelPermission({ ...base, timedOut: true });
  assert.equal(perm & ~ALLOW_IN_TIMEOUT, 0n);
  assert.equal(perm & view, view);
});

test("without View nothing else is left", () => {
  const perm = serverChannelPermission({
    ...base,
    serverDefault: DEFAULT_PERMISSION_SERVER & ~view,
  });
  assert.equal(perm, 0n);
});
