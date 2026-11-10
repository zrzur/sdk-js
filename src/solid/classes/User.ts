import { decodeTime } from "ulid";

import type * as APITypes from "../../api/types.js";
import type {
  User as APIUser,
  DataEditUser,
  Presence,
} from "../../api/types.js";
import { U32_MAX, UserPermission } from "../../core/permissions.js";
import type { UserCollection } from "../collections/UserCollection.js";
import { hydrate } from "../hydration/index.js";

import type { Channel } from "./Channel.js";
import type { File } from "./File.js";
import { UserProfile } from "./UserProfile.js";

export type UserLimits = APITypes.UserLimits;

/**
 * User Class
 */
export class User {
  readonly #collection: UserCollection;
  readonly id: string;

  /**
   * Construct User
   * @param collection Collection
   * @param id Id
   */
  constructor(collection: UserCollection, id: string) {
    this.#collection = collection;
    this.id = id;
  }

  /**
   * Write to string as a user mention
   * @returns Formatted String
   */
  toString(): string {
    return `<@${this.id}>`;
  }

  /**
   * Whether this object exists
   */
  get $exists(): boolean {
    return !!this.#collection.getUnderlyingObject(this.id).id;
  }

  /**
   * Time when this user created their account
   */
  get createdAt(): Date {
    return new Date(decodeTime(this.id));
  }

  /**
   * How old this user is in milliseconds
   */
  get age() {
    return new Date().getTime() - this.createdAt.getTime();
  }

  /**
   * Username
   */
  get username(): string {
    return this.#collection.getUnderlyingObject(this.id).username;
  }

  /**
   * Discriminator
   */
  get discriminator(): string {
    return this.#collection.getUnderlyingObject(this.id).discriminator;
  }

  /**
   * Display Name
   */
  get displayName(): string {
    const user = this.#collection.getUnderlyingObject(this.id);
    const language = this.#collection.client.language();
    return (
      (language ? user.officialNames?.[language] : undefined) ??
      user.displayName ??
      user.username
    );
  }

  /**
   * Avatar
   */
  get avatar(): File | undefined {
    return this.#collection.getUnderlyingObject(this.id).avatar;
  }

  /**
   * Pronouns
   */
  get pronouns(): string | undefined {
    return this.#collection.getUnderlyingObject(this.id).pronouns;
  }

  /**
   * Profile look (theme colours, name font and colour, decoration)
   */
  get style() {
    return this.#collection.getUnderlyingObject(this.id).style;
  }

  /**
   * Badges
   */
  get badges(): number {
    return this.#collection.getUnderlyingObject(this.id).badges;
  }

  /**
   * User Status
   */
  get status():
    | { text?: string | null; presence?: Presence | null }
    | undefined {
    // Hide offline status from other users, while retaining the account owner's
    // editable custom text even when they choose Invisible.
    if (!this.online && !this.self)
      return { text: undefined, presence: "Invisible" as const };
    return this.#collection.getUnderlyingObject(this.id).status;
  }

  /**
   * Relationship with user
   */
  get relationship(): string {
    return this.#collection.getUnderlyingObject(this.id).relationship;
  }

  /**
   * Whether the user is online
   */
  get online(): boolean {
    return this.#collection.getUnderlyingObject(this.id).online;
  }

  /**
   * Whether the user is privileged
   */
  get privileged(): boolean {
    return this.#collection.getUnderlyingObject(this.id).privileged;
  }

  /**
   * Whether this is an official Zrzur account. Its messages can't be
   * answered, reacted to, pinned or reported.
   */
  get official(): boolean {
    return this.#collection.getUnderlyingObject(this.id).official ?? false;
  }

  /**
   * Whether this is a verified official bot: a bot Zrzur runs itself. People
   * interact with it like with any bot, unlike an official account.
   */
  get officialBot(): boolean {
    return this.#collection.getUnderlyingObject(this.id).officialBot ?? false;
  }

  /**
   * Flags
   */
  get flags(): number {
    return this.#collection.getUnderlyingObject(this.id).flags;
  }

  /**
   * Bot information. `owner` (the owner's account id) is only sent to the
   * owner, the bot itself and platform staff.
   */
  get bot(): { owner?: string; verified?: boolean } | undefined {
    return this.#collection.getUnderlyingObject(this.id).bot;
  }

  /**
   * Whether this is a bot verified by Trust & Safety (shown next to its Bot label)
   */
  get verifiedBot(): boolean {
    return this.bot?.verified ?? false;
  }

  /**
   * Whether this user is ourselves
   */
  get self(): boolean {
    return this.#collection.client.user === this;
  }

  /**
   * URL to the user's default avatar
   */
  get defaultAvatarURL(): string {
    const url = `${this.#collection.client.options.baseURL}/users/${
      this.id
    }/default_avatar`;
    // Browsers kept the old address for a year, so a new logo needs a new
    // address. The server now caches official pictures for an hour: this
    // only has to change if that ever goes wrong again.
    return this.official ? `${url}?v=2` : url;
  }

