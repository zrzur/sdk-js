import type { API } from "../core/API.js";

import { type EmbedBuilder, resolve } from "./builders.js";
import {
  type ComponentType,
  MessageFlags,
  componentTypeOf,
} from "./component-builders.js";
import {
  type ComponentInput,
  type ModalInput,
  toBlocks,
  toModal,
} from "./components.js";
import {
  InteractionAlreadyRepliedError,
  InteractionNotRepliedError,
} from "./errors.js";
import type {
  CallbackType,
  ComponentBlock,
  InteractionOption,
  Modal,
  ModalFieldValue,
  OptionChoice,
  OptionValue,
  RawInteraction,
  Resolved,
  ResolvedFile,
  SendableEmbed,
} from "./types.js";

export interface ReplyOptions {
  content?: string;
  embeds?: (SendableEmbed | EmbedBuilder)[];
  components?: ComponentInput[];
  /** Only the user who triggered the interaction sees it */
  ephemeral?: boolean;
  /** `MessageFlags.Ephemeral` is the same as `ephemeral: true` */
  flags?: number;
}

/** What the bot keeps for its interactions (set by `Client`) */
export interface InteractionContext {
  /** Components the bot last gave this message */
  components(messageId: string): ComponentBlock[] | undefined;
  remember(messageId: string, components: ComponentBlock[] | undefined): void;
  awaitModalSubmit(options: AwaitModalOptions): Promise<Interaction>;
}

export interface AwaitModalOptions {
  /** Milliseconds to wait (required: nobody is told when a form is closed) */
  time: number;
  filter?: (interaction: Interaction) => boolean | Promise<boolean>;
}

type Reply = string | ReplyOptions;

function toData(reply: Reply) {
  const options = typeof reply === "string" ? { content: reply } : reply;
  return {
    content: options.content,
    embeds: options.embeds?.map(resolve),
    components: toBlocks(options.components),
    ephemeral:
      options.ephemeral ??
      ((options.flags ?? 0) & MessageFlags.Ephemeral) !== 0,
  };
}

/** Milliseconds since 1970 in a ULID (its first 10 characters) */
function ulidTime(id: string) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = 0;
  for (const char of id.slice(0, 10).toUpperCase())
    time = time * 32 + alphabet.indexOf(char);
  return time;
}

const asMap = <T>(record: Record<string, T> | undefined) =>
  new Map(Object.entries(record ?? {}));

