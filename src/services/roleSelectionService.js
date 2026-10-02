import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} from 'discord.js';

export const ROLE_SELECTION_CHANNEL_NAMES = new Set(['🎭┃rollen-auswahl', 'rollen-auswahl', 'rollen']);

// Reihenfolge = Reihenfolge der Buttons. Aliase: bestehende Rollen werden wiederverwendet statt doppelt angelegt.
export const GAMES = {
  lol: { name: 'League of Legends', emoji: '⚔️', aliases: ['LoL', 'League'] },
  hunt: { name: 'Hunt: Showdown', emoji: '🤠', aliases: ['Hunt', 'Hunt Showdown'] },
  overwatch: { name: 'Overwatch 2', emoji: '🛡️', aliases: ['Overwatch'] },
  dbd: { name: 'Dead by Daylight', emoji: '🔪', aliases: ['DbD', 'Dead By Daylight'] },
  minecraft: { name: 'Minecraft', emoji: '⛏️', aliases: [] },
  pubg: { name: 'PUBG', emoji: '🪂', aliases: ['PUBG: Battlegrounds', 'PlayerUnknown\'s Battlegrounds'] },
  valorant: { name: 'Valorant', emoji: '🎯', aliases: ['VALORANT'] },
  cs2: { name: 'Counter-Strike 2', emoji: '💣', aliases: ['CS2', 'CSGO', 'CS:GO', 'Counter-Strike'] },
  apex: { name: 'Apex Legends', emoji: '🔺', aliases: ['Apex'] }
};

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
      // Erwähnbar, damit man z. B. mit @Valorant Mitspieler suchen kann.
      mentionable: true,
      reason: 'NaafyrBot Rollen-Auswahl'
    });
    created.push(game.name);
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
      'Klick unten auf deine Games und schnapp dir die passende Rolle. So findest du in Sekunden Mitspieler – und die anderen finden dich. 🤝',
      '',
      list,
      '',
      '✨ **So geht’s**',
      '✅ Ein Klick → Rolle bekommen',
      '🔁 Nochmal klicken → Rolle wieder weg',
      '🎲 Wähl so viele Games, wie du willst',
      '',
      '📣 Tipp: Mit **@Spielname** pingst du alle, die das Game auch zocken – perfekt, wenn du eine Runde suchst!'
    ].join('\n'))
    .setFooter({ text: 'Fehlt dein Game? Sag einfach Bescheid! 💬' });
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
