import type * as APITypes from "../api/types.js";
import type {
  Channel,
  ChannelUnread,
  Emoji,
  Error,
  FieldsChannel,
  FieldsMember,
  FieldsServer,
  FieldsUser,
  Member,
  MemberCompositeKey,
  Message,
  RelationshipStatus,
  Role,
  Server,
  User,
} from "../api/types.js";

/** Age group of an account */
export type AgeBand = APITypes.AgeBand;

/**
 * Version 1 of the events protocol
 */
export type ProtocolV1 = {
  client: ClientMessage;
  server: ServerMessage;

  types: {
    policyChange: PolicyChange;
  };
};

/**
 * Messages sent to the server
 */
export type ClientMessage =
  | { type: "Authenticate"; token: string; intents?: number }
  | {
      type: "BeginTyping";
      channel: string;
    }
  | {
      type: "EndTyping";
      channel: string;
    }
  | {
      type: "Ping";
      data: number;
    }
  | {
      type: "Pong";
      data: number;
    };

/**
 * Messages sent from the server
 */
export type ServerMessage =
  | { type: "Error"; data: Error }
  | { type: "InteractionCreate"; interaction: Interaction }
  | {
      type: "InteractionStateUpdate";
      id: string;
      channel_id: string;
      state: InteractionState;
      message_id?: string;
    }
  | { type: "EphemeralMessageCreate"; message: EphemeralMessage }
  | { type: "EphemeralMessageUpdate"; message: EphemeralMessage }
  | { type: "EphemeralMessageDelete"; id: string; channel_id: string }
  | {
      type: "InteractionModal";
      id: string;
      channel_id: string;
      modal: APITypes.Modal;
    }
  | {
      type: "InteractionAutocompleteResult";
      id: string;
      choices: APITypes.CommandOptionChoice[];
    }
  | {
      type: "ApplicationCommandsUpdate";
      application_id: string;
      server_id: string;
    }
  | { type: "Bulk"; v: ServerMessage[] }
  | { type: "Authenticated" }
  | ({ type: "Ready" } & Partial<ReadyData>)
  | { type: "Ping"; data: number }
  | { type: "Pong"; data: number }
  | ({ type: "Message" } & Message)
  | {
      type: "MessageUpdate";
      id: string;
      channel: string;
      data: Partial<Message>;
    }
  | {
      type: "MessageAppend";
      id: string;
      channel: string;
      append: Pick<Partial<Message>, "embeds">;
    }
  | { type: "MessageDelete"; id: string; channel: string }
  | {
      type: "MessageReact";
      id: string;
      channel_id: string;
      user_id: string;
      emoji_id: string;
    }
  | {
      type: "MessageUnreact";
      id: string;
      channel_id: string;
      user_id: string;
      emoji_id: string;
    }
  | {
      type: "MessageRemoveReaction";
      id: string;
      channel_id: string;
      emoji_id: string;
    }
  | { type: "BulkMessageDelete"; channel: string; ids: string[] }
  | ({ type: "ChannelCreate" } & Channel)
  | {
      type: "ChannelUpdate";
      id: string;
      data: Partial<Channel>;
      clear?: FieldsChannel[];
    }
  | { type: "ChannelDelete"; id: string }
  | { type: "ChannelGroupJoin"; id: string; user: string }
  | { type: "ChannelGroupLeave"; id: string; user: string }
  | { type: "Logout" }
  | { type: "Bees" }
  | { type: "EmojiUpdate"; id: string; data: Partial<APITypes.Emoji> }
  | { type: "ReportCreate"; _id: string }
  | {
      type: "VoiceCallUpdate";
      initiator_id: string;
      channel_id: string;
      started_at?: string | null;
      ended: boolean;
    }
  | { type: "ChannelStartTyping"; id: string; user: string }
  | { type: "ChannelStopTyping"; id: string; user: string }
  | { type: "ChannelAck"; id: string; user: string; message_id: string }
  | {
      type: "ServerCreate";
      id: string;
      server: Server;
      channels: Channel[];
    }
  | {
      type: "ServerUpdate";
      id: string;
      data: Partial<Server>;
      clear?: FieldsServer[];
    }
  | { type: "ServerDelete"; id: string }
  | {
      type: "ServerMemberUpdate";
      id: MemberCompositeKey;
      data: Partial<Member>;
      clear?: FieldsMember[];
    }
  | { type: "ServerMemberJoin"; id: string; user: string }
  | { type: "ServerMemberLeave"; id: string; user: string }
  | {
      type: "ServerRoleUpdate";
      id: string;
      role_id: string;
      data: Partial<Role>;
    }
  | { type: "ServerRoleRanksUpdate"; id: string; ranks: string[] }
  | { type: "ServerRoleDelete"; id: string; role_id: string }
  | {
      type: "UserUpdate";
      id: string;
      data: Partial<User>;
      clear?: FieldsUser[];
    }
  | { type: "UserRelationship"; user: User; status: RelationshipStatus }
  | { type: "UserPresence"; id: string; online: boolean }
  | {
      type: "UserSettingsUpdate";
      id: string;
      update: { [key: string]: [number, string] };
    }
  | { type: "UserPlatformWipe"; user_id: string; flags: number }
  | ({ type: "EmojiCreate" } & Emoji)
  | { type: "EmojiDelete"; id: string }
  | { type: "AccountAgeUpdate"; band: AgeBand }
  | ({
      type: "Auth";
    } & (
      | {
          event_type: "DeleteSession";
          user_id: string;
          session_id: string;
        }
      | {
          event_type: "DeleteAllSessions";
          user_id: string;
          exclude_session_id: string;
        }
    ))
  | {
      type: "VoiceChannelJoin";
      id: string;
      state: UserVoiceState;
    }
  | {
      type: "VoiceChannelLeave";
      id: string;
      user: string;
    }
  | {
      type: "VoiceChannelMove";
      user: string;
      from: string;
      to: string;
      state: UserVoiceState;
    }
  | {
      type: "UserVoiceStateUpdate";
      id: string;
      channel_id: string;
      data: Partial<UserVoiceState>;
    }
  | {
      type: "UserMoveVoiceChannel";
      node: string;
      from: string;
      to: string;
      token: string;
    }
  | {
      type: "UserSlowmodes";
      slowmodes: UserSlowmodes[];
    };

