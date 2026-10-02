import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';

const PUBLIC_TRIGGER_NAMES = new Set(['➕┃channel-erstellen', 'channel-erstellen']);
const PRIVATE_TRIGGER_NAMES = new Set(['🔒┃privaten-channel-erstellen', 'privaten-channel-erstellen', 'premium-channel-erstellen']);

const ownedRooms = new Map();

function cleanName(value) {
  return String(value || 'User')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[@#:`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 45) || 'User';
}

function roomName(member, isPrivate) {
  const name = cleanName(member.displayName || member.user?.username);
  return isPrivate ? `🔒┃${name}` : `🔊┃${name}`;
}

function waitingName(member) {
  const name = cleanName(member.displayName || member.user?.username);
  return `⏳┃wartebereich-${name}`;
}

function ownerIdFromChannel(channel) {
  if (!channel?.permissionOverwrites?.cache) return null;

  const overwrite = channel.permissionOverwrites.cache.find(item =>
    item.type === 1 &&
    item.allow.has(PermissionFlagsBits.MoveMembers)
  );

  return overwrite?.id || null;
}

function findOwnedRoom(guild, memberId) {
  const tracked = ownedRooms.get(`${guild.id}:${memberId}`);
  if (tracked) {
    const channel = guild.channels.cache.get(tracked.roomId);
    if (channel) return { ...tracked, channel };
  }

  const channel = guild.channels.cache.find(candidate =>
    candidate.type === ChannelType.GuildVoice &&
    ownerIdFromChannel(candidate) === memberId &&
    !PUBLIC_TRIGGER_NAMES.has(candidate.name) &&
    !PRIVATE_TRIGGER_NAMES.has(candidate.name)
  );

  if (!channel) return null;

  const waiting = guild.channels.cache.find(candidate =>
    candidate.type === ChannelType.GuildVoice &&
    candidate.parentId === channel.parentId &&
    candidate.name === waitingName(guild.members.cache.get(memberId) || { displayName: '' })
  );

  return {
    roomId: channel.id,
    waitingId: waiting?.id || null,
    isPrivate: channel.name.startsWith('🔒┃'),
    channel
  };
}

async function createRoom(state, isPrivate) {
  const { guild, member, channel: trigger } = state;

  const existing = findOwnedRoom(guild, member.id);
  if (existing?.channel) {
    await member.voice.setChannel(existing.channel).catch(() => {});
    return true;
  }

  const baseOverwrites = [
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.ManageChannels
      ]
    },
    {
      id: guild.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak],
      ...(isPrivate
        ? { deny: [PermissionFlagsBits.Connect] }
        : { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] })
    }
  ];

  const room = await guild.channels.create({
    name: roomName(member, isPrivate),
    type: ChannelType.GuildVoice,
    parent: trigger.parentId,
    permissionOverwrites: baseOverwrites,
    reason: isPrivate ? 'Private join-to-create room' : 'Public join-to-create room'
  });

  let waiting = null;

  if (isPrivate) {
    waiting = await guild.channels.create({
      name: waitingName(member),
      type: ChannelType.GuildVoice,
      parent: trigger.parentId,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak
          ]
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.MoveMembers
          ]
        }
      ],
      reason: 'Waiting room for private join-to-create room'
    });
  }

  ownedRooms.set(`${guild.id}:${member.id}`, {
    roomId: room.id,
    waitingId: waiting?.id || null,
    isPrivate
  });

  await member.voice.setChannel(room);

  logger.info('[CustomVoice] Temporary room created', {
    guildId: guild.id,
    ownerId: member.id,
    roomId: room.id,
    waitingId: waiting?.id || null,
    isPrivate
  });

  return true;
}

async function deleteOwnedRoom(guild, ownerId, room) {
  const key = `${guild.id}:${ownerId}`;
  const tracked = ownedRooms.get(key);

  let waiting = tracked?.waitingId
    ? guild.channels.cache.get(tracked.waitingId)
    : null;

  if (!waiting && room?.name?.startsWith('🔒┃')) {
    const owner = guild.members.cache.get(ownerId);
    if (owner) {
      waiting = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildVoice &&
        channel.parentId === room.parentId &&
        channel.name === waitingName(owner)
      );
    }
  }

  if (waiting) {
    await waiting.delete('Private room owner left').catch(() => {});
  }

  if (room) {
    await room.delete('Temporary room owner left').catch(() => {});
  }

  ownedRooms.delete(key);

  logger.info('[CustomVoice] Temporary room deleted', {
    guildId: guild.id,
    ownerId,
    roomId: room?.id || null,
    waitingId: waiting?.id || null
  });
}

export async function handleCustomVoiceCreate(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user?.bot) return false;

  const joined = newState.channel;
  const left = oldState.channel;

  if (joined && PUBLIC_TRIGGER_NAMES.has(joined.name)) {
    await createRoom(newState, false);
    return true;
  }

  if (joined && PRIVATE_TRIGGER_NAMES.has(joined.name)) {
    await createRoom(newState, true);
    return true;
  }

  if (left && left.type === ChannelType.GuildVoice) {
    const ownerId = ownerIdFromChannel(left);

    if (ownerId && ownerId === member.id) {
      const isTempRoom =
        left.name.startsWith('🔊┃') ||
        left.name.startsWith('🔒┃');

      if (isTempRoom && (!joined || joined.id !== left.id)) {
        await deleteOwnedRoom(left.guild, ownerId, left);
        return true;
      }
    }
  }

  return false;
}
