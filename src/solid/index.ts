// @zrzur/sdk/solid: the reactive client the Zrzur app uses (SolidJS).
// Everything from @zrzur/sdk is re-exported, so apps need one import.
export * from "../index.js";
export * from "./classes/index.js";
export { Client } from "./Client.js";
export type {
  ClientOptions,
  Events as ClientEvents,
  Session as PrivateSession,
} from "./Client.js";
export * from "./collections/index.js";
export { BotFlags } from "./hydration/bot.js";
export type {
  ForumInformation,
  ForumTag,
  ThreadInformation,
} from "./hydration/channel.js";
export type { MessageInteraction } from "./hydration/message.js";
export { ServerFlags } from "./hydration/server.js";
export type {
  AutoModRule,
  AutoModTrigger,
  LobbyAppearance,
  LobbyRoleQuestion,
  LobbySection,
  ServerAccess,
  ServerJoinRequest,
  ServerLobby,
  ServerNotificationLevel,
  ServerStat,
  ServerVanityInvite,
  ServerVerificationLevel,
} from "./hydration/server.js";
export { UserBadges, UserFlags } from "./hydration/user.js";
export { type WithoutNull, withoutNull } from "./lib/withoutNull.js";
