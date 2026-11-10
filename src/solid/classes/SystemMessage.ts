import { decodeTime } from "ulid";

import type {
  Message as APIMessage,
  SystemMessage as APISystemMessage,
} from "../../api/types.js";
import type { Client } from "../Client.js";

import type { User } from "./User.js";
import { Message } from "./index.js";

/**
 * System Message
 */
export abstract class SystemMessage {
  protected client?: Client;
  readonly type: APISystemMessage["type"] | "raid_alert" | "automod_alert";

  /**
   * Construct System Message
   * @param client Client
   * @param type Type
   */
  constructor(
    client: Client,
    type: APISystemMessage["type"] | "raid_alert" | "automod_alert",
  ) {
    this.client = client;
    this.type = type;
  }

  /**
   * Create an System Message from an API System Message
   * @param client Client
   * @param embed Data
   * @returns System Message
   */
  static from(
    client: Client,
    parent: APIMessage,
    message: APISystemMessage,
  ): SystemMessage {
    switch (message.type) {
      case "text":
        return new TextSystemMessage(client, message);
      case "user_added":
      case "user_remove":
        return new UserModeratedSystemMessage(client, message);
      case "user_joined":
      case "user_left":
      case "user_kicked":
      case "user_banned":
        return new UserSystemMessage(client, message);
      case "channel_renamed":
        return new ChannelRenamedSystemMessage(client, message);
      case "channel_description_changed":
      case "channel_icon_changed":
        return new ChannelEditSystemMessage(client, message);
      case "channel_ownership_changed":
        return new ChannelOwnershipChangeSystemMessage(client, message);
      case "message_pinned":
      case "message_unpinned":
        return new MessagePinnedSystemMessage(client, message);
      case "call_started":
        return new CallStartedSystemMessage(client, parent, message);
      case "poll_ended":
        return new PollEndedSystemMessage(client, message);
      case "event_started":
        return new EventStartedSystemMessage(client, message, parent.channel);
      default:
        // newer than the API types
        if ((message as { type: string }).type === "automod_alert") {
          return new AutoModAlertSystemMessage(
            client,
            message as unknown as {
              user: string;
              rule: string;
              channel: string;
              content: string;
            },
          );
        }
        if ((message as { type: string }).type === "raid_alert") {
          return new RaidAlertSystemMessage(
            client,
            message as unknown as { joins: number; minutes: number },
          );
        }
        return new TextSystemMessage(client, {
          type: "text",
          content: `${(message as { type: string }).type} is not supported.`,
        });
    }
  }
}

/**
 * Text System Message
 */
export class TextSystemMessage extends SystemMessage {
  readonly content: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & { type: "text" },
  ) {
    super(client, systemMessage.type);
    this.content = systemMessage.content;
  }
}

/**
 * User System Message
 */
export class UserSystemMessage extends SystemMessage {
  readonly userId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type:
        | "user_added"
        | "user_remove"
        | "user_joined"
        | "user_left"
        | "user_kicked"
        | "user_banned";
    },
  ) {
    super(client, systemMessage.type);
    this.userId = systemMessage.id;
  }

  /**
   * User this message concerns
   */
  get user(): User | undefined {
    return this.client!.users.get(this.userId);
  }
}

/**
 * User Moderated System Message
 */
export class UserModeratedSystemMessage extends UserSystemMessage {
  readonly byId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "user_added" | "user_remove";
    },
  ) {
    super(client, systemMessage);
    this.byId = systemMessage.by;
  }

  /**
   * User this action was performed by
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Channel Edit System Message
 */
export class ChannelEditSystemMessage extends SystemMessage {
  readonly byId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type:
        | "channel_renamed"
        | "channel_description_changed"
        | "channel_icon_changed";
    },
  ) {
    super(client, systemMessage.type);
    this.byId = systemMessage.by;
  }

  /**
   * User this action was performed by
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Channel Renamed System Message
 */
export class ChannelRenamedSystemMessage extends ChannelEditSystemMessage {
  readonly name: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "channel_renamed";
    },
  ) {
    super(client, systemMessage);
    this.name = systemMessage.name;
  }
}

/**
 * Channel Ownership Change System Message
 */
