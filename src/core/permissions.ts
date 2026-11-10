/**
 * Permission against User
 */
export const UserPermission = {
  Access: 1 << 0,
  ViewProfile: 1 << 1,
  SendMessage: 1 << 2,
  Invite: 1 << 3,
};

/**
 * Permission against Server / Channel
 */
export const Permission = {
  // * Generic permissions
  /// Manage the channel or channels on the server
  ManageChannel: 2n ** 0n,
  /// Manage the server
  ManageServer: 2n ** 1n,
  /// Manage permissions on servers or channels
  ManagePermissions: 2n ** 2n,
  /// Manage roles on server
  ManageRole: 2n ** 3n,
  /// Manage server customisation (includes emoji)
  ManageCustomisation: 2n ** 4n,

  // % 1 bits reserved

  // * Member permissions
  /// Kick other members below their ranking
  KickMembers: 2n ** 6n,
  /// Ban other members below their ranking
  BanMembers: 2n ** 7n,
  /// Timeout other members below their ranking
  TimeoutMembers: 2n ** 8n,
  /// Assign roles to members below their ranking
  AssignRoles: 2n ** 9n,
  /// Change own nickname
  ChangeNickname: 2n ** 10n,
  /// Change or remove other's nicknames below their ranking
  ManageNicknames: 2n ** 11n,
  /// Change own avatar
  ChangeAvatar: 2n ** 12n,
  /// Remove other's avatars below their ranking
  RemoveAvatars: 2n ** 13n,

  // % 7 bits reserved

  // * Channel permissions
  /// View a channel
  ViewChannel: 2n ** 20n,
  /// Read a channel's past message history
  ReadMessageHistory: 2n ** 21n,
  /// Send a message in a channel
  SendMessage: 2n ** 22n,
  /// Delete messages in a channel
  ManageMessages: 2n ** 23n,
  /// Manage webhook entries on a channel
  ManageWebhooks: 2n ** 24n,
  /// Create invites to this channel
  InviteOthers: 2n ** 25n,
  /// Send embedded content in this channel
  SendEmbeds: 2n ** 26n,
  /// Send attachments and media in this channel
  UploadFiles: 2n ** 27n,
  /// Masquerade messages using custom nickname and avatar
  Masquerade: 2n ** 28n,
  /// React to messages with emoji
  React: 2n ** 29n,
  /// Bypass slowmode
  BypassSlowmode: 2n ** 39n,

  // * Voice permissions
  /// Connect to a voice channel
  Connect: 2n ** 30n,
  /// Speak in a voice call
  Speak: 2n ** 31n,
  /// Share video in a voice call
  Video: 2n ** 32n,
  /// Mute other members with lower ranking in a voice call
  MuteMembers: 2n ** 33n,
  /// Deafen other members with lower ranking in a voice call
  DeafenMembers: 2n ** 34n,
  /// Move members between voice channels
  MoveMembers: 2n ** 35n,
  /// Move members between voice channels
  Listen: 2n ** 36n,

  // * Mention permissions
  /// Mention @everyone or @online
  MentionEveryone: 2n ** 37n,
  /// Mention a role
  MentionRoles: 2n ** 38n,

  // Access server audit logs
  ViewAuditLogs: 2n ** 40n,

  /// Use emoji from other servers
  UseExternalEmojis: 2n ** 41n,

  /// Approve or reject requests to join a server that needs approval
  ManageJoinRequests: 2n ** 42n,

  // * Thread permissions, read on the parent channel, on top of SendMessage
  /// Start a thread in a text channel
  CreateThreads: 2n ** 43n,
  /// Write in threads and in forum posts (a forum post is a thread)
  SendMessageInThreads: 2n ** 44n,
  /// Start a post in a forum
  CreateForumPosts: 2n ** 45n,

  // * Administrator
  /// Every right in every channel of the server, whatever the channels'
  /// overrides say; only someone who has it can give it
  Administrator: 2n ** 46n,

  // * Soundboard
  /// Play the server's soundboard sounds in a voice call
  UseSoundboard: 2n ** 47n,
  /// Add, change and remove the server's soundboard sounds
  ManageSoundboard: 2n ** 48n,

  // * Misc. permissions
  // % Bits 49 to 52: free area
  // % Bits 53 to 64: do not use

  // * Grant all permissions
  /// Safely grant all permissions
  GrantAllSafe: 0x000f_ffff_ffff_ffffn,
};

