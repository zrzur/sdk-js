import { ReactiveMap } from "@solid-primitives/map";
import { ReactiveSet } from "@solid-primitives/set";

import type * as APITypes from "../../api/types.js";
import type {
  Server as APIServer,
  Category,
  SystemMessageChannels,
} from "../../api/types.js";
import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import { ServerRole } from "../classes/ServerRole.js";
import { type WithoutNull, withoutNull } from "../lib/withoutNull.js";

import type { Hydrate } from "./index.js";

export type HydratedServer = {
  id: string;
  ownerId: string;

  name: string;
  description?: string;

  icon?: File;
  banner?: File;

  channelIds: ReactiveSet<string>;
  categories?: Category[];

  systemMessages?: SystemMessageChannels;
  roles: ReactiveMap<string, ServerRole>;
  defaultPermissions: bigint;

  flags: ServerFlags;
  analytics: boolean;
  discoverable: boolean;
  /** Who can become a member (separate from Discover listing) */
  access: ServerAccess;
  /** What members without a role need before they can talk */
  verificationLevel: ServerVerificationLevel;
  /** Security actions: until when invites / DMs between non-friends are paused */
  invitesPausedUntil?: Date;
  dmsPausedUntil?: Date;
  /** Rules screening: members who joined since then accept the rules first */
  rulesScreeningSince?: Date;
  nsfw: boolean;
  approximateMemberCount: number;
  /** Zrzur supercharges on the server and the level they reach */
  supercharge?: ServerSupercharge;
  /** Channel that holds the server rules */
  rulesChannelId?: string;
  /** Live counters shown at the top of the channel list, in order */
  stats?: ServerStat[];
  /** Welcome page shown before the channels */
  lobby?: ServerLobby;
  /** Threads are switched off: nothing new, existing ones stay readable */
  threadsDisabled: boolean;
  /** Forums are switched off: nothing new, existing ones stay readable */
  forumsDisabled: boolean;
  /** Custom invite link (zrzur.cc/<code>), a Wings level perk */
  vanityInvite?: ServerVanityInvite;
};

/**
 * A live counter shown at the top of a server's channel list
 */
export type ServerStat = APITypes.ServerStat;

/**
 * Who can become a member of a server:
 * - `Open`: a join link or invite joins right away
 * - `Approval`: a join link creates a request a reviewer approves
 * - `Locked`: only invites from people allowed to invite; no requests
 *
 * Discover listing is separate and only possible for `Open`.
 */
export type ServerAccess = APITypes.ServerAccess;

/**
 * What members without a role need before they can send messages, react
 * or join voice (members with a role, bots and the owner are exempt):
 * - `Low`: a verified email
 * - `Medium`: Low, and an account older than 5 minutes
 * - `High`: Medium, and a member for 10 minutes
 */
export type ServerVerificationLevel = "None" | "Low" | "Medium" | "High";

/** What an AutoMod rule looks for */
export type AutoModTrigger = APITypes.AutoModTrigger;

/** An AutoMod rule (Manage Server only; never part of the server object) */
export type AutoModRule = APITypes.AutoModRule;

/**
 * A request to join a server that needs approval
 */
export type ServerJoinRequest = APITypes.ServerJoinRequest;

/**
 * A server's welcome page: what it is about, where to start, common
 * questions and who runs it
 */
export type ServerLobby = WithoutNull<APITypes.ServerLobby>;

/**
 * A part of the lobby page
 */
export type LobbySection = WithoutNull<APITypes.LobbySection>;

/**
 * Zrzur supercharge state of a server
 */
export type ServerSupercharge = APITypes.ServerSupercharge;

/**
 * A server's custom invite link
 */
export type ServerVanityInvite = {
  /** Name after zrzur.cc/, lowercase */
  code: string;
  /** Channel new members land in */
  channel: string;
  claimedAt: Date;
  /** Set while the server is below the level that unlocks the link */
  belowLevelSince?: Date;
};

