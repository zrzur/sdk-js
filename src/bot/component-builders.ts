/**
 * Builders for buttons, menus and forms, and the numbered enums they use:
 * `new ButtonBuilder().setCustomId("next").setLabel("Next")
 * .setStyle(ButtonStyle.Primary)`. `toJSON()` gives the wire format, and
 * every place that takes components or a form also takes a builder.
 */
import type {
  ChannelKind,
  Component,
  ComponentBlock,
  Modal,
  SelectOption,
  ButtonStyle as WireButtonStyle,
} from "./types.js";

export const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
} as const;
/** A style by number (`ButtonStyle.Primary`) or by name (`"Primary"`) */
export type ButtonStyle =
  | WireButtonStyle
  | (typeof ButtonStyle)[keyof typeof ButtonStyle];

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  Container: 17,
  Label: 18,
  FileUpload: 19,
} as const;
export type ComponentType = (typeof ComponentType)[keyof typeof ComponentType];

export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;
export type TextInputStyle =
  (typeof TextInputStyle)[keyof typeof TextInputStyle];

/** Only `Ephemeral` changes anything on Zrzur */
export const MessageFlags = {
  SuppressEmbeds: 4,
  Ephemeral: 64,
  SuppressNotifications: 4096,
} as const;

/** The two kinds of Zrzur channels, for `setChannelTypes` */
export const ChannelType = { GuildText: 0, GuildVoice: 2 } as const;

/** `client.on(Events.InteractionCreate, …)` */
export const Events = { InteractionCreate: "interactionCreate" } as const;

/** Wire names by component number, and back */
const WIRE_TYPE: Record<number, string> = {
  1: "ActionRow",
  2: "Button",
  3: "StringSelect",
  4: "TextInput",
  5: "UserSelect",
  6: "RoleSelect",
  7: "MentionableSelect",
  8: "ChannelSelect",
  10: "Text",
  14: "Separator",
  17: "Container",
  18: "Field",
};
export function componentTypeOf(wire: string): ComponentType | undefined {
  const entry = Object.entries(WIRE_TYPE).find(([, name]) => name === wire);
  return entry ? (Number(entry[0]) as ComponentType) : undefined;
}

const STYLE_NAMES = [
  "",
  "Primary",
  "Secondary",
  "Success",
  "Danger",
  "Link",
] as const;
function styleName(style: ButtonStyle): WireButtonStyle {
  if (typeof style === "number") {
    const name = STYLE_NAMES[style];
    if (!name) throw new RangeError(`Unknown button style ${style}`);
    return name as WireButtonStyle;
  }
  return (style.charAt(0).toUpperCase() + style.slice(1)) as WireButtonStyle;
}

/** An emoji: "🎮", a custom emoji id, its text form "<:name:id>", or { id, name } */
export type EmojiInput =
  | string
  | { id?: string | null; name?: string | null; animated?: boolean };
function emojiValue(emoji: EmojiInput): string {
  if (typeof emoji === "string")
    return emoji.match(/^<a?:\w+:([0-9A-Za-z]+)>$/)?.[1] ?? emoji;
  const value = emoji.id ?? emoji.name;
  if (!value) throw new TypeError("An emoji needs an id or a name");
  return value;
}

function channelKind(type: number | ChannelKind): ChannelKind {
  if (type === "Text" || type === ChannelType.GuildText) return "Text";
  if (type === "Voice" || type === ChannelType.GuildVoice) return "Voice";
  throw new RangeError(
    `Zrzur has text (0) and voice (2) channels only, not ${type}`,
  );
}

/** Lists may be passed spread or as one array */
type RestOrArray<T> = T[] | [T[]];
const flat = <T>(items: RestOrArray<T>): T[] =>
  (items.length === 1 && Array.isArray(items[0]) ? items[0] : items) as T[];

type Wire<T extends string> = Extract<Component, { type: T }>;
type ButtonData = Partial<Omit<Wire<"Button">, "style" | "emoji">> & {
  style?: ButtonStyle;
  emoji?: EmojiInput | null;
};

export class ButtonBuilder {
  readonly data: Partial<Wire<"Button">>;

