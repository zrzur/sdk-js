import type {
  ActionRow,
  ButtonStyle,
  ChannelKind,
  Component,
  ComponentBlock,
  MediaItem,
  Modal,
  SelectOption,
} from "./types.js";

/**
 * Friendly component input. Accepts the wire format (`{ type: "Button",
 * custom_id }`) or a lighter form (`{ type: "button", style: "primary",
 * customId }`). Loose buttons and selects are packed into action rows: up
 * to five buttons per row, a select on a row of its own. Layout blocks
 * (text, section, gallery, file, separator, container) stand on their own.
 */
export type ComponentInput =
  | ComponentBlock
  | Component
  | FriendlyButton
  | FriendlySelect
  | FriendlyBlock
  | { type: "row" | "actionRow"; components: ComponentInput[] }
  /** Builders (`ButtonBuilder`, `ActionRowBuilder`, …) */
  | { toJSON(): Component | ComponentBlock };

export interface FriendlyButton {
  type: "button";
  style?: Lowercase<ButtonStyle> | ButtonStyle;
  label?: string;
  emoji?: string;
  customId?: string;
  url?: string;
  disabled?: boolean;
  restrict?: { users?: string[]; roles?: string[] };
}

export interface FriendlySelect {
  type:
    | "select"
    | "userSelect"
    | "roleSelect"
    | "channelSelect"
    | "mentionableSelect";
  customId: string;
  options?: SelectOption[];
  placeholder?: string;
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
  defaultValues?: string[];
  channelTypes?: ChannelKind[];
  restrict?: { users?: string[]; roles?: string[] };
}

/** An image: a web link, or `{ attachment }` for a file of the same message */
export type MediaInput = string | MediaItem;

export type FriendlyBlock =
  | { type: "text"; content: string }
  | {
      type: "section";
      text: string | string[];
      button?: FriendlyButton | Component;
      thumbnail?: MediaInput;
    }
  | { type: "gallery"; items: MediaInput[] }
  | { type: "file"; attachment: string; spoiler?: boolean }
  | { type: "separator"; divider?: boolean; spacing?: "small" | "large" }
  | {
      type: "container";
      components: ComponentInput[];
      /** Colour of the strip, \`#RRGGBB\` */
      accent?: string;
      spoiler?: boolean;
    };

/** Every form field takes a label and an optional line of help */
interface Labelled {
  label: string;
  description?: string;
}

export interface FriendlyTextInput extends Labelled {
  type: "textInput";
  customId: string;
  style?: "short" | "paragraph";
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  value?: string;
}

export type FriendlyField =
  | FriendlyTextInput
  | (FriendlySelect & Partial<Labelled>)
  | (Labelled & {
      type: "radio";
      customId: string;
      options: SelectOption[];
      required?: boolean;
    })
  | (Labelled & {
      type: "checkboxes";
      customId: string;
      options: SelectOption[];
      minValues?: number;
      maxValues?: number;
      required?: boolean;
    })
  | (Labelled & { type: "checkbox"; customId: string; default?: boolean })
  | (Labelled & {
      type: "fileUpload";
      customId: string;
      minValues?: number;
      maxValues?: number;
      required?: boolean;
      /** `image`, `video`, `audio` or an extension such as `.pdf` */
      fileTypes?: string[];
    });

/** What the server accepts in select menus (characters) */
export const SELECT_LIMITS = {
  options: 25,
  /** Picks at once (`maxValues`) */
  values: 25,
  /** Each option's label, value and description */
  optionText: 100,
  placeholder: 150,
  customId: 100,
  emoji: 32,
  defaultValues: 25,
} as const;

const SELECT_TYPES = new Set([
  "StringSelect",
  "UserSelect",
  "RoleSelect",
  "MentionableSelect",
  "ChannelSelect",
]);

/** One line of menu text, counted in characters as the server counts them */
function line(what: string, text: string | null | undefined, max: number) {
  if (text == null) return;
  const length = [...text].length;
  if (length < 1 || length > max) {
    throw new RangeError(
      `${what} must be 1 to ${max} characters (got ${length})`,
    );
  }
  // control characters (Unicode Cc), which include line breaks
  if (/\p{Cc}/u.test(text)) {
    throw new RangeError(`${what} must be one line without control characters`);
  }
}

