import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { Mutex } from '../utils/mutex.js';
import { GAMES } from './roleSelectionService.js';

const PUBLIC_TRIGGER_NAMES = new Set(['➕┃channel-erstellen', 'channel-erstellen']);
const PRIVATE_TRIGGER_NAMES = new Set(['🔒┃privaten-channel-erstellen', 'privaten-channel-erstellen', 'premium-channel-erstellen']);
const VERIFIED_ROLE_NAME = 'verifiziert';

// Räume werden über ihre IDs in der DB verfolgt, nicht über den Namen.
// So überleben sie Bot-Neustarts und Umbenennungen.
function roomsKey(guildId) {
  return `guild:${guildId}:customvoice:rooms`;
}

async function loadRooms(client, guildId) {
  try {
    const data = await client.db?.get?.(roomsKey(guildId));
    return data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  } catch (error) {
    logger.warn('[CustomVoice] Could not load rooms', { guildId, error: error.message });
    return {};
  }
}

async function saveRooms(client, guildId, rooms) {
  try {
    await client.db?.set?.(roomsKey(guildId), rooms);
  } catch (error) {
    logger.warn('[CustomVoice] Could not save rooms', { guildId, error: error.message });
  }
}

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

function isTrigger(channel) {
  return PUBLIC_TRIGGER_NAMES.has(channel?.name) || PRIVATE_TRIGGER_NAMES.has(channel?.name);
}

function findVerifiedRole(guild) {
  return guild.roles.cache.find(role => role.name.toLowerCase() === VERIFIED_ROLE_NAME && !role.managed) || null;
}

function humansIn(channel) {
  return channel ? channel.members.filter(member => !member.user.bot) : null;
}

function ownerOverwrite(memberId) {
  return {
    id: memberId,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.MoveMembers
    ]
  };
}

function botOverwrite(guild) {
  return {
    id: guild.members.me.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.MoveMembers,
      // Für die Steuerungs-Box im Raum-Chat
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory
    ]
  };
}

// ---------- Raum-Steuerung (Box im Chat des Voice-Raums) ----------

export async function getRoomRecord(client, guildId, roomId) {
  return (await loadRooms(client, guildId))[roomId] || null;
}

export function buildControlPanel(record) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎛️ RAUM-STEUERUNG')
    .setDescription([
      `👑 Owner: <@${record.ownerId}> – nur der Owner kann die Steuerung benutzen.`,
      '',
      '🎮 **Spiel wählen** – Raumname wird zum Spiel',
      '✏️ **Umbenennen** – eigener Name',
      '👥 **Limit** – maximale Anzahl Leute',
      ...(record.isPrivate ? [] : ['🔒 **Sperren/Öffnen** – niemand Neues kann mehr rein']),
      '👢 **Rauswerfen** – jemanden aus dem Raum werfen'
    ].join('\n'))
    .setFooter({ text: 'Discord erlaubt nur 2 Namensänderungen pro 10 Minuten.' });

  const gameSelect = new StringSelectMenuBuilder()
    .setCustomId('voice:game')
    .setPlaceholder('🎮 Spiel wählen …')
    .addOptions(
      ...Object.entries(GAMES).map(([key, game]) => ({ label: game.name, value: key, emoji: game.emoji })),
      { label: 'Zurück zu meinem Namen', value: 'reset', emoji: '🔊' }
    );

  const buttons = [
    new ButtonBuilder().setCustomId('voice:rename').setLabel('Umbenennen').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice:limit').setLabel('Limit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    ...(record.isPrivate ? [] : [new ButtonBuilder().setCustomId('voice:lock').setLabel('Sperren/Öffnen').setEmoji('🔒').setStyle(ButtonStyle.Secondary)]),
    new ButtonBuilder().setCustomId('voice:kick').setLabel('Rauswerfen').setEmoji('👢').setStyle(ButtonStyle.Danger)
  ];

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(gameSelect), new ActionRowBuilder().addComponents(buttons)]
  };
}

export function ownerRoomName(member, isPrivate) {
  return roomName(member, isPrivate);
}

export function customRoomName(text, isPrivate) {
  return `${isPrivate ? '🔒' : '🔊'}┃${cleanName(text)}`;
}

export function gameRoomName(game, isPrivate) {
  return `${isPrivate ? '🔒' : game.emoji}┃${game.name}`;
}

// Umbenennen kann wegen Discords Limit (2x pro 10 Min.) hängen → nach 3 Sek. nicht mehr warten.
export async function renameRoom(room, name) {
  const rename = room.setName(name).then(() => 'done').catch(() => 'failed');
  const timeout = new Promise(resolve => setTimeout(() => resolve('delayed'), 3000));
  return Promise.race([rename, timeout]);
}