  constructor(data: ButtonData = {}) {
    this.data = {
      ...data,
      type: "Button",
      style: data.style === undefined ? undefined : styleName(data.style),
      emoji: data.emoji == null ? undefined : emojiValue(data.emoji),
    };
  }
  static from(other: ButtonBuilder | ButtonData) {
    return new ButtonBuilder(
      other instanceof ButtonBuilder ? other.toJSON() : other,
    );
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setStyle(style: ButtonStyle) {
    this.data.style = styleName(style);
    return this;
  }
  setEmoji(emoji: EmojiInput) {
    this.data.emoji = emojiValue(emoji);
    return this;
  }
  setURL(url: string) {
    this.data.url = url;
    return this;
  }
  setDisabled(disabled = true) {
    this.data.disabled = disabled;
    return this;
  }
  /** Zrzur only: who may press it (users and/or roles) */
  setRestrict(restrict: { users?: string[]; roles?: string[] }) {
    this.data.restrict = restrict;
    return this;
  }
  toJSON(): Wire<"Button"> {
    const data = this.data;
    if (!data.style)
      throw new TypeError(
        "A button needs a style: setStyle(ButtonStyle.Primary)",
      );
    if (data.style === "Link") {
      if (!data.url) throw new TypeError("A link button needs setURL(...)");
      if (data.custom_id)
        throw new TypeError("A link button can't have a custom id");
    } else if (!data.custom_id) {
      throw new TypeError(
        "A button needs setCustomId(...) (link buttons need setURL)",
      );
    }
    if (!data.label && !data.emoji)
      throw new TypeError("A button needs a label or an emoji");
    return { ...data } as Wire<"Button">;
  }
}

type OptionData = Omit<SelectOption, "emoji"> & { emoji?: EmojiInput | null };

export class StringSelectMenuOptionBuilder {
  readonly data: Partial<SelectOption>;
  constructor(data: Partial<OptionData> = {}) {
    this.data = {
      ...data,
      emoji: data.emoji == null ? undefined : emojiValue(data.emoji),
    };
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setValue(value: string) {
    this.data.value = value;
    return this;
  }
  setDescription(description: string) {
    this.data.description = description;
    return this;
  }
  setEmoji(emoji: EmojiInput) {
    this.data.emoji = emojiValue(emoji);
    return this;
  }
  setDefault(isDefault = true) {
    this.data.default = isDefault;
    return this;
  }
  toJSON(): SelectOption {
    if (!this.data.label || !this.data.value)
      throw new TypeError("A menu option needs a label and a value");
    return { ...this.data } as SelectOption;
  }
}

type SelectKind =
  | "StringSelect"
  | "UserSelect"
  | "RoleSelect"
  | "MentionableSelect"
  | "ChannelSelect";

/** Every menu's fields in one shape (the wire type picks what is sent) */
interface SelectData<T extends SelectKind> {
  type: T;
  custom_id?: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
  restrict?: { users?: string[]; roles?: string[] };
  options?: SelectOption[];
  default_values?: string[];
  channel_types?: ChannelKind[];
}

abstract class BaseSelectMenuBuilder<T extends SelectKind> {
  readonly data: SelectData<T>;
  constructor(type: T, data: Partial<Wire<T>> = {}) {
    this.data = { ...(data as Omit<SelectData<T>, "type">), type };
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  setPlaceholder(placeholder: string) {
    this.data.placeholder = placeholder;
    return this;
  }
  setMinValues(minValues: number) {
    this.data.min_values = minValues;
    return this;
  }
  setMaxValues(maxValues: number) {
    this.data.max_values = maxValues;
    return this;
  }
  setDisabled(disabled = true) {
    this.data.disabled = disabled;
    return this;
  }
  /** Zrzur only: who may use it (users and/or roles) */
  setRestrict(restrict: { users?: string[]; roles?: string[] }) {
    this.data.restrict = restrict;
    return this;
  }
  toJSON(): Wire<T> {
    if (!this.data.custom_id)
      throw new TypeError("A menu needs setCustomId(...)");
    return { ...this.data } as unknown as Wire<T>;
  }
}

export class StringSelectMenuBuilder extends BaseSelectMenuBuilder<"StringSelect"> {
  constructor(
    data: Partial<Omit<Wire<"StringSelect">, "options">> & {
      options?: (OptionData | StringSelectMenuOptionBuilder)[];
    } = {},
  ) {
    super("StringSelect", {
      ...data,
      options: (data.options ?? []).map(toOption),
    } as Partial<Wire<"StringSelect">>);
  }
  static from(other: StringSelectMenuBuilder | Partial<Wire<"StringSelect">>) {
    return new StringSelectMenuBuilder(
      other instanceof StringSelectMenuBuilder ? other.toJSON() : other,
    );
  }
  get options() {
    return this.data.options ?? [];
  }
  addOptions(
    ...options: RestOrArray<OptionData | StringSelectMenuOptionBuilder>
  ) {
    this.data.options = [...this.options, ...flat(options).map(toOption)];
    return this;
  }
  setOptions(
    ...options: RestOrArray<OptionData | StringSelectMenuOptionBuilder>
  ) {
    this.data.options = flat(options).map(toOption);
    return this;
  }
  spliceOptions(
    index: number,
    deleteCount: number,
    ...options: RestOrArray<OptionData | StringSelectMenuOptionBuilder>
  ) {
    const list = [...this.options];
    list.splice(index, deleteCount, ...flat(options).map(toOption));
    this.data.options = list;
    return this;
  }
}
function toOption(
  option: OptionData | StringSelectMenuOptionBuilder,
): SelectOption {
  return option instanceof StringSelectMenuOptionBuilder
    ? option.toJSON()
    : new StringSelectMenuOptionBuilder(option).toJSON();
}

/** Default picks: ids spread or as one array */
abstract class DefaultsSelectMenuBuilder<
  T extends Exclude<SelectKind, "StringSelect">,
> extends BaseSelectMenuBuilder<T> {
  protected setDefaults(ids: string[]) {
    this.data.default_values = ids;
    return this;
  }
  protected addDefaults(ids: string[]) {
    const data = this.data as { default_values?: string[] };
    data.default_values = [...(data.default_values ?? []), ...ids];
    return this;
  }
}

export class UserSelectMenuBuilder extends DefaultsSelectMenuBuilder<"UserSelect"> {
  constructor(data: Partial<Wire<"UserSelect">> = {}) {
    super("UserSelect", data);
  }
  setDefaultUsers(...users: RestOrArray<string>) {
    return this.setDefaults(flat(users));
  }
  addDefaultUsers(...users: RestOrArray<string>) {
    return this.addDefaults(flat(users));
  }
}
export class RoleSelectMenuBuilder extends DefaultsSelectMenuBuilder<"RoleSelect"> {
  constructor(data: Partial<Wire<"RoleSelect">> = {}) {
    super("RoleSelect", data);
  }
  setDefaultRoles(...roles: RestOrArray<string>) {
    return this.setDefaults(flat(roles));
  }
  addDefaultRoles(...roles: RestOrArray<string>) {
    return this.addDefaults(flat(roles));
  }
}
export class MentionableSelectMenuBuilder extends DefaultsSelectMenuBuilder<"MentionableSelect"> {
  constructor(data: Partial<Wire<"MentionableSelect">> = {}) {
    super("MentionableSelect", data);
  }
  /** `{ id, type: "user" | "role" }` or plain ids */
  setDefaultValues(...values: RestOrArray<string | { id: string }>) {
    return this.setDefaults(
      flat(values).map((v) => (typeof v === "string" ? v : v.id)),
    );
  }
  addDefaultUsers(...users: RestOrArray<string>) {
    return this.addDefaults(flat(users));
  }
  addDefaultRoles(...roles: RestOrArray<string>) {
    return this.addDefaults(flat(roles));
  }
}
export class ChannelSelectMenuBuilder extends DefaultsSelectMenuBuilder<"ChannelSelect"> {
  constructor(data: Partial<Wire<"ChannelSelect">> = {}) {
    super("ChannelSelect", data);
  }
  setChannelTypes(...types: RestOrArray<number | ChannelKind>) {
    this.data.channel_types = [...new Set(flat(types).map(channelKind))];
    return this;
  }
  addChannelTypes(...types: RestOrArray<number | ChannelKind>) {
    this.data.channel_types = [
      ...new Set([
        ...(this.data.channel_types ?? []),
        ...flat(types).map(channelKind),
      ]),
    ];
    return this;
  }
  setDefaultChannels(...channels: RestOrArray<string>) {
    return this.setDefaults(flat(channels));
  }
  addDefaultChannels(...channels: RestOrArray<string>) {
    return this.addDefaults(flat(channels));
  }
}

export class TextInputBuilder {
  readonly data: Partial<Wire<"TextInput">>;
  constructor(
    data: Partial<Omit<Wire<"TextInput">, "style">> & {
      style?: TextInputStyle | "Short" | "Paragraph";
    } = {},
  ) {
    this.data = {
      ...data,
      type: "TextInput",
      style: data.style === undefined ? undefined : textStyle(data.style),
    };
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  /** Shown above the field (inside a `LabelBuilder` the label's text is used) */
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setStyle(style: TextInputStyle | "Short" | "Paragraph") {
    this.data.style = textStyle(style);
    return this;
  }
  setPlaceholder(placeholder: string) {
    this.data.placeholder = placeholder;
    return this;
  }
  setMinLength(minLength: number) {
    this.data.min_length = minLength;
    return this;
  }
  setMaxLength(maxLength: number) {
    this.data.max_length = maxLength;
    return this;
  }
  setValue(value: string) {
    this.data.value = value;
    return this;
  }
  setRequired(required = true) {
    this.data.required = required;
    return this;
  }
  toJSON(): Wire<"TextInput"> {
    if (!this.data.custom_id)
      throw new TypeError("A text input needs setCustomId(...)");
    return { style: "Short", ...this.data } as Wire<"TextInput">;
  }
}
function textStyle(style: TextInputStyle | "Short" | "Paragraph") {
  return style === TextInputStyle.Paragraph || style === "Paragraph"
    ? "Paragraph"
    : "Short";
}

type AnyComponentBuilder =
  | ButtonBuilder
  | StringSelectMenuBuilder
  | UserSelectMenuBuilder
  | RoleSelectMenuBuilder
  | MentionableSelectMenuBuilder
  | ChannelSelectMenuBuilder
  | TextInputBuilder;

/** A builder for a wire component, as `ActionRowBuilder.from` needs */
export function createComponentBuilder(
  component: Component | AnyComponentBuilder,
): AnyComponentBuilder {
  if (typeof (component as { toJSON?: unknown }).toJSON === "function")
    return component as AnyComponentBuilder;
  const data = component as Component;
  switch (data.type) {
    case "Button":
      return new ButtonBuilder(data);
    case "StringSelect":
      return new StringSelectMenuBuilder(data);
    case "UserSelect":
      return new UserSelectMenuBuilder(data);
    case "RoleSelect":
      return new RoleSelectMenuBuilder(data);
    case "MentionableSelect":
      return new MentionableSelectMenuBuilder(data);
    case "ChannelSelect":
      return new ChannelSelectMenuBuilder(data);
    case "TextInput":
      return new TextInputBuilder(data);
    default:
      throw new TypeError(
        `No builder for a ${(data as { type: string }).type} component`,
      );
  }
}

export class ActionRowBuilder<
  T extends AnyComponentBuilder = AnyComponentBuilder,
> {
  readonly components: T[];
  constructor(data: { components?: (Component | T)[] } = {}) {
    this.components = (data.components ?? []).map(
      (c) => createComponentBuilder(c as Component) as T,
    );
  }
  /** A row from a message (`interaction.message.components`) or another builder */
  static from<T extends AnyComponentBuilder = AnyComponentBuilder>(
    row:
      | ActionRowBuilder<T>
      | { type?: string | number; components: (Component | T)[] },
  ) {
    return new ActionRowBuilder<T>(
      row instanceof ActionRowBuilder ? { components: row.components } : row,
    );
  }
  addComponents(...components: RestOrArray<T>) {
    this.components.push(...flat(components));
    return this;
  }
  setComponents(...components: RestOrArray<T>) {
    this.components.splice(0, this.components.length, ...flat(components));
    return this;
  }
  spliceComponents(index: number, deleteCount: number, ...components: T[]) {
    this.components.splice(index, deleteCount, ...components);
    return this;
  }
  toJSON(): ComponentBlock {
    return {
      type: "ActionRow",
      components: this.components.map((c) => c.toJSON() as Component),
    } as ComponentBlock;
  }
}

/** A labelled form field, with a line of help */
export class LabelBuilder {
  readonly data: {
    label?: string;
    description?: string;
    component?: AnyComponentBuilder;
  } = {};
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setDescription(description: string) {
    this.data.description = description;
    return this;
  }
  setTextInputComponent(
    input: TextInputBuilder | ((b: TextInputBuilder) => TextInputBuilder),
  ) {
    this.data.component =
      typeof input === "function" ? input(new TextInputBuilder()) : input;
    return this;
  }
  setStringSelectMenuComponent(
    menu:
      | StringSelectMenuBuilder
      | ((b: StringSelectMenuBuilder) => StringSelectMenuBuilder),
  ) {
    this.data.component =
      typeof menu === "function" ? menu(new StringSelectMenuBuilder()) : menu;
    return this;
  }
  setUserSelectMenuComponent(menu: UserSelectMenuBuilder) {
    this.data.component = menu;
    return this;
  }
  setRoleSelectMenuComponent(menu: RoleSelectMenuBuilder) {
    this.data.component = menu;
    return this;
  }
  setChannelSelectMenuComponent(menu: ChannelSelectMenuBuilder) {
    this.data.component = menu;
    return this;
  }
  setMentionableSelectMenuComponent(menu: MentionableSelectMenuBuilder) {
    this.data.component = menu;
    return this;
  }
  toJSON(): ComponentBlock {
    if (!this.data.label || !this.data.component)
      throw new TypeError("A label needs setLabel(...) and a component");
    const component = this.data.component.toJSON() as Component & {
      label?: string;
    };
    delete component.label;
    return {
      type: "Field",
      label: this.data.label,
      description: this.data.description,
      component,
    } as ComponentBlock;
  }
}

/** A paragraph in a form or message */
export class TextDisplayBuilder {
  readonly data: { content?: string } = {};
  setContent(content: string) {
    this.data.content = content;
    return this;
  }
  toJSON(): ComponentBlock {
    if (!this.data.content)
      throw new TypeError("A text display needs setContent(...)");
    return { type: "Text", content: this.data.content } as ComponentBlock;
  }
}

type ModalPart =
  | ActionRowBuilder<TextInputBuilder>
  | LabelBuilder
  | TextDisplayBuilder;

export class ModalBuilder {
  readonly data: { custom_id?: string; title?: string };
  readonly components: ModalPart[] = [];
  constructor(data: { custom_id?: string; title?: string } = {}) {
    this.data = { ...data };
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  setTitle(title: string) {
    this.data.title = title;
    return this;
  }
  /** Rows with one text input each (the input carries its label) */
  addComponents(...rows: RestOrArray<ActionRowBuilder<TextInputBuilder>>) {
    this.components.push(...flat(rows));
    return this;
  }
  setComponents(...rows: RestOrArray<ModalPart>) {
    this.components.splice(0, this.components.length, ...flat(rows));
    return this;
  }
  addLabelComponents(...labels: RestOrArray<LabelBuilder>) {
    this.components.push(...flat(labels));
    return this;
  }
  addTextDisplayComponents(...texts: RestOrArray<TextDisplayBuilder>) {
    this.components.push(...flat(texts));
    return this;
  }
  toJSON(): Modal {
    if (!this.data.custom_id || !this.data.title)
      throw new TypeError("A modal needs setCustomId(...) and setTitle(...)");
    return {
      custom_id: this.data.custom_id,
      title: this.data.title,
      components: this.components.map((c) => c.toJSON()),
    } as Modal;
  }
}
