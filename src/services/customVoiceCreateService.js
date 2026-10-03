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

// Liest den echten Zustand aus den Channel-Rechten → die Box zeigt immer, was wirklich gilt.
export function getRoomState(room) {
  const overwrite = room.permissionOverwrites.cache.get(lockTarget(room.guild));
  return {
    isClosed: overwrite?.deny.has(PermissionFlagsBits.Connect) ?? false,
    isHidden: overwrite?.deny.has(PermissionFlagsBits.ViewChannel) ?? false,
    limit: room.userLimit || 0
  };
}

export function buildControlPanel(record, room) {
  const state = getRoomState(room);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎛️ Raum-Steuerung')
    .setDescription('Steuere deinen Raum mit den Buttons unten. Änderungen siehst du hier sofort.')
    .addFields(
      { name: 'Besitzer', value: `<@${record.ownerId}>`, inline: true },
      { name: 'Zugang', value: state.isClosed ? '🔒 Privat' : '🔓 Öffentlich', inline: true },
      { name: 'Sichtbar', value: state.isHidden ? '🙈 Nein' : '👁️ Ja', inline: true },
      { name: 'Limit', value: state.limit > 0 ? `👥 ${state.limit}` : '∞', inline: true },
      ...(record.waitingId ? [{ name: 'Wartebereich', value: `<#${record.waitingId}>`, inline: true }] : [])
    )
    .setFooter({ text: 'Nur der Besitzer kann den Raum steuern • Umbenennen max. 2x pro 10 Min. (Discord-Limit)' });

  const gameSelect = new StringSelectMenuBuilder()
    .setCustomId('voice:game')
    .setPlaceholder('🎮 Spiel wählen …')
    .addOptions(
      ...Object.entries(GAMES).map(([key, game]) => ({ label: game.name, value: key, emoji: game.emoji })),
      { label: 'Zurück zu meinem Namen', value: 'reset', emoji: '🔊' }
    );

  const toggles = [
    new ButtonBuilder().setCustomId('voice:access')
      .setLabel(state.isClosed ? 'Öffentlich' : 'Privat').setEmoji(state.isClosed ? '🔓' : '🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice:visibility')
      .setLabel(state.isHidden ? 'Sichtbar' : 'Unsichtbar').setEmoji(state.isHidden ? '👁️' : '🙈').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice:limit').setLabel('Limit').setEmoji('👥').setStyle(ButtonStyle.Secondary)
  ];

  const actions = [
    new ButtonBuilder().setCustomId('voice:rename').setLabel('Umbenennen').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice:kick').setLabel('Rauswerfen').setEmoji('👢').setStyle(ButtonStyle.Danger)
  ];

  return {
    content: `<@${record.ownerId}>, das ist **dein** Raum.`,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(gameSelect),
      new ActionRowBuilder().addComponents(toggles),
      new ActionRowBuilder().addComponents(actions)
    ],
    allowedMentions: { parse: [] }
  };
}

// Bearbeitet die vorhandene Box; fehlt sie, wird eine neue gepostet. Gibt die Nachrichten-ID zurück.
async function updateControlPanel(room, record, { ping = false } = {}) {
  const payload = buildControlPanel(record, room);
  const existing = record.panelMessageId ? await room.messages.fetch(record.panelMessageId).catch(() => null) : null;
  if (existing) {
    await existing.edit(payload).catch(() => {});
    return existing.id;
  }
  const sent = await room.send({ ...payload, allowedMentions: ping ? { users: [record.ownerId] } : { parse: [] } }).catch(error => {
    logger.warn('[CustomVoice] Could not post control panel', { roomId: room.id, error: error.message });
    return null;
  });
  return sent?.id || null;
}

// Für die Buttons: Box nach einer Änderung aktualisieren (und ggf. neue Nachrichten-ID speichern).
export async function refreshControlPanel(client, room) {
  await Mutex.runExclusive(`customvoice:${room.guild.id}`, async () => {
    const rooms = await loadRooms(client, room.guild.id);
    const record = rooms[room.id];
    if (!record) return;
    const messageId = await updateControlPanel(room, record);
    if (messageId && messageId !== record.panelMessageId) {
      record.panelMessageId = messageId;
      await saveRooms(client, room.guild.id, rooms);
    }
  });
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

// Privat ↔ Öffentlich. Gibt zurück, ob der Raum jetzt privat ist.
export async function toggleRoomAccess(room) {
  const { isClosed } = getRoomState(room);
  await room.permissionOverwrites.edit(lockTarget(room.guild), { Connect: isClosed }, { reason: isClosed ? 'Raum geöffnet' : 'Raum privat' });
  return !isClosed;
}

// Sichtbar ↔ Unsichtbar. Wer schon drin ist, behält Zugriff. Gibt zurück, ob der Raum jetzt unsichtbar ist.
export async function toggleRoomVisibility(room) {
  const { isHidden } = getRoomState(room);
  if (!isHidden) {
    for (const member of humansIn(room).values()) {
      await room.permissionOverwrites.edit(member.id, { ViewChannel: true, Connect: true }, { reason: 'Bleibt im unsichtbaren Raum' }).catch(() => {});
    }
  }
  await room.permissionOverwrites.edit(lockTarget(room.guild), { ViewChannel: isHidden }, { reason: isHidden ? 'Raum sichtbar' : 'Raum unsichtbar' });
  return !isHidden;
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
    // Beitritts-Reihenfolge: wer als Nächstes kam, wird Owner, wenn der Owner geht.
    joinOrder: [],
    panelMessageId: null,
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

  rooms[room.id].panelMessageId = await updateControlPanel(room, rooms[room.id], { ping: true });
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

  if (room) {
    record.panelMessageId = await updateControlPanel(room, record);
    room.send({
      content: `👑 ${newOwner} ist jetzt Besitzer dieses Raums und kann die Raum-Steuerung oben benutzen.`,
      allowedMentions: { users: [newOwner.id] }
    }).catch(() => {});
  }

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

  // Nachfolger: wer nach dem Owner als Nächstes beigetreten ist (Fallback: irgendwer im Raum).
  const order = record.joinOrder || [];
  const next = order.map(id => humans.get(id)).find(Boolean) || humans.first();
  record.joinOrder = order.filter(id => id !== next.id);
  await transferRoom(guild, roomId, record, next);
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
      // Wer einen Raum verlässt, fällt aus der Nachfolger-Reihenfolge.
      if (leftId && rooms[leftId]) {
        rooms[leftId].joinOrder = (rooms[leftId].joinOrder || []).filter(id => id !== member.id);
      }

      if (leftRoomId) {
        await evaluateRoom(guild, leftRoomId, rooms);
      }

      // Neu im Raum (nicht der Owner) → hinten in der Nachfolger-Reihenfolge anstellen.
      const joinedRoom = oldState.channelId !== newState.channelId ? rooms[newState.channelId] : null;
      if (joinedRoom && joinedRoom.ownerId !== member.id) {
        joinedRoom.joinOrder = [...(joinedRoom.joinOrder || []).filter(id => id !== member.id), member.id];
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