export type APIServerVanityInvite = {
  code: string;
  channel: string;
  claimed_at: string;
  below_level_since?: string | null;
};

/** Read a custom link from its API shape */
export function hydrateVanityInvite(
  data?: APIServerVanityInvite | null,
): ServerVanityInvite | undefined {
  if (!data) return undefined;
  return {
    code: data.code,
    channel: data.channel,
    claimedAt: new Date(data.claimed_at),
    belowLevelSince: data.below_level_since
      ? new Date(data.below_level_since)
      : undefined,
  };
}

export const serverHydration: Hydrate<APIServer, HydratedServer> = {
  keyMapping: {
    _id: "id",
    owner: "ownerId",
    channels: "channelIds",
    system_messages: "systemMessages",
    default_permissions: "defaultPermissions",
    approximate_member_count: "approximateMemberCount",
    rules_channel: "rulesChannelId",
    vanity_invite: "vanityInvite",
    verification_level: "verificationLevel",
    threads_disabled: "threadsDisabled",
    forums_disabled: "forumsDisabled",
    invites_paused_until: "invitesPausedUntil",
    dms_paused_until: "dmsPausedUntil",
    rules_screening_since: "rulesScreeningSince",
  } as Hydrate<APIServer, HydratedServer>["keyMapping"],
  functions: {
    id: (server) => server._id,
    ownerId: (server) => server.owner,
    name: (server) => server.name,
    description: (server) => server.description!,
    channelIds: (server) => new ReactiveSet(server.channels),
    categories: (server) => server.categories ?? [],
    systemMessages: (server) => server.system_messages ?? {},
    roles: (server, ctx) =>
      new ReactiveMap(
        Object.keys(server.roles!).map((id) => [
          id,
          new ServerRole(ctx as Client, server._id, id, server.roles![id]),
        ]),
      ),
    defaultPermissions: (server) => BigInt(server.default_permissions),
    icon: (server, ctx) => new File(ctx as Client, server.icon!),
    banner: (server, ctx) => new File(ctx as Client, server.banner!),
    flags: (server) => server.flags!,
    analytics: (server) => server.analytics || false,
    discoverable: (server) => server.discoverable || false,
    threadsDisabled: (server) => server.threads_disabled || false,
    forumsDisabled: (server) => server.forums_disabled || false,
    access: (server) => server.access ?? "Open",
    invitesPausedUntil: (server) => {
      const until = server.invites_paused_until;
      return until ? new Date(until) : undefined;
    },
    rulesScreeningSince: (server) => {
      const since = server.rules_screening_since;
      return since ? new Date(since) : undefined;
    },
    dmsPausedUntil: (server) => {
      const until = server.dms_paused_until;
      return until ? new Date(until) : undefined;
    },
    verificationLevel: (server) => server.verification_level ?? "None",
    nsfw: (server) => server.nsfw || false,
    approximateMemberCount: (server) => server.approximate_member_count ?? 0,
    supercharge: (server) => server.supercharge ?? undefined,
    rulesChannelId: (server) => server.rules_channel ?? undefined,
    stats: (server) => server.stats ?? undefined,
    lobby: (server) => (server.lobby ? withoutNull(server.lobby) : undefined),
    vanityInvite: (server) => hydrateVanityInvite(server.vanity_invite),
  },
  initialHydration: () => ({
    channelIds: new ReactiveSet(),
    roles: new ReactiveMap(),
  }),
};

/**
 * Flags attributed to servers
 */
export enum ServerFlags {
  Official = 1,
  Verified = 2,
}

/** Visual controls use bounded numbers, enums and hex colours, never custom CSS. */
export type LobbyAppearance = WithoutNull<APITypes.LobbyAppearance>;

/** Answering grants public interest roles; it never removes existing roles. */
export type LobbyRoleQuestion = WithoutNull<APITypes.LobbyRoleQuestion>;
