import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';

export const ROLE_SELECTION_CHANNEL_NAMES = new Set(['🎭┃rollen-auswahl', 'rollen-auswahl', 'rollen']);
export const GAMES_CATEGORY_NAME = '──── 🎮 GAMES 🎮 ────';
export const PATCHNOTES_CATEGORY_NAME = '──── 📰 PATCH-NOTES 📰 ────';

// Reihenfolge = Reihenfolge der Buttons und Channels.
// aliases: bestehende Rollen werden wiederverwendet statt doppelt angelegt.
export const GAMES = {
  lol: {
    name: 'League of Legends', emoji: '⚔️', color: 0xC89B3C, aliases: ['LoL', 'League'],
    chat: '⚔️┃league-of-legends', patch: '⚔️┃lol-patchnotes',
    source: { type: 'riot', page: 'https://www.leagueoflegends.com/de-de/news/tags/patch-notes/', urlMatch: /league-of-legends-patch-[\d-]+-notes/, label: 'Riot Games' }
  },
  hunt: {
    name: 'Hunt: Showdown', emoji: '🤠', color: 0x8B1A1A, aliases: ['Hunt', 'Hunt Showdown'],
    chat: '🤠┃hunt-showdown', patch: '🤠┃hunt-patchnotes',
    source: { type: 'steam', appId: 594650, label: 'Steam' }
  },
  overwatch: {
    name: 'Overwatch 2', emoji: '🛡️', color: 0xF99E1A, aliases: ['Overwatch'],
    chat: '🛡️┃overwatch', patch: '🛡️┃overwatch-patchnotes',
    source: { type: 'steam', appId: 2357570, label: 'Steam' }
  },
  dbd: {
    name: 'Dead by Daylight', emoji: '🔪', color: 0x7A0A0A, aliases: ['DbD', 'Dead By Daylight'],
    chat: '🔪┃dead-by-daylight', patch: '🔪┃dbd-patchnotes',
    source: { type: 'steam', appId: 381210, label: 'Steam' }
  },
  minecraft: {
    name: 'Minecraft', emoji: '⛏️', color: 0x62B47A, aliases: [],
    chat: '⛏️┃minecraft', patch: '⛏️┃minecraft-patchnotes',
    source: { type: 'mojang', label: 'Mojang' }
  },
  pubg: {
    name: 'PUBG', emoji: '🪂', color: 0xF2A900, aliases: ['PUBG: Battlegrounds', 'PlayerUnknown\'s Battlegrounds'],
    chat: '🪂┃pubg', patch: '🪂┃pubg-patchnotes',
    // PUBG postet sehr viele E-Sport-News → nur echte "Patch Notes".
    source: { type: 'steam', appId: 578080, titleMatch: /patch notes/i, label: 'Steam' }
  },
  valorant: {
    name: 'Valorant', emoji: '🎯', color: 0xFF4655, aliases: ['VALORANT'],
    chat: '🎯┃valorant', patch: '🎯┃valorant-patchnotes',
    source: { type: 'riot', page: 'https://playvalorant.com/de-de/news/tags/patch-notes/', urlMatch: /valorant-patch-notes-[\d-]+/, label: 'Riot Games' }
  },
  cs2: {
    name: 'CS2', emoji: '💣', color: 0xDE9B35, aliases: ['Counter-Strike 2', 'CSGO', 'CS:GO', 'Counter-Strike'],
    chat: '💣┃cs2', patch: '💣┃cs2-patchnotes',
    source: { type: 'steam', appId: 730, label: 'Steam' }
  },
  apex: {
    name: 'Apex Legends', emoji: '🔺', color: 0xDA292A, aliases: ['Apex'],
    chat: '🔺┃apex-legends', patch: '🔺┃apex-patchnotes',
    source: { type: 'steam', appId: 1172470, label: 'Steam' }
  }
};

// Umgedrehte Benachrichtigung: Live/Videos/Shorts pingen @everyone.
// Wer eine dieser Rollen hat, sieht die Channels nicht und wird deshalb nicht gepingt.
export const NOTIFY_OPTIONS = {
  nolive: {
    name: 'Keine Live-Pings', emoji: '🔴', label: 'Stream-Start', aliases: [],
    channels: new Set(['🔴┃live']),
    offText: '🔕 **Stream-Start-Pings sind aus.** 🔴┃live ist für dich ausgeblendet.',
    onText: '🔔 **Stream-Start-Pings sind wieder an.** 🔴┃live siehst du wieder.'
  },
  novideo: {
    name: 'Keine Video-Pings', emoji: '📺', label: 'Neues Video', aliases: [],
    channels: new Set(['📺┃neue-videos', '📱┃neue-shorts']),
    offText: '🔕 **Video-Pings sind aus.** 📺┃neue-videos und 📱┃neue-shorts sind für dich ausgeblendet.',
    onText: '🔔 **Video-Pings sind wieder an.** Neue Videos und Shorts siehst du wieder.'
  }
};
const LEGACY_NO_PING_ROLE = 'Keine Stream-Pings';

async function ensureNotifyRole(guild, option) {
  let role = findGameRole(guild, option);
  if (!role) {
    role = await guild.roles.create({
      name: option.name,
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: 'NaafyrBot: Benachrichtigungen abwählen'
    });
  }

  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildText && option.channels.has(channel.name)) {
      await channel.permissionOverwrites.edit(role.id, { ViewChannel: false }, { reason: option.name });
    }
  }

  return role;
}