function findOption(
  options: InteractionOption[] | null | undefined,
  name: string,
): InteractionOption | undefined {
  for (const option of options ?? []) {
    if (option.name === name && option.value != null) return option;
    const nested = findOption(option.options, name);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * One interaction. Answer it once with `reply`, `defer`, `update`,
 * `deferUpdate`, `showModal` or `respond` (autocomplete) within 3 seconds;
 * afterwards `editReply` works until the token expires (15 minutes).
 */
export class Interaction {
  #acknowledged = false;
  #deferred = false;
  #replied = false;
  #ephemeral: boolean | null = null;

  constructor(
    readonly raw: RawInteraction,
    private readonly rest: API,
    private readonly context?: InteractionContext,
  ) {
    // `user.id` reads the same id as `_id`
    for (const user of [
      raw.user,
      ...Object.values(raw.component?.resolved?.users ?? {}),
    ]) {
      if (user && !("id" in user))
        Object.defineProperty(user, "id", {
          value: user._id,
          enumerable: false,
        });
    }
  }

  /** `deferReply` or `deferUpdate` was used */
  get deferred() {
    return this.#deferred;
  }
  /** Answered with `reply`, `update` or a form */
  get replied() {
    return this.#replied;
  }
  /** Whether the answer is private; null until answered */
  get ephemeral() {
    return this.#ephemeral;
  }
  get applicationId() {
    return this.raw.application_id;
  }
  /** The server id (`null` in DMs) */
  get guildId() {
    return this.raw.server_id ?? null;
  }
  get createdTimestamp() {
    return ulidTime(this.raw._id);
  }
  get createdAt() {
    return new Date(this.createdTimestamp);
  }
  /** Number of the component used (`ComponentType.Button`, …) */
  get componentType(): ComponentType | undefined {
    const wire = this.raw.component?.component_type;
    return wire ? componentTypeOf(wire) : undefined;
  }
  /**
   * The message a button or menu is on. `components` are the ones the bot
   * last gave it in this process (empty after a restart: fetch the message).
   */
  get message() {
    const id = this.raw.message_id;
    if (!id) return null;
    return {
      id,
      _id: id,
      channelId: this.raw.channel_id,
      ephemeral: this.raw.message_ephemeral ?? false,
      components: this.context?.components(id) ?? [],
    };
  }

  // what kind of interaction this is
  isCommand() {
    return this.raw.type === "Command";
  }
  isChatInputCommand() {
    return (
      this.raw.type === "Command" && this.raw.command?.type === "ChatInput"
    );
  }
  isContextMenuCommand() {
    return (
      this.raw.type === "Command" && this.raw.command?.type !== "ChatInput"
    );
  }
  isUserContextMenuCommand() {
    return this.raw.type === "Command" && this.raw.command?.type === "User";
  }
  isMessageContextMenuCommand() {
    return this.raw.type === "Command" && this.raw.command?.type === "Message";
  }
  isAutocomplete() {
    return this.raw.type === "Autocomplete";
  }
  isMessageComponent() {
    return this.raw.type === "Component";
  }
  isModalSubmit() {
    return this.raw.type === "ModalSubmit";
  }
  isButton() {
    return this.raw.component?.component_type === "Button";
  }
  isStringSelectMenu() {
    return this.raw.component?.component_type === "StringSelect";
  }
  isUserSelectMenu() {
    return this.raw.component?.component_type === "UserSelect";
  }
  isRoleSelectMenu() {
    return this.raw.component?.component_type === "RoleSelect";
  }
  isMentionableSelectMenu() {
    return this.raw.component?.component_type === "MentionableSelect";
  }
  isChannelSelectMenu() {
    return this.raw.component?.component_type === "ChannelSelect";
  }
  /** Any of the five menus */
  isSelectMenu() {
    return this.isMessageComponent() && !this.isButton();
  }
  isAnySelectMenu() {
    return this.isSelectMenu();
  }
  /** Everything but autocomplete can be answered */
  isRepliable() {
    return this.raw.type !== "Autocomplete";
  }
  /** What the person may do here (bits of `Permissions`) */
  get memberPermissions() {
    return this.raw.user_permissions;
  }
  /** What the bot may do here */
  get appPermissions() {
    return this.raw.app_permissions;
  }
  /**
   * Whether the person (or with `"app"` the bot) has every given permission:
   * `i.has(Permissions.ManageMessages)`.
   */
  has(permissions: number | bigint, who: "member" | "app" = "member") {
    const held = BigInt(
      who === "app"
        ? (this.raw.app_permissions_string ?? this.raw.app_permissions)
        : (this.raw.user_permissions_string ?? this.raw.user_permissions),
    );
    const wanted = BigInt(permissions);
    return (held & wanted) === wanted;
  }
  /** The person's permissions as a decimal string (exact for every bit) */
  get memberPermissionsString() {
    return (
      this.raw.user_permissions_string ?? String(this.raw.user_permissions)
    );
  }
  /** The bot's permissions as a decimal string */
  get appPermissionsString() {
    return this.raw.app_permissions_string ?? String(this.raw.app_permissions);
  }
  inGuild() {
    return !!this.raw.server_id;
  }

  get id() {
    return this.raw._id;
  }
  get type() {
    return this.raw.type;
  }
  get user() {
    return this.raw.user;
  }
  get member() {
    return this.raw.member;
  }
  get serverId() {
    return this.raw.server_id;
  }
  get channelId() {
    return this.raw.channel_id;
  }
  get locale() {
    return this.raw.locale;
  }
  /** Whether it was already answered from this process */
  get acknowledged() {
    return this.#acknowledged;
  }
  get expiresAt() {
    return new Date(this.raw.expires_at);
  }

  /** Command name (commands and autocomplete) */
  get commandName() {
    return this.raw.command?.name;
  }
  /** Chosen sub-command, if any */
  get subcommand() {
    const first = this.raw.command?.options?.[0];
    if (!first || first.type === "SubCommandGroup") {
      return first?.options?.[0]?.name;
    }
    return first.type === "SubCommand" ? first.name : undefined;
  }
  /** Value of an option, looking inside sub-commands */
  option<T extends OptionValue = OptionValue>(name: string): T | undefined {
    return findOption(this.raw.command?.options, name)?.value as T | undefined;
  }
  /** Users, roles and channels referenced by options or selects */
  get resolved(): Resolved {
    return this.raw.command?.resolved ?? this.raw.component?.resolved ?? {};
  }
  /** Picked or mentioned users, by id */
  get users() {
    return asMap(this.resolved.users);
  }
  get members() {
    return asMap(this.resolved.members);
  }
  get roles() {
    return asMap(this.resolved.roles);
  }
  get channels() {
    return asMap(this.resolved.channels);
  }
  /** File given to an `Attachment` option */
  attachment(name: string): ResolvedFile | undefined {
    const id = this.option<string>(name);
    return id ? this.resolved.attachments?.[id] : undefined;
  }
  /** Download address of the file given to an `Attachment` option */
  async attachmentUrl(name: string): Promise<string | undefined> {
    const file = this.attachment(name);
    return file
      ? `${await this.rest.filesUrl()}/${file.tag}/${file._id}`
      : undefined;
  }
  /** Bytes of the file given to an `Attachment` option */
  async downloadAttachment(name: string): Promise<ArrayBuffer | undefined> {
    const url = await this.attachmentUrl(name);
    return url ? this.rest.download(url) : undefined;
  }
  /** Target of a context menu command */
  get targetId() {
    return this.raw.command?.target_id;
  }

  /** Component `custom_id` (components) or form `custom_id` (modal submits) */
  get customId() {
    return this.raw.component?.custom_id ?? this.raw.modal?.custom_id;
  }
  /** Chosen values of a select */
  get values() {
    return this.raw.component?.values ?? [];
  }
  /** Message the component is on */
  get messageId() {
    return this.raw.message_id;
  }
  /** Value of a form field */
  field(customId: string): string | undefined {
    return (
      this.raw.modal?.fields.find(
        (f: ModalFieldValue) => f.custom_id === customId,
      )?.value ?? undefined
    );
  }
  /** Values of a select, checkbox group or file field in a form */
  fieldValues(customId: string): string[] {
    return (
      this.raw.modal?.fields.find((f) => f.custom_id === customId)?.values ?? []
    );
  }
  /** Whether a single checkbox in a form was ticked */
  fieldChecked(customId: string): boolean {
    return (
      this.raw.modal?.fields.find((f) => f.custom_id === customId)?.checked ??
      false
    );
  }
  /** Files uploaded to a form field, with their download details */
  fieldFiles(customId: string) {
    const files = this.raw.modal?.resolved?.attachments ?? {};
    return this.fieldValues(customId).flatMap((id) =>
      files[id] ? [files[id]] : [],
    );
  }

  /** Form answers by field; a missing field throws */
  get fields() {
    const find = (customId: string) => {
      const field = this.raw.modal?.fields.find(
        (f) => f.custom_id === customId,
      );
      if (!field) throw new TypeError(`The form has no field "${customId}"`);
      return field;
    };
    const values = (customId: string) => find(customId).values ?? [];
    return {
      fields: new Map(
        (this.raw.modal?.fields ?? []).map((f) => [f.custom_id, f]),
      ),
      getField: find,
      getTextInputValue: (customId: string) => find(customId).value ?? "",
      getStringSelectValues: values,
      getSelectedUsers: values,
      getSelectedRoles: values,
      getSelectedChannels: values,
      getSelectedMentionables: values,
      getCheckbox: (customId: string) => find(customId).checked ?? false,
      getCheckboxGroup: values,
      getRadioGroup: (customId: string) => find(customId).value ?? null,
      getUploadedFiles: (customId: string) => (
        find(customId), this.fieldFiles(customId)
      ),
    };
  }

  /**
   * Wait for a submitted form. Rejects when
   * `time` runs out, because nobody is told when a form is closed.
   */
  awaitModalSubmit(options: AwaitModalOptions) {
    if (typeof options?.time !== "number")
      throw new TypeError("awaitModalSubmit needs a time in milliseconds");
    if (!this.context)
      throw new Error(
        "awaitModalSubmit needs an interaction received by Client",
      );
    return this.context.awaitModalSubmit(options);
  }

  /** Autocomplete: the option being typed into and its partial text */
  get focused() {
    const name = this.raw.command?.focused;
    return name ? { name, value: String(this.option(name) ?? "") } : undefined;
  }

  async #callback(
    type: CallbackType,
    extra: Record<string, unknown>,
    state: { deferred?: boolean; replied?: boolean; ephemeral?: boolean } = {},
  ) {
    if (this.#acknowledged) throw new InteractionAlreadyRepliedError();
    this.#acknowledged = true;
    try {
      await this.rest.req(
        "post",
        `/interactions/${this.raw._id}/${this.raw.token}/callback`,
        { type, ...extra },
      );
    } catch (error) {
      this.#acknowledged = false;
      throw error;
    }
    if (state.deferred) this.#deferred = true;
    if (state.replied) this.#replied = true;
    if (state.ephemeral !== undefined) this.#ephemeral = state.ephemeral;
  }

  /** editReply, followUp and deleteReply come after a first answer */
  #needsAnswer() {
    if (!this.#acknowledged) throw new InteractionNotRepliedError();
  }

  #remember(data: { components?: ComponentBlock[] }) {
    const id = this.raw.message_id;
    if (id && data.components) this.context?.remember(id, data.components);
  }

  /** Answer with a new message (`ephemeral: true` for the user only) */
  reply(reply: Reply) {
    const data = toData(reply);
    return this.#callback(
      "Message",
      { data },
      { replied: true, ephemeral: data.ephemeral },
    );
  }

  /** Show "thinking…" now; finish later with `editReply` */
  defer(options: { ephemeral?: boolean; flags?: number } = {}) {
    const ephemeral =
      options.ephemeral ??
      ((options.flags ?? 0) & MessageFlags.Ephemeral) !== 0;
    return this.#callback(
      "DeferredMessage",
      { data: { ephemeral } },
      { deferred: true, ephemeral },
    );
  }

  /** Same as `defer` */
  deferReply(options: { ephemeral?: boolean; flags?: number } = {}) {
    return this.defer(options);
  }

  /** Components: change the message the component is on */
  async update(reply: Reply) {
    const data = toData(reply);
    await this.#callback(
      "UpdateMessage",
      { data: { ...data, ephemeral: undefined } },
      { replied: true },
    );
    this.#remember(data);
  }

  /** Components: acknowledge now, change the message later with `editReply` */
  deferUpdate() {
    return this.#callback("DeferredUpdate", {}, { deferred: true });
  }

  /** Open a form for the user (also a `ModalBuilder`) */
  showModal(modal: ModalInput | Modal | { toJSON(): Modal }) {
    return this.#callback(
      "Modal",
      { modal: toModal(modal) },
      { replied: true },
    );
  }

  /** Autocomplete: up to 25 suggestions */
  respond(choices: OptionChoice[]) {
    return this.#callback("AutocompleteResult", {
      choices: choices.slice(0, 25),
    });
  }

  /** Another message after the first answer (up to 5); `ephemeral` works here too */
  followUp(reply: Reply) {
    this.#needsAnswer();
    return this.rest.req(
      "post",
      `/interactions/${this.raw._id}/${this.raw.token}/followups`,
      toData(reply),
    );
  }

  /** Edit a follow-up (or the first answer) by its message id */
  editFollowUp(messageId: string, reply: Reply) {
    this.#needsAnswer();
    const data = toData(reply);
    return this.rest.req(
      "patch",
      `/interactions/${this.raw._id}/${this.raw.token}/messages/${messageId}`,
      { ...data, ephemeral: undefined },
    );
  }

  /** Delete a follow-up (or the first answer) by its message id */
  deleteFollowUp(messageId: string) {
    this.#needsAnswer();
    return this.rest.req(
      "delete",
      `/interactions/${this.raw._id}/${this.raw.token}/messages/${messageId}`,
    );
  }

  /** Delete the first answer */
  deleteReply() {
    this.#needsAnswer();
    return this.rest.req(
      "delete",
      `/interactions/${this.raw._id}/${this.raw.token}/original`,
    );
  }

  /** Edit the answer (or finish a deferred one) until the token expires */
  async editReply(reply: Reply) {
    this.#needsAnswer();
    const data = toData(reply);
    const result = await this.rest.req(
      "patch",
      `/interactions/${this.raw._id}/${this.raw.token}/original`,
      { ...data, ephemeral: undefined },
    );
    // after deferUpdate the answer is the component's own message
    if (this.#deferred && this.#ephemeral === null) this.#remember(data);
    this.#replied = true;
    return result;
  }
}