/**
 * Policy change type
 */
export type PolicyChange = {
  created_time: string;
  effective_time: string;
  description: string;
  url: string;
};

/**
 * Voice state for a user
 */
export type UserVoiceState = {
  id: string;
  joined_at: number;
  is_receiving: boolean;
  is_publishing: boolean;
  screensharing: boolean;
  camera: boolean;
};

/**
 * Voice state for a channel
 */
export type ChannelVoiceState = {
  id: string;
  participants: UserVoiceState[];
};

/**
 * Channel slowmodes for the active user
 */
export type UserSlowmodes = {
  channel_id: string;
  duration: number;
  retry_after: number;
  receivedAt?: number;
};

/**
 * Initial synchronisation packet
 */
export type ReadyData = {
  users: User[];
  servers: Server[];
  channels: Channel[];
  members: Member[];
  emojis: Emoji[];
  voice_states: ChannelVoiceState[];

  user_settings: Record<string, unknown>;
  channel_unreads: ChannelUnread[];

  policy_changes: PolicyChange[];
};

/* Interactions (gateway only, so not in the OpenAPI document) */

/** Users, members, roles, channels and files an interaction refers to */
export type InteractionResolved = {
  users?: Record<string, User>;
  members?: Record<string, Member>;
  roles?: Record<string, Role>;
  channels?: Record<string, Channel>;
  /** Files given to `Attachment` options, by file id */
  attachments?: Record<string, APITypes.File>;
};

/** An interaction as the gateway delivers it to the bot (`InteractionCreate`) */
export type Interaction = {
  _id: string;
  /** Protocol version */
  version: number;
  application_id: string;
  type: APITypes.InteractionType;
  /** Token for the callback, edits and follow-ups; only sent to the bot */
  token?: string;
  /** User who triggered the interaction */
  user: User;
  member?: Member;
  server_id?: string;
  channel_id: string;
  /** The user's effective permissions in the channel */
  user_permissions: number;
  /** The bot's effective permissions in the channel */
  app_permissions: number;
  /** Decimal strings of the two values above; lose no bits in JavaScript. Absent on older servers. */
  user_permissions_string?: string;
  app_permissions_string?: string;
  locale?: string;
  command?: {
    id: string;
    name: string;
    type: APITypes.ApplicationCommandType;
    /** Command revision the user saw */
    version: string;
    options?: APITypes.InteractionDataOption[];
    /** Target user or message of a context menu command */
    target_id?: string;
    /** Autocomplete only: the option being typed into */
    focused?: string;
    resolved?: InteractionResolved;
  };
  /** Message the component sits on (components, and modals opened from one) */
  message_id?: string;
  /** Whether `message_id` is an ephemeral message */
  message_ephemeral?: boolean;
  component?: {
    custom_id: string;
    /** `Button`, `StringSelect`, `UserSelect`, `RoleSelect`, `MentionableSelect` or `ChannelSelect` */
    component_type: string;
    /** Chosen values of a select */
    values?: string[];
    resolved?: InteractionResolved;
  };
  modal?: {
    custom_id: string;
    fields: APITypes.ModalFieldValue[];
    resolved?: InteractionResolved;
  };
  /** The bot must call back before this time */
  respond_by: string;
  /** The token stops working at this time */
  expires_at: string;
};

/** Progress of an interaction, sent to the user who started it */
export type InteractionState =
  | "Deferred"
  | "DeferredUpdate"
  | "Responded"
  | "Failed";

/** A message only the invoking user sees; never stored in the channel */
export type EphemeralMessage = {
  _id: string;
  interaction_id: string;
  author: string;
  channel_id: string;
  content?: string;
  embeds?: APITypes.SendableEmbed[];
  components?: APITypes.ComponentBlock[];
  edited?: string;
};