/**
 * Maximum safe value
 */
export const U32_MAX = 2 ** 32 - 1; // 4294967295

/**
 * Permissions allowed for a user while in timeout
 */
export const ALLOW_IN_TIMEOUT =
  Permission.ViewChannel + Permission.ReadMessageHistory;

/**
 * The permissions that belong to threads and forums
 */
export const THREAD_PERMISSIONS =
  Permission.CreateThreads +
  Permission.SendMessageInThreads +
  Permission.CreateForumPosts;

/**
 * Default permissions if we can only view
 */
export const DEFAULT_PERMISSION_VIEW_ONLY =
  Permission.ViewChannel + Permission.ReadMessageHistory;

/**
 * Default base permissions for channels
 */
export const DEFAULT_PERMISSION =
  DEFAULT_PERMISSION_VIEW_ONLY +
  Permission.SendMessage +
  Permission.InviteOthers +
  Permission.SendEmbeds +
  Permission.UploadFiles +
  Permission.Connect +
  Permission.Speak +
  Permission.Video +
  Permission.Listen;

/**
 * Permissions in saved messages channel
 */
export const DEFAULT_PERMISSION_SAVED_MESSAGES = Permission.GrantAllSafe;

/**
 * Permissions in direct message channels / default permissions for group DMs
 */
export const DEFAULT_PERMISSION_DIRECT_MESSAGE =
  DEFAULT_PERMISSION + Permission.React + Permission.ManageChannel;

/**
 * Permissions in server text / voice channel
 */
export const DEFAULT_PERMISSION_SERVER =
  DEFAULT_PERMISSION +
  Permission.React +
  Permission.ChangeNickname +
  Permission.ChangeAvatar +
  Permission.UseExternalEmojis +
  Permission.UseSoundboard +
  THREAD_PERMISSIONS;

/**
 * An allow / deny pair as the API stores it
 */
export type PermissionOverride = { a: number | bigint; d: number | bigint };

/**
 * What a member may do in a server channel, in the API's order
 * (revolt-permissions `granted_in_channel`): the server default, the
 * channel's default override, the member's server roles, the channel's
 * overrides for those roles, then the member's own override. A server-wide
 * role allow therefore beats an @everyone deny on the channel, and an
 * override for the role on the channel beats both. Without View, nothing.
 * Administrator (from the server default or roles) gives everything.
 *
 * Roles go lowest first, so higher roles win.
 */
export function serverChannelPermission(input: {
  serverDefault: number | bigint;
  channelDefault?: PermissionOverride;
  serverRoles: PermissionOverride[];
  channelRoles: PermissionOverride[];
  member?: PermissionOverride;
  timedOut: boolean;
}): bigint {
  const apply = (value: bigint, o?: PermissionOverride) =>
    o ? (value | BigInt(o.a)) & ~BigInt(o.d) : value;

  // Administrator comes from the server default and roles only
  let server = BigInt(input.serverDefault);
  for (const role of input.serverRoles) server = apply(server, role);
  if ((server & Permission.Administrator) === Permission.Administrator) {
    return Permission.GrantAllSafe;
  }

  let perm = BigInt(input.serverDefault);
  perm = apply(perm, input.channelDefault);
  for (const role of input.serverRoles) perm = apply(perm, role);
  for (const role of input.channelRoles) perm = apply(perm, role);
  perm = apply(perm, input.member);

  if (input.timedOut) perm &= ALLOW_IN_TIMEOUT;
  if ((perm & Permission.ViewChannel) !== Permission.ViewChannel) return 0n;
  return perm;
}
