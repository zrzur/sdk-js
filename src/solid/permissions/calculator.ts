import {
  ALLOW_IN_TIMEOUT,
  DEFAULT_PERMISSION_DIRECT_MESSAGE,
  DEFAULT_PERMISSION_VIEW_ONLY,
  Permission,
  UserPermission,
  serverChannelPermission,
} from "../../core/permissions.js";
import type { Client } from "../Client.js";
import { Channel, Server, ServerMember } from "../classes/index.js";

/**
 * Check whether `b` is present in `a`
 * @param a Input A
 * @param b Inputs (OR'd together)
 */
export function bitwiseAndEq(a: bigint, ...b: bigint[]): boolean {
  const value = b.reduce((prev, cur) => prev | cur, 0n);
  return (value & a) === value;
}

/**
 * Calculate permissions against a given object
 * @param target Target object to check permissions against
 * @param options Additional options to use when calculating
 */
export function calculatePermission(
  client: Client,
  target: Channel | Server,
  options?: {
    /**
     * Pretend to be another ServerMember
     */
    member?: ServerMember;
  },
): bigint {
  const user = options?.member ? options?.member.user : client.user;
  if (user?.privileged) {
    return Permission.GrantAllSafe;
  }

  if (target instanceof Server) {
    // 1. Check if owner.
    if (target.ownerId === user?.id) {
      return Permission.GrantAllSafe;
    } else {
      // 2. Get ServerMember.
      const member = options?.member ??
        client.serverMembers.getByKey({
          user: user!.id,
          server: target.id,
        }) ?? { roles: null, timeout: null };

      if (!member) return 0n;

      // 3. Apply allows from default_permissions.
      let perm = BigInt(target.defaultPermissions);

      // 4. If user has roles, iterate in order.
      if (member.roles && target.roles) {
        // 5. Apply allows and denies from roles.
        const permissions = member.orderedRoles.map(
          (role) => role.permissions ?? { a: 0, d: 0 },
        );

        for (const permission of permissions) {
          perm = (perm | BigInt(permission.a)) & ~BigInt(permission.d);
        }
      }

      // 5. Revoke permissions if ServerMember is timed out.
      if (member.timeout && member.timeout > new Date()) {
        perm = perm & BigInt(ALLOW_IN_TIMEOUT);
      }

      return perm;
    }
  } else {
    // 1. Check channel type.
    switch (target.type) {
      case "SavedMessages":
        return Permission.GrantAllSafe;
      case "DirectMessage": {
        // 2. Determine user permissions.
        const recipient = target.recipient;
        const user_permissions = recipient?.permission || 0;

        // 3. Check if the user can send messages.
        // The other person's privacy settings are private, so apart from
        // blocks the server decides and says why when it refuses.
        if (
          user_permissions & UserPermission.SendMessage ||
          (recipient &&
            recipient.relationship !== "Blocked" &&
            recipient.relationship !== "BlockedOther")
        ) {
          return DEFAULT_PERMISSION_DIRECT_MESSAGE;
        } else {
          return DEFAULT_PERMISSION_VIEW_ONLY;
        }
      }
      case "Group": {
        // 2. Check if user is owner.
        if (target.ownerId === user!.id) {
          return Permission.GrantAllSafe;
        } else {
          // 3. Pull out group permissions.
          return target.permissions ?? DEFAULT_PERMISSION_DIRECT_MESSAGE;
        }
      }
      case "TextChannel": {
        // 1b. A thread uses its parent channel's permissions.
        const parent = target.parent;
        if (parent) return calculatePermission(client, parent, options);

        // 2. Get server.
        const server = target.server;
        if (typeof server === "undefined") return 0n;

        // 3. If server owner, just grant all permissions.
        if (server.ownerId === user?.id) {
          return Permission.GrantAllSafe;
        } else {
          // 4. Get ServerMember.
          const member = options?.member ??
            client.serverMembers.getByKey({
              user: user!.id,
              server: server.id,
            }) ?? { roles: null, timeout: null };

          if (!member) return 0n;

          // 5. A channel synced with its category uses the category's
          //    default and role overrides instead of its own.
          const category = target.syncedCategory as
            | (typeof target.syncedCategory & {
                default_permissions?: { a: number; d: number };
                role_permissions?: Record<string, { a: number; d: number }>;
              })
            | undefined;
          const defaultOverride = category
            ? category.default_permissions
            : target.defaultPermissions;
          const roleOverrides =
            (category ? category.role_permissions : target.rolePermissions) ??
            {};

          // 6. Roles lowest first, so higher roles win.
          const roles =
            member.roles && server.roles
              ? (member as ServerMember).orderedRoles
              : [];

          // 7. Same order as the API, or the app hides or shows things the
          //    API decides otherwise (a server-wide role allow beats an
          //    @everyone deny on the channel).
          return serverChannelPermission({
            serverDefault: server.defaultPermissions,
            channelDefault: defaultOverride,
            serverRoles: roles.map(
              (role) => role.permissions ?? { a: 0, d: 0 },
            ),
            channelRoles: roles
              .map(({ id }) => roleOverrides[id])
              .filter((override) => !!override),
            member: target.memberPermissions?.[user!.id],
            timedOut: !!(member.timeout && member.timeout > new Date()),
          });
        }
      }
    }

    return 0n;
  }
}