  /**
   * URL to the user's avatar
   */
  get avatarURL(): string {
    return this.avatar?.createFileURL() ?? this.defaultAvatarURL;
  }

  /**
   * URL to the user's animated avatar
   */
  get animatedAvatarURL(): string {
    return this.avatar?.createFileURL(true) ?? this.defaultAvatarURL;
  }

  /**
   * Presence
   */
  get presence(): Presence {
    return this.online ? (this.status?.presence ?? "Online") : "Invisible";
  }

  /**
   * Generate status message
   * @param translate Translation function
   * @returns Status message
   */
  statusMessage(
    translate: (presence: Presence) => string = (a) => a,
  ): string | undefined {
    return this.online || this.self
      ? (this.status?.text ??
          (this.presence === "Focus" ? translate("Focus") : undefined))
      : undefined;
  }

  /**
   * Permissions against this user
   */
  get permission(): number {
    let permissions = 0;
    switch (this.relationship) {
      case "Friend":
      case "User":
        return U32_MAX;
      case "Blocked":
      case "BlockedOther":
        return UserPermission.Access;
      case "Incoming":
      case "Outgoing":
        permissions = UserPermission.Access;
    }

    if (
      this.#collection.client.channels.find(
        (channel) =>
          (channel.type === "Group" || channel.type === "DirectMessage") &&
          channel.recipientIds.has(this.id),
      ) ||
      this.#collection.client.serverMembers.find(
        (member) => member.id.user === this.id,
      )
    ) {
      if (this.#collection.client.user?.bot || this.bot) {
        permissions |= UserPermission.SendMessage;
      }

      permissions |= UserPermission.Access | UserPermission.ViewProfile;
    }

    return permissions;
  }

  /**
   * Edit the user
   * @param data Changes
   */
  async edit(data: DataEditUser): Promise<void> {
    this.#collection.updateUnderlyingObject(
      this.id,
      hydrate(
        "user",
        await this.#collection.client.api.patch(
          `/users/${
            this.id === this.#collection.client.user?.id ? "@me" : this.id
          }`,
          data,
        ),
        this.#collection.client,
        false,
      ),
    );
    // a bot's profile is part of its public page (description, avatar)
    if (this.bot) this.#collection.client.bots.forgetPublic(this.id);
  }

  /**
   * Change the username of the current user
   * @param username New username
   * @param password Current password
   */
  async changeUsername(username: string, password: string): Promise<APIUser> {
    return await this.#collection.client.api.patch("/users/@me/username", {
      username,
      password,
    });
  }

  /**
   * Open a DM with a user
   * @returns DM Channel
   */
  async openDM(): Promise<Channel> {
    let dm = [...this.#collection.client.channels.values()].find(
      (x) => x.type === "DirectMessage" && x.recipient == this,
    );

    if (dm) {
      if (!dm.active) {
        this.#collection.client.channels.updateUnderlyingObject(
          dm.id,
          "active",
          true,
        );
      }
    } else {
      const data = await this.#collection.client.api.get(
        `/users/${this.id as ""}/dm`,
      );

      dm = this.#collection.client.channels.getOrCreate(data._id, data)!;
    }

    return dm;
  }

  /**
   * Send a friend request to a user
   */
  async addFriend(): Promise<User> {
    const user = await this.#collection.client.api.post(`/users/friend`, {
      username: this.username + "#" + this.discriminator,
    });

    return this.#collection.getOrCreate(user._id, user);
  }

  /**
   * Remove a user from the friend list
   */
  async removeFriend(): Promise<void> {
    await this.#collection.client.api.delete(`/users/${this.id as ""}/friend`);
  }

  /**
   * Block a user
   */
  async blockUser(): Promise<void> {
    await this.#collection.client.api.put(`/users/${this.id as ""}/block`);
  }

  /**
   * Unblock a user
   */
  async unblockUser(): Promise<void> {
    await this.#collection.client.api.delete(`/users/${this.id as ""}/block`);
  }

  /**
   * Fetch the profile of a user
   * @returns The profile of the user
   */
  async fetchProfile(): Promise<UserProfile> {
    return new UserProfile(
      this.#collection.client,
      await this.#collection.client.api.get(`/users/${this.id as ""}/profile`),
    );
  }

  /**
   * Fetch the mutual connections of the current user and a target user
   * @returns The mutual connections of the current user and a target user
   */
  async fetchMutual(): Promise<{ users: string[]; servers: string[] }> {
    return await this.#collection.client.api.get(
      `/users/${this.id as ""}/mutual`,
    );
  }

  /**
   * Backend enforced limits for a user
   */
  get limits(): UserLimits | undefined {
    if (!this.#collection.client.configured()) {
      return;
    }
    if (
      this.age <
      (this.#collection.client.configuration?.features.limits.global
        .new_user_hours ?? 72) *
        3600_0000
    ) {
      return this.#collection.client.configuration?.features.limits.new_user;
    }
    return this.#collection.client.configuration?.features.limits.default;
  }
}
