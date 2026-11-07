import type {
  ChannelKind,
  CommandDefinition,
  CommandOption,
  Localizations,
  OptionChoice,
  OptionType,
  SendableEmbed,
} from "./types.js";

type OptionExtras = {
  required?: boolean;
  choices?: OptionChoice[];
  autocomplete?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  channelTypes?: ChannelKind[];
  /** Localized descriptions, e.g. `{ ar: "...", de: "..." }` */
  descriptions?: Localizations;
  /** Localized names */
  names?: Localizations;
};

function option(
  type: OptionType,
  name: string,
  description: string,
  extra: OptionExtras = {},
): CommandOption {
  return {
    type,
    name,
    description,
    required: extra.required,
    choices: extra.choices,
    autocomplete: extra.autocomplete,
    min_value: extra.min,
    max_value: extra.max,
    min_length: extra.minLength,
    max_length: extra.maxLength,
    channel_types: extra.channelTypes,
    name_localizations: extra.names,
    description_localizations: extra.descriptions,
  };
}

/**
 * Builds a slash command without writing the wire format by hand.
 *
 * ```ts
 * new SlashCommandBuilder("ban", "Ban a member")
 *   .describe({ ar: "حظر عضو" })
 *   .user("member", "Who to ban", { required: true })
 *   .string("reason", "Why")
 *   .permissions(Permissions.BanMembers)
 * ```
 */
export class SlashCommandBuilder {
  #definition: CommandDefinition;

  constructor(name: string, description: string) {
    this.#definition = { type: "ChatInput", name, description, options: [] };
  }

  /** Localized names */
  names(map: Localizations) {
    this.#definition.name_localizations = map;
    return this;
  }

  /** Localized descriptions */
  describe(map: Localizations) {
    this.#definition.description_localizations = map;
    return this;
  }

  /** Hide the command from members without these permission bits */
  permissions(bits: number) {
    this.#definition.default_member_permissions = bits;
    return this;
  }

  nsfw(value = true) {
    this.#definition.nsfw = value;
    return this;
  }

  string(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("String", name, description, extra));
  }
  integer(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("Integer", name, description, extra));
  }
  number(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("Number", name, description, extra));
  }
  boolean(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("Boolean", name, description, extra));
  }
  user(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("User", name, description, extra));
  }
  role(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("Role", name, description, extra));
  }
  channel(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("Channel", name, description, extra));
  }
  mentionable(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("Mentionable", name, description, extra));
  }
  attachment(name: string, description: string, extra?: OptionExtras) {
    return this.#add(option("Attachment", name, description, extra));
  }

  /** A sub-command with its own options: `.subcommand("add", "Add", (s) => s.string(...))` */
  subcommand(
    name: string,
    description: string,
    build?: (sub: SlashCommandBuilder) => SlashCommandBuilder,
    extra?: OptionExtras,
  ) {
    const sub = build?.(new SlashCommandBuilder(name, description)).toJSON();
    return this.#add({
      ...option("SubCommand", name, description, extra),
      options: sub?.options ?? [],
    });
  }

  /**
   * A group of sub-commands: `/config roles add`.
   * `build` adds sub-commands with `.subcommand(...)`.
   */
  subcommandGroup(
    name: string,
    description: string,
    build: (group: SlashCommandBuilder) => SlashCommandBuilder,
    extra?: OptionExtras,
  ) {
    const group = build(new SlashCommandBuilder(name, description)).toJSON();
    return this.#add({
      ...option("SubCommandGroup", name, description, extra),
      options: group.options ?? [],
    });
  }

  #add(entry: CommandOption) {
    if (entry.required) {
      // required options must come first
      const first = this.#definition.options!.findIndex((o) => !o.required);
      if (first >= 0) this.#definition.options!.splice(first, 0, entry);
      else this.#definition.options!.push(entry);
    } else {
      this.#definition.options!.push(entry);
    }
    return this;
  }

  toJSON(): CommandDefinition {
    return structuredClone(this.#definition);
  }
}

/** A user or message command (shown in the Apps menu) */
export function contextCommand(
  type: "User" | "Message",
  name: string,
  names?: Localizations,
): CommandDefinition {
  return { type, name, name_localizations: names };
}

/** What the server accepts in embeds (characters) */
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  author: 256,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  /** All embeds of one message together, apart from the message text */
  total: 6000,
} as const;

/** Characters as the server counts them (an emoji or Arabic letter once) */
const characters = (text: string) => [...text].length;

function limited(what: string, text: string, max: number) {
  const length = characters(text);
  if (length < 1 || length > max) {
    throw new RangeError(
      `${what} must be 1 to ${max} characters (got ${length})`,
    );
  }
  return text;
}