// Legt beide Rollen an. Die alte Sammelrolle "Keine Stream-Pings" wird in beide neuen umgewandelt.
export async function ensureNotifyRoles(guild) {
  const roles = {};
  for (const [key, option] of Object.entries(NOTIFY_OPTIONS)) {
    roles[key] = await ensureNotifyRole(guild, option);
  }

  const legacy = guild.roles.cache.find(role => role.name === LEGACY_NO_PING_ROLE && !role.managed);
  if (legacy) {
    await guild.members.fetch().catch(() => null);
    for (const member of legacy.members.values()) {
      await member.roles.add(Object.values(roles), 'Umstellung auf getrennte Benachrichtigungen').catch(() => {});
    }
    await legacy.delete('Ersetzt durch Keine Live-Pings / Keine Video-Pings').catch(() => {});
  }

  return Object.values(roles);
}

export function findRoleSelectionChannel(guild) {
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText && ROLE_SELECTION_CHANNEL_NAMES.has(channel.name)
  ) || null;
}

export function findGameRole(guild, game) {
  const names = new Set([game.name, ...game.aliases].map(name => name.toLowerCase()));
  return guild.roles.cache.find(role => names.has(role.name.toLowerCase()) && !role.managed) || null;
}

export async function ensureGameRoles(guild) {
  const created = [];
  for (const game of Object.values(GAMES)) {
    if (findGameRole(guild, game)) continue;
    await guild.roles.create({
      name: game.name,
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: 'NaafyrBot Rollen-Auswahl'
    });
    created.push(game.name);
  }
  return created;
}

async function getOrCreateCategory(guild, name) {
  const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === name);
  if (existing) return existing;

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }],
    reason: 'NaafyrBot Game-Channels'
  });
}

// Sichtbar nur mit der Game-Rolle. Patch-Notes-Channels sind schreibgeschützt.
function gameOverwrites(guild, role, { readOnly }) {
  return [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      ...(readOnly
        ? { deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.AddReactions] }
        : { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] })
    },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
    }
  ];
}

async function getOrCreateGameChannel(guild, name, parent, role, options) {
  const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === name);
  if (existing) {
    if (existing.parentId !== parent.id) {
      await existing.setParent(parent.id, { lockPermissions: false });
    }
    await existing.permissionOverwrites.set(gameOverwrites(guild, role, options));
    return { channel: existing, created: false };
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: options.readOnly ? 'Automatische Patch Notes' : undefined,
    permissionOverwrites: gameOverwrites(guild, role, options),
    reason: 'NaafyrBot Game-Channels'
  });
  return { channel, created: true };
}

export async function ensureGameChannels(guild) {
  const gamesCategory = await getOrCreateCategory(guild, GAMES_CATEGORY_NAME);
  const patchCategory = await getOrCreateCategory(guild, PATCHNOTES_CATEGORY_NAME);
  let created = 0;

  for (const game of Object.values(GAMES)) {
    const role = findGameRole(guild, game);
    if (!role) continue;

    const chat = await getOrCreateGameChannel(guild, game.chat, gamesCategory, role, { readOnly: false });
    const patch = await getOrCreateGameChannel(guild, game.patch, patchCategory, role, { readOnly: true });
    created += Number(chat.created) + Number(patch.created);
  }

  return created;
}

export function buildGamesEmbed() {
  const list = Object.values(GAMES).map(game => `${game.emoji} **${game.name}**`).join('\n');

  return new EmbedBuilder()
    .setColor(0xB84DFF)
    .setTitle('🎮 WAS ZOCKST DU?')
    .setDescription([
      'Zeig der Community, was bei dir gerade läuft! 🕹️',
      '',
      'Klick unten auf deine Games und schnapp dir die passende Rolle. Damit schaltest du den **Game-Chat** und die **Patch Notes** für dein Game frei. 📰',
      '',
      list,
      '',
      '✨ **So geht’s**',
      '✅ Ein Klick → Rolle bekommen',
      '🔁 Nochmal klicken → Rolle wieder weg',
      '🎲 Wähl so viele Games, wie du willst'
    ].join('\n'));
}

export function buildNotifyEmbed() {
  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('🎬 CONTENT')
    .setDescription([
      'Standardmäßig wirst du bei jedem Stream und jedem neuen Video benachrichtigt. 🔔',
      '',
      'Klick auf einen Button, wenn du dafür **nicht mehr** benachrichtigt werden willst:',
      '',
      '🔴 **Stream-Start** – keine Pings mehr, wenn Naafyr live geht',
      '📺 **Neues Video** – keine Pings mehr bei neuen Videos & Shorts',
      '',
      '🔁 Nochmal klicken → Benachrichtigung wieder an'
    ].join('\n'));
}

export function buildNotifyButtons() {
  return [new ActionRowBuilder().addComponents(
    Object.entries(NOTIFY_OPTIONS).map(([key, option]) =>
      new ButtonBuilder()
        .setCustomId(`rolle:${key}`)
        .setLabel(option.label)
        .setEmoji(option.emoji)
        .setStyle(ButtonStyle.Secondary)
    )
  )];
}

export function buildGamesButtons() {
  const buttons = Object.entries(GAMES).map(([key, game]) =>
    new ButtonBuilder()
      .setCustomId(`rolle:${key}`)
      .setLabel(game.name)
      .setEmoji(game.emoji)
      .setStyle(ButtonStyle.Secondary)
  );

  // Discord erlaubt max. 5 Buttons pro Reihe.
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  }
  return rows;
}
