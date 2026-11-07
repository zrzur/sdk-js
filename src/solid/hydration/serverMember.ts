import type {
  Member as APIMember,
  MemberCompositeKey,
} from "../../api/types.js";
import type { Client } from "../Client.js";
import { File } from "../classes/File.js";
import type { Merge } from "../lib/merge.js";

import type { Hydrate } from "./index.js";

export type HydratedServerMember = {
  id: MemberCompositeKey;
  joinedAt: Date;
  nickname?: string;
  avatar?: File;
  pronouns?: string;
  roles: string[];
  timeout?: Date;
  canPublish?: boolean;
  canReceive?: boolean;
  /** When the member accepted the server rules (rules screening) */
  acceptedRulesAt?: Date;
};

export const serverMemberHydration: Hydrate<
  Merge<APIMember>,
  HydratedServerMember
> = {
  keyMapping: {
    _id: "id",
    joined_at: "joinedAt",
    can_publish: "canPublish",
    can_receive: "canReceive",
  },
  functions: {
    id: (member) => member._id,
    joinedAt: (member) => new Date(member.joined_at),
    nickname: (member) => member.nickname!,
    avatar: (member, ctx) => new File(ctx as Client, member.avatar!),
    pronouns: (member) => member.pronouns!,
    roles: (member) => member.roles,
    timeout: (member) => new Date(member.timeout!),
    canPublish: (member) => member.can_publish ?? undefined,
    canReceive: (member) => member.can_receive ?? undefined,
    acceptedRulesAt: (member) => {
      const at = member.accepted_rules_at;
      return at ? new Date(at) : undefined;
    },
  },
  initialHydration: () => ({
    roles: [],
  }),
};

// newer than the API types: when the member accepted the rules
(serverMemberHydration.keyMapping as Record<string, string>).accepted_rules_at =
  "acceptedRulesAt";