/** Links and icons are web addresses only (the server refuses others) */
function webAddress(what: string, url: string) {
  if (!/^https?:\/\/[^/\s]/i.test(url) || /[\s\p{Cc}]/u.test(url)) {
    throw new RangeError(`${what} must be an http or https address`);
  }
  return limited(what, url, 256);
}

/**
 * Visible characters of embeds (title, description, author, fields and
 * footer); all embeds of a message together may hold `EMBED_LIMITS.total`.
 */
export function embedTextLength(
  ...embeds: (SendableEmbed | { toJSON(): SendableEmbed })[]
) {
  return embeds
    .map((embed) => resolve(embed))
    .reduce(
      (total, embed) =>
        total +
        characters(embed.title ?? "") +
        characters(embed.description ?? "") +
        characters(embed.author?.name ?? "") +
        (embed.fields ?? []).reduce(
          (sum, field) =>
            sum + characters(field.name) + characters(field.value),
          0,
        ) +
        characters(embed.footer?.text ?? ""),
      0,
    );
}

/**
 * Builds an embed. Every part is checked against `EMBED_LIMITS` right
 * away, so a mistake shows where it was made instead of as a server error.
 *
 * ```ts
 * new EmbedBuilder().title("Welcome").description("Read the rules first").colour("#E0195F")
 * ```
 */
export class EmbedBuilder {
  #data: SendableEmbed = {};

  title(text: string) {
    this.#data.title = limited("title", text, EMBED_LIMITS.title);
    return this;
  }
  description(text: string) {
    this.#data.description = limited(
      "description",
      text,
      EMBED_LIMITS.description,
    );
    return this;
  }
  /** Link of the title */
  url(url: string) {
    this.#data.url = webAddress("url", url);
    return this;
  }
  /** Small icon next to the title */
  icon(url: string) {
    this.#data.icon_url = webAddress("icon", url);
    return this;
  }
  /** CSS colour, e.g. `#9075FF` */
  colour(value: string) {
    this.#data.colour = value;
    return this;
  }
  /** An uploaded attachment id shown as the embed's image */
  media(attachmentId: string) {
    this.#data.media = attachmentId;
    return this;
  }
  /** An uploaded attachment id shown small at the top end */
  thumbnail(attachmentId: string) {
    this.#data.thumbnail = attachmentId;
    return this;
  }
  /** Line above the title, e.g. who the embed is about */
  author(name: string, options: { iconUrl?: string; url?: string } = {}) {
    this.#data.author = {
      name: limited("author", name, EMBED_LIMITS.author),
      ...(options.iconUrl
        ? { icon_url: webAddress("author icon", options.iconUrl) }
        : {}),
      ...(options.url ? { url: webAddress("author url", options.url) } : {}),
    };
    return this;
  }
  /** Name / value pair; inline fields share a row (up to three) */
  field(name: string, value: string, inline = false) {
    if ((this.#data.fields?.length ?? 0) >= EMBED_LIMITS.fields) {
      throw new RangeError(
        `An embed has at most ${EMBED_LIMITS.fields} fields`,
      );
    }
    limited("field name", name, EMBED_LIMITS.fieldName);
    limited("field value", value, EMBED_LIMITS.fieldValue);
    this.#data.fields = [
      ...(this.#data.fields ?? []),
      inline ? { name, value, inline } : { name, value },
    ];
    return this;
  }
  /** Several fields at once */
  fields(...items: { name: string; value: string; inline?: boolean }[]) {
    for (const item of items) this.field(item.name, item.value, item.inline);
    return this;
  }
  /** Small text at the bottom */
  footer(text: string, iconUrl?: string) {
    limited("footer", text, EMBED_LIMITS.footer);
    this.#data.footer = iconUrl
      ? { text, icon_url: webAddress("footer icon", iconUrl) }
      : { text };
    return this;
  }
  /** Time next to the footer; defaults to now */
  timestamp(time: Date | number | string = new Date()) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime()))
      throw new RangeError("timestamp is not a valid time");
    this.#data.timestamp = date.toISOString();
    return this;
  }
  toJSON(): SendableEmbed {
    return {
      ...this.#data,
      ...(this.#data.fields ? { fields: [...this.#data.fields] } : {}),
    };
  }
}

/**
 * Clickable command in message text: opens the command in the reader's
 * composer. `name` may include a sub-command, e.g. "emoji add".
 */
export const commandMention = (
  name: string,
  command: string | { _id: string },
) => `</${name}:${typeof command === "string" ? command : command._id}>`;

/** Turns builders into plain objects; plain objects pass through */
export function resolve<T>(value: T | { toJSON(): T }): T {
  return typeof (value as { toJSON?: unknown })?.toJSON === "function"
    ? (value as { toJSON(): T }).toJSON()
    : (value as T);
}
