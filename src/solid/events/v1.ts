import type { Setter } from "solid-js";
import { batch } from "solid-js";

import { ReactiveSet } from "@solid-primitives/set";

import type { ServerMessage } from "../../core/protocol.js";
import type { Client } from "../Client.js";
import { MessageEmbed } from "../classes/MessageEmbed.js";
import { ServerRole } from "../classes/ServerRole.js";
import { VoiceParticipant } from "../classes/VoiceParticipant.js";
import { hydrate } from "../hydration/index.js";

export type { ProtocolV1 } from "../../core/protocol.js";
/**
 * Handle an event for the Client
 * @param client Client
 * @param event Event
 * @param setReady Signal state change
 */
export async function handleEvent(
  client: Client,
  event: ServerMessage,
  setReady: Setter<boolean>,
): Promise<void> {
  if (client.options.debug) {
    console.debug("[S->C]", event);
  }

  switch (event.type) {
    case "Ready": {
      // events may have changed while the gateway was away
      client.serverEvents.resetLoaded();
      batch(() => {
        if (event.users) {
          for (const user of event.users) {
            const u = client.users.getOrCreate(user._id, user);

            if (u.relationship === "User") {
              client.user = u;
            }
          }
        }

        if (event.servers) {
          for (const server of event.servers) {
            client.servers.getOrCreate(server._id, server);
          }
        }

        if (event.members) {
          for (const member of event.members) {
            client.serverMembers.getOrCreate(member._id, member);
          }
        }

        if (event.channels) {
          for (const channel of event.channels) {
            client.channels.getOrCreate(channel._id, channel);
          }
        }

        if (event.voice_states) {
          // Ready lists every live room: a room left out emptied while we were
          // disconnected, so it must not keep the participants we knew before.
          const live = new Set(event.voice_states.map((state) => state.id));
          for (const channel of client.channels.values()) {
            if (!live.has(channel.id) && channel.voiceParticipants.size) {
              channel.voiceParticipants.clear();
            }
          }

          for (const state of event.voice_states) {
            const channel = client.channels.get(state.id);
            if (channel) {
              channel.voiceParticipants.clear();

              for (const participant of state.participants) {
                channel.voiceParticipants.set(
                  participant.id,
                  new VoiceParticipant(client, participant),
                );
              }
            }
          }
        }
        if (event.emojis) {
          for (const emoji of event.emojis) {
            client.emojis.getOrCreate(emoji._id, emoji);
          }
        }
      });

      if (client.options.syncUnreads) {
        // never block Ready on unread state: a 429 here kept the app on
        // "Connecting…"; the sync retries later with backoff
        client.channelUnreads.syncInBackground();
      }

      setReady(true);
      client.emit("ready");

      if (event.policy_changes?.length) {
        client.emit("policyChanges", event.policy_changes, async () =>
          client.api.post("/policy/acknowledge"),
        );
      }

      break;
    }
    case "Message": {
      if (!client.messages.has(event._id)) {
        batch(() => {
          if (event.member) {
            client.serverMembers.getOrCreate(event.member._id, event.member);
          }

          if (event.user) {
            client.users.getOrCreate(event.user._id, event.user);
          }

          delete event.member;
          delete event.user;

          client.messages.getOrCreate(event._id, event, true);

          const channel = client.channels.get(event.channel);
          if (!channel) return;

          // whoever just sent a message has stopped typing
          if (channel.typingIds.has(event.author)) {
            handleEvent(
              client,
              { type: "ChannelStopTyping", id: channel.id, user: event.author },
              setReady,
            );
          }

          client.channels.updateUnderlyingObject(
            channel.id,
            "lastMessageId",
            event._id,
          );

          // this account's own message (from here or another session) is
          // read: the server acks it for the author when it is sent
          if (event.author === client.user?.id) {
            if (client.options.syncUnreads) {
              client.channelUnreads.advance(channel.id, event._id);
            }
          } else if (
            event.mentions?.includes(client.user!.id) &&
            client.options.syncUnreads
          ) {
            const unread = client.channelUnreads.for(channel);
            client.channelUnreads.markLocal(channel.id, "mention");
            unread.messageMentionIds.add(event._id);
            client.channels.updateUnderlyingObject(
              event.channel,
              "lastMessageId",
              event._id,
            );
          }
        });
      }
      break;
    }
    case "MessageUpdate": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const previousMessage = {
          ...client.messages.getUnderlyingObject(event.id),
          channelId: event.channel,
        };

        client.messages.updateUnderlyingObject(event.id, {
          ...hydrate(
            "message",
            { ...event.data, channel: event.channel },
            client,
            false,
          ),
          // only real edits carry `edited`; a bot updating its message from a
          // button or menu does not
        });

        client.emit("messageUpdate", message, previousMessage);
      }
      break;
    }
    case "MessageAppend": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const previousMessage = {
          ...client.messages.getUnderlyingObject(event.id),
          channelId: event.channel,
        };

        client.messages.updateUnderlyingObject(event.id, "embeds", (embeds) => [
          ...(embeds ?? []),
          ...(event.append.embeds?.map((embed) =>
            MessageEmbed.from(client, embed),
          ) ?? []),
        ]);

        client.messages.updateUnderlyingObject(
          event.id,
          "channelId",
          event.channel,
        );

        client.emit("messageUpdate", message, previousMessage);
      }
      break;
    }
    case "MessageDelete": {
      if (client.messages.getOrPartial(event.id)) {
        const message = client.messages.getUnderlyingObject(event.id);
        client.emit("messageDelete", message);
        client.messages.delete(event.id);
      }
      break;
    }
    case "BulkMessageDelete": {
      batch(() =>
        client.emit(
          "messageDeleteBulk",
          event.ids
            .map((id) => {
              if (client.messages.has(id)) {
                const message = client.messages.getUnderlyingObject(id);
                client.messages.delete(id);
                return message!;
              }

              return undefined!;
            })
            .filter((x) => x),
          client.channels.get(event.channel),
        ),
      );
      break;
    }
    case "MessageReact": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const reactions = message.reactions;
        const set = reactions.get(event.emoji_id)!;
        if (set) {
          if (set.has(event.user_id)) return;
          set.add(event.user_id);
        } else {
          reactions.set(event.emoji_id, new ReactiveSet([event.user_id]));
        }

        client.emit(
          "messageReactionAdd",
          message,
          event.user_id,
          event.emoji_id,
        );
      }
      break;
    }
    case "MessageUnreact": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const set = message.reactions.get(event.emoji_id);
        if (set?.has(event.user_id)) {
          if (
            set.size === 1 &&
            !message.interactions?.reactions?.includes(event.emoji_id)
          ) {
            message.reactions.delete(event.emoji_id);
          } else {
            set.delete(event.user_id);
          }
        } else if (!client.messages.isPartial(event.id)) {
          return;
        }

        client.emit(
          "messageReactionRemove",
          message,
          event.user_id,
          event.emoji_id,
        );
      }
      break;
    }
    case "MessageRemoveReaction": {
      const message = client.messages.getOrPartial(event.id);
      if (message) {
        const reactions = message.reactions;
        if (reactions.has(event.emoji_id)) {
          reactions.delete(event.emoji_id);
        } else if (!client.messages.isPartial(event.id)) {
          return;
        }

        client.emit("messageReactionRemoveEmoji", message, event.emoji_id);
      }
      break;
    }
    case "ChannelCreate": {
      if (!client.channels.has(event._id)) {
        const channel = client.channels.getOrCreate(event._id, event, true);
        // a channel that became visible again (a role or permission change)
        // was dropped from its server's list when it was hidden
        const server = channel.server;
        // threads live in the threads panel and under their parent, never
        // in the server's channel list
        if (
          server &&
          !channel.parentId &&
          !channel.isThread &&
          !server.channelIds.has(channel.id)
        ) {
          server.channelIds.add(channel.id);
        }
      }
      break;
    }
    case "ChannelUpdate": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        const previousChannel = {
          ...client.channels.getUnderlyingObject(event.id),
        };

        const changes = hydrate("channel", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            switch (remove) {
              case "Description":
                changes["description"] = undefined;
                break;
              case "DefaultPermissions":
                changes["defaultPermissions"] = undefined;
                break;
              case "Icon":
                changes["icon"] = undefined;
                break;
            }
          }
        }

        client.channels.updateUnderlyingObject(event.id, changes);
        client.emit("channelUpdate", channel, previousChannel);
      }
      break;
    }
    case "ChannelDelete": {
      if (client.channels.getOrPartial(event.id)) {
        const channel = client.channels.getUnderlyingObject(event.id);
        client.emit("channelDelete", channel);
        client.channels.delete(event.id);
      }
      break;
    }
    case "ChannelGroupJoin": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (!channel.recipientIds.has(event.user)) {
          channel.recipientIds.add(event.user);
        } else if (!client.channels.isPartial(event.id)) {
          return;
        }

        client.emit(
          "channelGroupJoin",
          channel,
          await client.users.fetch(event.user),
        );
      }
      break;
    }
    case "ChannelGroupLeave": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (channel.recipientIds.has(event.user)) {
          channel.recipientIds.delete(event.user);
        } else if (!client.channels.isPartial(event.id)) {
          return;
        }

        client.emit(
          "channelGroupLeave",
          channel,
          client.users.getOrPartial(event.user)!,
        );
      }
      break;
    }
    case "ChannelStartTyping": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (!channel.typingIds.has(event.user)) {
          channel.typingIds.add(event.user);

          clearTimeout(channel._typingTimers[event.user]);
          channel._typingTimers[event.user] = setTimeout(
            () =>
              handleEvent(
                client,
                { ...event, type: "ChannelStopTyping" },
                setReady,
              ),
            4000,
          );

          client.emit(
            "channelStartTyping",
            channel,
            client.users.getOrPartial(event.user)!,
          );
        }
      }
      break;
    }
    case "ChannelStopTyping": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        if (channel.typingIds.has(event.user)) {
          channel.typingIds.delete(event.user);

          clearTimeout(channel._typingTimers[event.user]);
          delete channel._typingTimers[event.user];

          client.emit(
            "channelStopTyping",
            channel,
            client.users.getOrPartial(event.user)!,
          );
        }
      }
      break;
    }
    case "ChannelAck": {
      const channel = client.channels.getOrPartial(event.id);
      // another session of this account read the channel: it is read here too
      if (client.options.syncUnreads && event.user === client.user?.id) {
        client.channelUnreads.advance(event.id, event.message_id);
      }
      if (channel) {
        client.emit("channelAcknowledged", channel, event.message_id);
      }
      break;
    }
    case "ServerCreate": {
      if (!client.servers.has(event.server._id)) {
        batch(() => {
          for (const channel of event.channels) {
            client.channels.getOrCreate(channel._id, channel);
          }

          client.servers.getOrCreate(event.server._id, event.server, true);
        });
      }
      break;
    }
    case "ServerUpdate": {
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        const previousServer = {
          ...client.servers.getUnderlyingObject(event.id),
        };

        const changes = hydrate("server", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            switch (remove) {
              case "Banner":
                changes["banner"] = undefined;
                break;
              case "Categories":
                changes["categories"] = undefined;
                break;
              case "SystemMessages":
                changes["systemMessages"] = undefined;
                break;
              case "Description":
                changes["description"] = undefined;
                break;
              case "Icon":
                changes["icon"] = undefined;
                break;
            }
            // Zrzur fields, not in the upstream API types
            switch (remove as string) {
              case "RulesChannel":
                changes["rulesChannelId"] = undefined;
                break;
              case "Stats":
                changes["stats"] = undefined;
                break;
              case "Lobby":
                changes["lobby"] = undefined;
                break;
              case "VanityInvite":
                changes["vanityInvite"] = undefined;
                break;
            }
          }
        }

        client.servers.updateUnderlyingObject(event.id, changes);
        client.emit("serverUpdate", server, previousServer);
      }
      break;
    }
    case "ServerDelete": {
      client.serverEvents.forgetServer(event.id);
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        // TODO: server should tell us if it's a leave or delete on our end
        server.$delete();
      }
      break;
    }
    case "ServerRoleUpdate": {
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        const role = server.roles.get(event.role_id);
        server.roles.set(
          event.role_id,
          role
            ? role.with(event.data)
            : new ServerRole(client, server.id, event.role_id, {
                _id: event.role_id,
                name: "",
                permissions: { a: 0, d: 0 },
                ...event.data,
              }),
        );

        client.emit("serverRoleUpdate", server, event.role_id, role?.data);
      }
      break;
    }
    case "ServerRoleRanksUpdate": {
      const server = client.servers.getOrPartial(event.id);
      if (server && event.ranks) {
        event.ranks.forEach((roleId: string, idx: number) => {
          const role = server.roles.get(roleId);
          if (role) {
            server.roles.set(roleId, role.with({ rank: idx }));
          }
        });
        client.emit("serverRoleRanksUpdate", server, event.ranks);
      }
      break;
    }
    case "ServerRoleDelete": {
      const server = client.servers.getOrPartial(event.id);
      if (server) {
        const roles = server.roles;
        const role = roles.get(event.role_id);
        if (role) {
          roles.delete(event.role_id);
        } else if (!client.servers.isPartial(event.id)) {
          return;
        }

        client.emit("serverRoleDelete", server, event.role_id, role?.data);
      }
      break;
    }
    case "ServerMemberJoin": {
      const id = {
        server: event.id,
        user: event.user,
      };

      if (!client.serverMembers.hasByKey(id)) {
        if (!client.users.has(id.user)) {
          if (client.options.eagerFetching) {
            await client.users.fetch(id.user);
          }
        }

        client.emit(
          "serverMemberJoin",
          client.serverMembers.getOrCreate(id, {
            _id: id,
            joined_at: new Date().toUTCString(),
          }),
        );
      }
      break;
    }
    case "ServerMemberUpdate": {
      const member = client.serverMembers.getOrPartial(event.id);
      if (member) {
        const previousMember = {
          ...client.serverMembers.getUnderlyingObject(
            event.id.server + event.id.user,
          ),
        };

        const changes = hydrate("serverMember", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            switch (remove) {
              case "Nickname":
                changes["nickname"] = undefined;
                break;
              case "Avatar":
                changes["avatar"] = undefined;
                break;
              case "Roles":
                changes["roles"] = [];
                break;
              case "Timeout":
                changes["timeout"] = undefined;
                break;
              case "Pronouns":
                changes["pronouns"] = undefined;
                break;
              case "CanPublish":
                changes["canPublish"] = undefined;
                break;
              case "CanReceive":
                changes["canReceive"] = undefined;
                break;
            }
          }
        }

        client.serverMembers.updateUnderlyingObject(
          event.id.server + event.id.user,
          changes,
        );

        client.emit("serverMemberUpdate", member, previousMember);
      }
      break;
    }
    case "ServerMemberLeave": {
      if (event.user && event.user === client.user!.id) {
        handleEvent(
          client,
          {
            type: "ServerDelete",
            id: event.id,
          },
          setReady,
        );

        return;
      }

      const id = {
        server: event.id,
        user: event.user,
      };

      if (client.serverMembers.getOrPartial(id)) {
        const member = client.serverMembers.getUnderlyingObject(
          id.server + id.user,
        );

        client.emit("serverMemberLeave", member);
        client.serverMembers.delete(id.server + id.user);
      }
      break;
    }
    case "UserUpdate": {
      const user = client.users.getOrPartial(event.id);
      if (user) {
        const previousUser = {
          ...client.users.getUnderlyingObject(event.id),
        };

        const changes = hydrate("user", event.data, client, false);

        if (event.clear) {
          for (const remove of event.clear) {
            switch (remove) {
              case "Avatar":
                changes["avatar"] = undefined;
                break;
              case "StatusPresence":
                changes["status"] = {
                  ...(previousUser.status ?? {}),
                  ...(changes["status"] ?? {}),
                  presence: undefined,
                };
                break;
              case "StatusText":
                changes["status"] = {
                  ...(previousUser.status ?? {}),
                  ...(changes["status"] ?? {}),
                  text: undefined,
                };
                break;
              case "Pronouns":
                changes["pronouns"] = undefined;
                break;
              case "Style":
                changes["style"] = undefined;
                break;
            }
          }
        }

        client.users.updateUnderlyingObject(event.id, changes);
        client.emit("userUpdate", user, previousUser);
      }
      break;
    }
    case "UserRelationship": {
      // Live UserUpdate events are dropped for unknown users (see UserUpdate
      // below), so make sure this user exists in the cache before delegating.
      client.users.getOrCreate(event.user._id, event.user);

      handleEvent(
        client,
        {
          type: "UserUpdate",
          id: event.user._id,
          data: {
            relationship: event.user.relationship!,
          },
        },
        setReady,
      );
      break;
    }
    case "UserPresence": {
      handleEvent(
        client,
        {
          type: "UserUpdate",
          id: event.id,
          data: {
            online: event.online,
          },
        },
        setReady,
      );
      break;
    }
    case "UserSettingsUpdate": {
      client.emit("userSettingsUpdate", event.id, event.update);
      break;
    }
    case "UserPlatformWipe": {
      batch(() => {
        handleEvent(
          client,
          {
            type: "BulkMessageDelete",
            channel: "0",
            ids: client.messages
              .toList()
              .filter((message) => message.authorId === event.user_id)
              .map((message) => message.id),
          },
          setReady,
        );

        handleEvent(
          client,
          {
            type: "UserUpdate",
            id: event.user_id,
            data: {
              username: `Deleted User`,
              online: false,
              flags: event.flags,
              badges: 0,
              relationship: "None",
            },
            clear: ["Avatar", "StatusPresence", "StatusText"],
          },
          setReady,
        );
      });

      break;
    }
    case "EmojiCreate": {
      if (!client.emojis.has(event._id)) {
        client.emojis.getOrCreate(event._id, event, true);
      }
      break;
    }
    case "EmojiDelete": {
      if (client.emojis.getOrPartial(event.id)) {
        const emoji = client.emojis.getUnderlyingObject(event.id);
        client.emit("emojiDelete", emoji);
        client.emojis.delete(event.id);
      }
      break;
    }
    case "Auth": {
      // TODO: implement DeleteSession and DeleteAllSessions
      break;
    }
    case "ServerEventCreate": {
      const { type: _, ...created } = event;
      client.serverEvents.upsert(created);
      break;
    }
    case "ServerEventUpdate": {
      const before = client.serverEvents.upsert(event.event);
      if (
        event.event.status === "Active" &&
        before?.status !== "Active" &&
        client.serverEvents.isInterested(event.event._id)
      ) {
        client.emit("serverEventStarted", event.event);
      }
      break;
    }
    case "ServerEventDelete": {
      client.serverEvents.remove(event.id);
      break;
    }
    case "ServerEventInterest": {
      client.serverEvents.interest(
        event.id,
        event.user,
        event.interested,
        event.count,
      );
      break;
    }
    case "AccountAgeUpdate": {
      client.emit("accountAgeUpdate", event.band);
      break;
    }
    case "VoiceChannelJoin": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        channel.voiceParticipants.set(
          event.state.id,
          new VoiceParticipant(client, event.state),
        );
        // todo: event
      }
      break;
    }
    case "VoiceChannelLeave": {
      const channel = client.channels.getOrPartial(event.id);
      if (channel) {
        channel.voiceParticipants.delete(event.user);
        // todo: event
      }
      client.emit("voiceChannelLeave", event.id, event.user);
      break;
    }
    case "VoiceChannelMove": {
      client.channels
        .getOrPartial(event.from)
        ?.voiceParticipants.delete(event.user);
      client.channels
        .getOrPartial(event.to)
        ?.voiceParticipants.set(
          event.user,
          new VoiceParticipant(client, event.state),
        );
      break;
    }
    case "UserVoiceStateUpdate": {
      const channel = client.channels.getOrPartial(event.channel_id);
      if (channel) {
        channel.voiceParticipants.get(event.id)?.update(event.data);
        // todo: event
      }
      break;
    }
    case "UserMoveVoiceChannel": {
      client.emit("userMoveVoiceChannel", {
        node: event.node,
        from: event.from,
        to: event.to,
        token: event.token,
      });
      break;
    }
    case "UserSlowmodes": {
      for (const slowmode of event.slowmodes) {
        const channel = client.channels.getOrPartial(slowmode.channel_id);
        if (channel) {
          channel.setUserSlowmode(slowmode);
        }
      }
      client.emit("userSlowmodes");
      break;
    }
  }
}
