// A bot dashboard must tell a server's managers from its plain members.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError, MemberManager, Permissions } from "../../lib/bot/index.js";
import {
  ALLOW_IN_TIMEOUT,
  DEFAULT_PERMISSION_SERVER,
  Permission,
  serverPermission,
} from "../../lib/index.js";
import { bitwiseAndEq } from "../../lib/solid/permissions/calculator.js";

const MANAGE = Number(Permission.ManageServer);

/** A REST stand-in that answers one server and its members */
function rest({ owner = "O", roles = {}, members = {}, defaults = DEFAULT_PERMISSION_SERVER } = {}) {
  return {
    async get(path) {
      if (path === "/servers/S")
        return { _id: "S", owner, default_permissions: Number(defaults), roles };
      const user = path.match(/^\/servers\/S\/members\/(\w+)$/)?.[1];
      if (user && members[user]) return { _id: { server: "S", user }, ...members[user] };
      // not a member (left, kicked or banned): the API answers 404 NotFound
      if (user) throw new ApiError(404, "GET", path, { type: "NotFound" });
      throw new Error(`unexpected ${path}`);
    },
  };
}

test("a plain member with no role cannot manage the server", async () => {
  const members = new MemberManager(rest({ members: { U: { roles: [] } } }));
  assert.equal(await members.permissions("S", "U"), DEFAULT_PERMISSION_SERVER);
  assert.equal(await members.canManage("S", "U"), false);
});

test("the owner and a Manage Server role can manage", async () => {
  const members = new MemberManager(
    rest({
      roles: { M: { name: "Mod", rank: 1, permissions: { a: MANAGE, d: 0 } } },
      members: { O: { roles: [] }, U: { roles: ["M"] } },
    }),
  );
  assert.equal(await members.canManage("S", "O"), true);
  assert.equal(await members.canManage("S", "U"), true);
});

test("a higher role's deny wins over a lower role's allow", async () => {
  const members = new MemberManager(
    rest({
      roles: {
        low: { name: "Low", rank: 5, permissions: { a: MANAGE, d: 0 } },
        high: { name: "High", rank: 1, permissions: { a: 0, d: MANAGE } },
      },
      members: { U: { roles: ["low", "high"] } },
    }),
  );
  assert.equal(await members.canManage("S", "U"), false);
});

test("Administrator gives everything; a timeout leaves only viewing", () => {
  const admin = { a: Number(Permission.Administrator), d: 0 };
  assert.equal(
    serverPermission({ isOwner: false, serverDefault: 0, serverRoles: [admin], timedOut: true }),
    Permission.GrantAllSafe,
  );
  const timedOut = serverPermission({
    isOwner: false,
    serverDefault: DEFAULT_PERMISSION_SERVER | Permission.ManageServer,
    serverRoles: [],
    timedOut: true,
  });
  assert.equal(timedOut, DEFAULT_PERMISSION_SERVER & ALLOW_IN_TIMEOUT);
});

test("Zrzur bits are not Discord's: Manage Server is 1 << 1", () => {
  assert.equal(Permissions.ManageServer, 2);
  assert.notEqual(Permissions.ManageServer, 0x20);
  assert.equal(Permissions.Administrator, 2 ** 46);
});

test("bitwiseAndEq keeps its old answers (compatibility)", () => {
  // documented: nothing asked is true; the helpers above never ask for nothing
  assert.equal(bitwiseAndEq(Permission.GrantAllSafe), true);
  assert.equal(bitwiseAndEq(Permission.ManageServer, Permission.ManageServer), true);
  assert.equal(bitwiseAndEq(DEFAULT_PERMISSION_SERVER, Permission.ManageServer), false);
});

test("someone who is not a member (left or banned) holds nothing", async () => {
  const members = new MemberManager(rest({ members: {} }));
  assert.equal(await members.permissions("S", "gone"), 0n);
  assert.equal(await members.canManage("S", "gone"), false);
});

test("other errors still reach the bot", async () => {
  const members = new MemberManager({
    async get() {
      throw new ApiError(403, "GET", "/servers/S", { type: "MissingPermission" });
    },
  });
  await assert.rejects(members.canManage("S", "U"), ApiError);
});

test("a server mute takes Speak and Video, a server deafen takes Listen", async () => {
  const members = new MemberManager(
    rest({
      roles: { A: { name: "Admin", rank: 0, permissions: { a: Number(Permission.Administrator), d: 0 } } },
      members: {
        muted: { roles: [], can_publish: false },
        deaf: { roles: [], can_receive: false },
        admin: { roles: ["A"], can_publish: false, can_receive: false },
      },
    }),
  );
  const muted = await members.permissions("S", "muted");
  assert.equal(muted & (Permission.Speak | Permission.Video), 0n);
  assert.equal(muted & Permission.Listen, Permission.Listen);
  const deaf = await members.permissions("S", "deaf");
  assert.equal(deaf & Permission.Listen, 0n);
  assert.equal(deaf & Permission.Speak, Permission.Speak);
  const admin = await members.permissions("S", "admin");
  assert.equal(admin & (Permission.Speak | Permission.Video | Permission.Listen), 0n);
  assert.equal(await members.canManage("S", "admin"), true);
});