export function lockTarget(guild) {
  return findVerifiedRole(guild)?.id || guild.id;
}

export async function toggleRoomLock(room) {
  const targetId = lockTarget(room.guild);
  const locked = room.permissionOverwrites.cache.get(targetId)?.deny.has(PermissionFlagsBits.Connect) ?? false;
  await room.permissionOverwrites.edit(targetId, { Connect: locked }, { reason: locked ? 'Raum geöffnet' : 'Raum gesperrt' });
  return !locked;
}

// Sichtbar nur für "Verifiziert". Fehlt die Rolle, gilt das alte Verhalten (@everyone).
function audienceOverwrites(guild, { canConnect }) {
  const verifiedRole = findVerifiedRole(guild);
  const access = canConnect
    ? { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
    : { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak], deny: [PermissionFlagsBits.Connect] };

  if (!verifiedRole) {
    logger.warn('[CustomVoice] Role "Verifiziert" not found, falling back to @everyone visibility', { guildId: guild.id });
    return [{ id: guild.id, ...access }];
  }

  return [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
    { id: verifiedRole.id, ...access }
  ];
}

async function createRoom(state, isPrivate, rooms) {
  const { guild, member, channel: trigger } = state;

  const existingId = Object.keys(rooms).find(roomId =>
    rooms[roomId].ownerId === member.id && guild.channels.cache.has(roomId)
  );
  if (existingId) {
    await member.voice.setChannel(existingId).catch(() => {});
    return;
  }

  const room = await guild.channels.create({
    name: roomName(member, isPrivate),
    type: ChannelType.GuildVoice,
    parent: trigger.parentId,
    permissionOverwrites: [
      ...audienceOverwrites(guild, { canConnect: !isPrivate }),
      ownerOverwrite(member.id),
      botOverwrite(guild)
    ],
    reason: isPrivate ? 'Private join-to-create room' : 'Public join-to-create room'
  });

  let waiting = null;

  if (isPrivate) {
    waiting = await guild.channels.create({
      name: waitingName(member),
      type: ChannelType.GuildVoice,
      parent: trigger.parentId,
      permissionOverwrites: [
        ...audienceOverwrites(guild, { canConnect: true }),
        ownerOverwrite(member.id),
        botOverwrite(guild)
      ],
      reason: 'Waiting room for private join-to-create room'
    });
  }

  rooms[room.id] = {
    ownerId: member.id,
    waitingId: waiting?.id || null,
    isPrivate,
    createdAt: new Date().toISOString()
  };

  logger.info('[CustomVoice] Temporary room created', {
    guildId: guild.id,
    ownerId: member.id,
    roomId: room.id,
    waitingId: waiting?.id || null,
    isPrivate
  });

  const moved = member.voice.channelId === trigger.id
    && await member.voice.setChannel(room).then(() => true).catch(() => false);

  // User hat den Trigger in der Zwischenzeit verlassen → leeren Raum gleich wieder entfernen.
  if (!moved) {
    await evaluateRoom(guild, room.id, rooms);
    return;
  }

  await room.send(buildControlPanel(rooms[room.id])).catch(error => {
    logger.warn('[CustomVoice] Could not post control panel', { roomId: room.id, error: error.message });
  });
}

async function deleteRoom(guild, roomId, record, rooms) {
  const room = guild.channels.cache.get(roomId);
  const waiting = record.waitingId ? guild.channels.cache.get(record.waitingId) : null;

  if (waiting) await waiting.delete('Temporary room closed').catch(() => {});
  if (room) await room.delete('Temporary room empty').catch(() => {});

  delete rooms[roomId];

  logger.info('[CustomVoice] Temporary room deleted', {
    guildId: guild.id,
    ownerId: record.ownerId,
    roomId,
    waitingId: record.waitingId || null
  });
}

async function transferRoom(guild, roomId, record, newOwner) {
  const room = guild.channels.cache.get(roomId);
  const waiting = record.waitingId ? guild.channels.cache.get(record.waitingId) : null;
  const oldOwnerId = record.ownerId;

  record.ownerId = newOwner.id;

  for (const channel of [room, waiting]) {
    if (!channel) continue;
    await channel.permissionOverwrites.delete(oldOwnerId, 'Temporary room owner changed').catch(() => {});
    await channel.permissionOverwrites.edit(newOwner.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      MoveMembers: true
    }, { reason: 'Temporary room owner changed' }).catch(() => {});
  }

  // Umbenennen ist auf 2x pro 10 Min. limitiert und würde sonst blockieren → nicht abwarten.
  room?.setName(roomName(newOwner, record.isPrivate)).catch(() => {});
  waiting?.setName(waitingName(newOwner)).catch(() => {});

  room?.send({
    content: `👑 ${newOwner} ist jetzt Owner dieses Raums und kann die Raum-Steuerung oben benutzen.`,
    allowedMentions: { users: [newOwner.id] }
  }).catch(() => {});

  logger.info('[CustomVoice] Temporary room owner transferred', {
    guildId: guild.id,
    roomId,
    oldOwnerId,
    newOwnerId: newOwner.id
  });
}