/** Same checks as the server, so a bot learns about a bad menu before sending it */
function checkSelect(select: Component) {
  const s = select as Extract<Component, { type: "StringSelect" }> & {
    default_values?: string[];
    channel_types?: unknown[];
  };
  line("select customId", s.custom_id, SELECT_LIMITS.customId);
  line("placeholder", s.placeholder, SELECT_LIMITS.placeholder);
  let offered: number | undefined;
  let defaults = 0;
  if (s.type === "StringSelect") {
    const list = s.options ?? [];
    if (list.length < 1 || list.length > SELECT_LIMITS.options) {
      throw new RangeError(
        `A select needs 1 to ${SELECT_LIMITS.options} options (got ${list.length})`,
      );
    }
    const values = new Set<string>();
    for (const option of list) {
      line("option label", option.label, SELECT_LIMITS.optionText);
      line("option value", option.value, SELECT_LIMITS.optionText);
      line("option description", option.description, SELECT_LIMITS.optionText);
      if (option.emoji != null) {
        line("option emoji", option.emoji, SELECT_LIMITS.emoji);
        if (/\s/.test(option.emoji))
          throw new RangeError("option emoji may not contain spaces");
      }
      if (values.has(option.value))
        throw new RangeError(`Two options share the value "${option.value}"`);
      values.add(option.value);
    }
    offered = list.length;
    defaults = list.filter((option) => option.default).length;
  } else {
    const ids = s.default_values ?? [];
    if (ids.length > SELECT_LIMITS.defaultValues) {
      throw new RangeError(
        `At most ${SELECT_LIMITS.defaultValues} default values`,
      );
    }
    if (ids.some((id) => !/^[0-9A-Za-z]{26}$/.test(id)))
      throw new RangeError("A default value is not an id");
    if (new Set(ids).size !== ids.length)
      throw new RangeError("The same default value twice");
    if (
      s.type === "ChannelSelect" &&
      s.channel_types &&
      !s.channel_types.length
    ) {
      throw new RangeError(
        "channelTypes must not be empty (leave it out for every kind)",
      );
    }
    defaults = ids.length;
  }
  const min = s.min_values ?? 1;
  const max = s.max_values ?? 1;
  if (max < 1 || max > SELECT_LIMITS.values || min < 0 || min > max) {
    throw new RangeError(
      `A select needs 0 <= minValues <= maxValues, maxValues 1 to ${SELECT_LIMITS.values}`,
    );
  }
  if (offered !== undefined && max > offered) {
    throw new RangeError(
      `maxValues (${max}) is more than the ${offered} options offered`,
    );
  }
  if (defaults > max)
    throw new RangeError(`${defaults} defaults but maxValues is ${max}`);
}

const capitalise = <T extends string>(value: string) =>
  (value.charAt(0).toUpperCase() + value.slice(1)) as T;

const media = (input: MediaInput): MediaItem =>
  typeof input === "string" ? { url: input } : input;

function normaliseOne(
  input: ComponentInput | FriendlyField,
): Component | ComponentBlock {
  // builders hand over their wire form
  const plain =
    typeof (input as { toJSON?: unknown }).toJSON === "function"
      ? (input as { toJSON(): Component | ComponentBlock }).toJSON()
      : input;
  const item = normaliseInput(plain as PlainInput);
  checkSelects(item);
  return item;
}

/** Wire-format rows and containers pass through as given: check the selects inside */
function checkSelects(item: Component | ComponentBlock) {
  if (SELECT_TYPES.has(item.type)) checkSelect(item as Component);
  if (item.type === "ActionRow" || item.type === "Container") {
    for (const inner of (
      item as { components?: (Component | ComponentBlock)[] }
    ).components ?? []) {
      checkSelects(inner);
    }
  }
}

/** Input after builders handed over their wire form */
type PlainInput =
  | Exclude<ComponentInput, { toJSON(): Component | ComponentBlock }>
  | FriendlyField;