export class ChannelOwnershipChangeSystemMessage extends SystemMessage {
  readonly fromId: string;
  readonly toId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "channel_ownership_changed";
    },
  ) {
    super(client, systemMessage.type);
    this.fromId = systemMessage.from;
    this.toId = systemMessage.to;
  }

  /**
   * User giving away channel ownership
   */
  get from(): User | undefined {
    return this.client!.users.get(this.fromId);
  }

  /**
   * User receiving channel ownership
   */
  get to(): User | undefined {
    return this.client!.users.get(this.toId);
  }
}

/**
 * Message Pinned System Message
 */
export class MessagePinnedSystemMessage extends SystemMessage {
  readonly messageId: string;
  readonly byId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & {
      type: "message_pinned" | "message_unpinned";
    },
  ) {
    super(client, systemMessage.type);
    this.messageId = systemMessage.id;
    this.byId = systemMessage.by;
  }

  /**
   * Message that was pinned/unpinned
   */
  get message(): Message | undefined {
    return this.client!.messages.get(this.messageId);
  }

  /**
   * User that pinned/unpinned
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Call Started System Message
 */
export class CallStartedSystemMessage extends SystemMessage {
  readonly byId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /**
   * Construct System Message
   * @param client Client
   * @param parent Message
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    parent: APIMessage,
    systemMessage: APISystemMessage & {
      type: "call_started";
    },
  ) {
    super(client, systemMessage.type);
    this.byId = systemMessage.by;
    this.startedAt = new Date(decodeTime(parent._id));
    this.finishedAt =
      systemMessage.finished_at != null
        ? new Date(systemMessage.finished_at)
        : null;
  }

  /**
   * User that started the call
   */
  get by(): User | undefined {
    return this.client!.users.get(this.byId);
  }
}

/**
 * Raid alert: many people joined in a short time. Members with Manage
 * Server are offered to pause invites.
 */
export class RaidAlertSystemMessage extends SystemMessage {
  readonly joins: number;
  readonly minutes: number;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: { joins: number; minutes: number },
  ) {
    super(client, "raid_alert");
    this.joins = systemMessage.joins;
    this.minutes = systemMessage.minutes;
  }
}

/**
 * AutoMod flagged a message (posted in the rule's alert channel)
 */
export class AutoModAlertSystemMessage extends SystemMessage {
  readonly userId: string;
  readonly rule: string;
  readonly channelId: string;
  readonly content: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: {
      user: string;
      rule: string;
      channel: string;
      content: string;
    },
  ) {
    super(client, "automod_alert");
    this.userId = systemMessage.user;
    this.rule = systemMessage.rule;
    this.channelId = systemMessage.channel;
    this.content = systemMessage.content;
  }
}

/**
 * A poll closed: a reply to the poll's message naming the winning answers
 * (Zrzur)
 */
export class PollEndedSystemMessage extends SystemMessage {
  /** Id of the message with the poll */
  readonly messageId: string;
  /** The poll's question */
  readonly question: string;
  /** Answers with the most votes: more than one is a tie, none means nobody voted */
  readonly winners: string[];
  /** Votes of each winning answer */
  readonly votes: number;
  /** Votes of every answer together */
  readonly total: number;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & { type: "poll_ended" },
  ) {
    super(client, "poll_ended");
    this.messageId = systemMessage.id;
    this.question = systemMessage.question;
    this.winners = systemMessage.winners ?? [];
    this.votes = systemMessage.votes ?? 0;
    this.total = systemMessage.total ?? 0;
  }
}

/**
 * A scheduled server event started (posted in the join message channel)
 */
export class EventStartedSystemMessage extends SystemMessage {
  readonly eventId: string;
  readonly title: string;
  /** Channel the message was posted in */
  readonly channelId: string;

  /**
   * Construct System Message
   * @param client Client
   * @param systemMessage System Message
   */
  constructor(
    client: Client,
    systemMessage: APISystemMessage & { type: "event_started" },
    channelId: string,
  ) {
    super(client, "event_started");
    this.eventId = systemMessage.id;
    this.title = systemMessage.title;
    this.channelId = channelId;
  }

  /**
   * Server of the event (the server of the channel it was posted in)
   */
  get serverId(): string | undefined {
    return this.client?.channels.get(this.channelId)?.serverId;
  }
}