// Entscheidet für einen Raum: behalten, Owner übertragen oder löschen.
async function evaluateRoom(guild, roomId, rooms) {
  const record = rooms[roomId];
  if (!record) return;

  const room = guild.channels.cache.get(roomId);
  const waiting = record.waitingId ? guild.channels.cache.get(record.waitingId) : null;

  if (!room) {
    if (waiting) await waiting.delete('Temporary room no longer exists').catch(() => {});
    delete rooms[roomId];
    return;
  }

  const humans = humansIn(room);
  const ownerInRoom = humans.has(record.ownerId);
  const ownerInWaiting = Boolean(waiting && humansIn(waiting).has(record.ownerId));

  // Owner holt gerade jemanden aus seinem Wartebereich → nichts tun.
  if (ownerInRoom || ownerInWaiting) return;

  if (humans.size === 0) {
    await deleteRoom(guild, roomId, record, rooms);
    return;
  }

  await transferRoom(guild, roomId, record, humans.first());
}

function findRoomIdForChannel(rooms, channelId) {
  if (!channelId) return null;
  if (rooms[channelId]) return channelId;
  return Object.keys(rooms).find(roomId => rooms[roomId].waitingId === channelId) || null;
}

export async function handleCustomVoiceCreate(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user?.bot) return false;

  const guild = newState.guild;
  const client = guild.client;
  const joined = newState.channel;
  const leftId = oldState.channelId !== newState.channelId ? oldState.channelId : null;
  const joinedTrigger = joined && oldState.channelId !== newState.channelId && isTrigger(joined);

  return Mutex.runExclusive(`customvoice:${guild.id}`, async () => {
    const rooms = await loadRooms(client, guild.id);
    const before = JSON.stringify(rooms);
    const leftRoomId = findRoomIdForChannel(rooms, leftId);

    try {
      if (leftRoomId) {
        await evaluateRoom(guild, leftRoomId, rooms);
      }

      if (joinedTrigger) {
        await createRoom(newState, PRIVATE_TRIGGER_NAMES.has(joined.name), rooms);
      }
    } finally {
      if (JSON.stringify(rooms) !== before) {
        await saveRooms(client, guild.id, rooms);
      }
    }

    return Boolean(joinedTrigger || leftRoomId);
  });
}

// Beim Start: verwaiste Räume aufräumen, die während eines Neustarts leer geworden sind.
export async function cleanupCustomVoiceRooms(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await Mutex.runExclusive(`customvoice:${guild.id}`, async () => {
        const rooms = await loadRooms(client, guild.id);
        const before = JSON.stringify(rooms);

        for (const roomId of Object.keys(rooms)) {
          await evaluateRoom(guild, roomId, rooms);
        }

        await cleanupLegacyRooms(guild, rooms);

        if (JSON.stringify(rooms) !== before) {
          await saveRooms(client, guild.id, rooms);
        }
      });
    } catch (error) {
      logger.error('[CustomVoice] Startup cleanup failed', { guildId: guild.id, error: error.message });
    }
  }
}

// Räume aus der alten Version (noch nicht in der DB): leer + Owner-Overwrite → löschen.
async function cleanupLegacyRooms(guild, rooms) {
  const trackedIds = new Set();
  for (const [roomId, record] of Object.entries(rooms)) {
    trackedIds.add(roomId);
    if (record.waitingId) trackedIds.add(record.waitingId);
  }

  const triggerParents = new Set(
    guild.channels.cache.filter(channel => isTrigger(channel)).map(channel => channel.parentId)
  );

  const legacy = guild.channels.cache.filter(channel =>
    channel.type === ChannelType.GuildVoice &&
    triggerParents.has(channel.parentId) &&
    !trackedIds.has(channel.id) &&
    !isTrigger(channel) &&
    (channel.name.startsWith('🔊┃') || channel.name.startsWith('🔒┃') || channel.name.startsWith('⏳┃wartebereich-')) &&
    channel.permissionOverwrites.cache.some(overwrite => overwrite.type === 1 && overwrite.allow.has(PermissionFlagsBits.MoveMembers)) &&
    humansIn(channel).size === 0
  );

  for (const channel of legacy.values()) {
    await channel.delete('Leftover temporary room from before restart').catch(() => {});
    logger.info('[CustomVoice] Legacy temporary room deleted', { guildId: guild.id, channelId: channel.id });
  }
}
