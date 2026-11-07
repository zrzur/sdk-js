/**
 * Wire types of the Zrzur developer platform, from the server's OpenAPI
 * document (`src/api/`) and the gateway protocol (`src/core/protocol.ts`),
 * under the short names bots use.
 */
import type * as API from "../api/types.js";
import { Permission } from "../core/permissions.js";
import type * as Protocol from "../core/protocol.js";

export { Intents, intentBits } from "../core/Gateway.js";

export type Localizations = Record<string, string>;
export type CommandType = API.ApplicationCommandType;
export type OptionType = API.CommandOptionType;
export type ChannelKind = API.CommandChannelType;
export type OptionChoice = API.CommandOptionChoice;
export type CommandOption = API.ApplicationCommandOption;
/** Command definition sent when registering */
export type CommandDefinition = API.DataApplicationCommand;
export type ApplicationCommand = API.ApplicationCommand;

export type ButtonStyle = API.ButtonStyle;
export type SelectOption = API.SelectOption;
export type ComponentRestriction = API.ComponentRestriction;
export type Component = API.Component;
/** An image from the web (shown through the media proxy) or a file of the same message */
export type MediaItem = API.MediaItem;
/** Block of a message or of a form */
export type ComponentBlock = API.ComponentBlock;
export type ActionRow = Extract<ComponentBlock, { type: "ActionRow" }>;
export type Modal = API.Modal;

export type SendableEmbed = API.SendableEmbed;
export type EmbedAuthor = API.EmbedAuthor;
export type EmbedField = API.EmbedField;
export type EmbedFooter = API.EmbedFooter;

export type User = API.User;
export type Member = API.Member;
export type Message = API.Message;

export type InteractionKind = API.InteractionType;
export type OptionValue = API.InteractionOptionValue;
export type InteractionOption = API.InteractionDataOption;
export type Resolved = Protocol.InteractionResolved;
/** A file a user handed to a command */
export type ResolvedFile = API.File;
export type ModalFieldValue = API.ModalFieldValue;
/** Interaction as delivered by the gateway */
export type RawInteraction = Protocol.Interaction;
export type ResponseData = API.InteractionResponseData;
export type CallbackType = API.InteractionCallbackType;

/**
 * Permission bits as numbers, for commands and bots (`Permission` from
 * `@zrzur/sdk` has the same bits as bigints)
 */
export const Permissions = Object.fromEntries(
  Object.entries(Permission).map(([name, bit]) => [name, Number(bit)]),
) as { readonly [Name in keyof typeof Permission]: number };