function normaliseInput(input: PlainInput): Component | ComponentBlock {
  switch (input.type) {
    case "button":
      return {
        type: "Button",
        style: capitalise<ButtonStyle>(
          input.style ?? (input.url ? "link" : "primary"),
        ),
        label: input.label,
        emoji: input.emoji,
        custom_id: input.customId,
        url: input.url,
        disabled: input.disabled,
        restrict: input.restrict,
      };
    case "select":
      return {
        type: "StringSelect",
        custom_id: input.customId,
        options: input.options ?? [],
        placeholder: input.placeholder,
        min_values: input.minValues,
        max_values: input.maxValues,
        disabled: input.disabled,
        restrict: input.restrict,
      };
    case "userSelect":
    case "roleSelect":
    case "mentionableSelect":
    case "channelSelect": {
      const type = capitalise<"UserSelect">(input.type) as
        | "UserSelect"
        | "RoleSelect"
        | "MentionableSelect"
        | "ChannelSelect";
      return {
        type,
        custom_id: input.customId,
        placeholder: input.placeholder,
        min_values: input.minValues,
        max_values: input.maxValues,
        disabled: input.disabled,
        default_values: input.defaultValues,
        restrict: input.restrict,
        ...(type === "ChannelSelect"
          ? { channel_types: input.channelTypes }
          : {}),
      } as Component;
    }
    case "textInput":
      return {
        type: "TextInput",
        custom_id: input.customId,
        style: input.style === "paragraph" ? "Paragraph" : "Short",
        placeholder: input.placeholder,
        required: input.required,
        min_length: input.minLength,
        max_length: input.maxLength,
        value: input.value,
      };
    case "radio":
      return {
        type: "RadioGroup",
        custom_id: input.customId,
        options: input.options,
        required: input.required,
      };
    case "checkboxes":
      return {
        type: "CheckboxGroup",
        custom_id: input.customId,
        options: input.options,
        min_values: input.minValues,
        max_values: input.maxValues,
        required: input.required,
      };
    case "checkbox":
      return {
        type: "Checkbox",
        custom_id: input.customId,
        default: input.default,
      };
    case "fileUpload":
      return {
        type: "FileUpload",
        custom_id: input.customId,
        min_values: input.minValues,
        max_values: input.maxValues,
        required: input.required,
        file_types: input.fileTypes,
      };
    case "row":
    case "actionRow":
      return {
        type: "ActionRow",
        components: input.components.map((c) => normaliseOne(c) as Component),
      };
    case "text":
      return { type: "Text", content: input.content };
    case "section":
      return {
        type: "Section",
        text: Array.isArray(input.text) ? input.text : [input.text],
        button: input.button
          ? (normaliseOne(input.button) as Component)
          : undefined,
        thumbnail: input.thumbnail ? media(input.thumbnail) : undefined,
      };
    case "gallery":
      return { type: "Gallery", items: input.items.map(media) };
    case "file":
      return {
        type: "File",
        attachment: input.attachment,
        spoiler: input.spoiler,
      };
    case "separator":
      return {
        type: "Separator",
        divider: input.divider,
        spacing: input.spacing === "large" ? "Large" : "Small",
      };
    case "container":
      return {
        type: "Container",
        components: toBlocks(input.components) ?? [],
        accent: input.accent,
        spoiler: input.spoiler,
      };
    default:
      return input as Component | ComponentBlock;
  }
}

const BLOCKS = new Set([
  "ActionRow",
  "Text",
  "Section",
  "Gallery",
  "File",
  "Separator",
  "Container",
  "Field",
]);

/** Turn friendly or wire input into message blocks, packing loose buttons and selects into rows */
export function toBlocks(
  inputs: ComponentInput[] | undefined,
): ComponentBlock[] | undefined {
  if (!inputs) return undefined;
  const blocks: ComponentBlock[] = [];
  let buttons: Component[] = [];
  const flush = () => {
    if (buttons.length) blocks.push({ type: "ActionRow", components: buttons });
    buttons = [];
  };
  for (const input of inputs) {
    const item = normaliseOne(input);
    if (BLOCKS.has(item.type)) {
      flush();
      blocks.push(item as ComponentBlock);
    } else if (item.type === "Button") {
      if (buttons.length === 5) flush();
      buttons.push(item as Component);
    } else {
      flush();
      blocks.push({ type: "ActionRow", components: [item as Component] });
    }
  }
  flush();
  return blocks;
}

/** @deprecated Same as `toBlocks`; kept for bots written before layout blocks */
export const toActionRows = toBlocks as (
  inputs: ComponentInput[] | undefined,
) => (ActionRow | ComponentBlock)[] | undefined;

export interface ModalInput {
  customId: string;
  title: string;
  /**
   * Fields with their labels, and `{ type: "text", content }` paragraphs.
   * Wire components (`{ type: "TextInput", label, … }`) get a row each.
   */
  fields?: ModalFieldInput[];
  /** Same as `fields` (the name the wire format uses) */
  components?: ModalFieldInput[];
}

type ModalFieldInput =
  | FriendlyField
  | { type: "text"; content: string }
  | Component
  | ComponentBlock;

export function toModal(
  given: ModalInput | Modal | { toJSON(): Modal },
): Modal {
  // a ModalBuilder hands over its wire form
  if (typeof (given as { toJSON?: unknown }).toJSON === "function")
    return (given as { toJSON(): Modal }).toJSON();
  const input = given as ModalInput | Modal;
  if ("custom_id" in input) return input;
  const fields = input.fields ?? input.components;
  if (!Array.isArray(fields)) {
    throw new TypeError(
      "A modal needs its fields: { customId, title, fields: [...] }",
    );
  }
  return {
    custom_id: input.customId,
    title: input.title,
    components: fields.map((field): ComponentBlock => {
      if (field.type === "text")
        return { type: "Text", content: field.content };
      if (BLOCKS.has(field.type)) return field as ComponentBlock;
      const component = normaliseOne(field as FriendlyField) as Component;
      // friendly fields carry a label: they become labelled fields
      if ("label" in field && field.label && !/^[A-Z]/.test(field.type)) {
        return {
          type: "Field",
          label: field.label,
          description: "description" in field ? field.description : undefined,
          component,
        };
      }
      return { type: "ActionRow", components: [component] };
    }),
  };
}
