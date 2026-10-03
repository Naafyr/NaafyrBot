import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { CATEGORIES as LEADERBOARD_CATEGORIES } from './leaderboardService.js';
import { GAMES, NOTIFY_OPTIONS } from './roleSelectionService.js';
import { logger } from '../utils/logger.js';

// Tavernen-Ränge, von unten nach oben. Rein optisch: keine Berechtigungen, rechts in der Mitgliederliste.
// days = Tage auf dem Server, dazu messages ODER voiceHours (All-Time-Werte der Rangliste).
export const RANKS = [
  { name: '🍺 Gast', color: 0xD7C4A3, days: 0, messages: 0, voiceHours: 0 },
  { name: '🍻 Stammgast', color: 0xE6A85C, days: 7, messages: 100, voiceHours: 5 },
  { name: '🥴 Kneipenhocker', color: 0xE07B39, days: 30, messages: 400, voiceHours: 20 },
  { name: '🪑 Thekenlegende', color: 0xC0533A, days: 90, messages: 1200, voiceHours: 60 },
  { name: "🍾 Hat 'nen eigenen Krug", color: 0xF1C40F, days: 180, messages: 3000, voiceHours: 150 }
];
export const VIP_ROLE = { name: '💎 Ehrengast', color: 0x9B59B6 };

// Rollen-Trenner (Emoji vorne und hinten).
export const SEPARATORS = {
  team: '━━━ 👑 TEAM 👑 ━━━',
  rank: '━━━ 🍺 RANG 🍺 ━━━',
  top: '━━━ 🏆 RANGLISTE 🏆 ━━━',
  games: '━━━ 🎮 GAMES 🎮 ━━━',
  pings: '━━━ 🔕 PINGS 🔕 ━━━'
};

export const VIP_CATEGORY_NAME = '──── 💎 VIP 💎 ────';
const VIP_CHANNELS = { chat: '💬┃vip-chat', lounge: '🔊┃VIP-Lounge', waiting: '⏳┃vip-warteraum' };

const isSeparatorName = name => name.startsWith('━━━');
const findRole = (guild, name) => guild.roles.cache.find(role => role.name === name && !role.managed) || null;
const findVerifiedRole = guild => guild.roles.cache.find(role => role.name.toLowerCase() === 'verifiziert' && !role.managed) || null;

// Namen der Rollen, die der Bot automatisch vergibt (für den Mod-Log-Filter).
export const AUTO_ROLE_NAMES = [...RANKS.map(rank => rank.name), ...Object.values(SEPARATORS)];

function groupRoles(guild) {
  const me = guild.members.me;
  const names = list => new Set(list.map(name => name.toLowerCase()));
  const byNames = set => [...guild.roles.cache.values()].filter(role => !role.managed && set.has(role.name.toLowerCase()));
  const sortDesc = roles => roles.sort((a, b) => b.position - a.position);

  return {
    team: sortDesc([...guild.roles.cache.values()].filter(role =>
      !role.managed && role.id !== guild.id && !isSeparatorName(role.name)
      && role.permissions.has(PermissionFlagsBits.Administrator) && role.id !== me?.roles.highest.id)),
    // Ehrengast oben, dann höchster Rang zuerst
    rank: [findRole(guild, VIP_ROLE.name), ...[...RANKS].reverse().map(rank => findRole(guild, rank.name))].filter(Boolean),
    top: sortDesc(byNames(names(Object.values(LEADERBOARD_CATEGORIES).flatMap(category => category.roles)))),
    games: byNames(names(Object.values(GAMES).flatMap(game => [game.name, ...game.aliases]))),
    pings: byNames(names(Object.values(NOTIFY_OPTIONS).map(option => option.name)))
  };
}

async function ensureRole(guild, name, options) {
  const existing = findRole(guild, name);
  if (existing) return { role: existing, created: false };
  const role = await guild.roles.create({ name, permissions: [], mentionable: false, reason: 'NaafyrBot Ränge', ...options });
  return { role, created: true };
}

// Legt Ränge, Ehrengast und Trenner an und sortiert alles unter der Bot-Rolle.
// Gibt { created, teamSkipped } zurück.
export async function setupRoles(guild) {
  const created = [];
  for (const rank of RANKS) {
    if ((await ensureRole(guild, rank.name, { color: rank.color, hoist: true })).created) created.push(rank.name);
  }
  if ((await ensureRole(guild, VIP_ROLE.name, { color: VIP_ROLE.color, hoist: true })).created) created.push(VIP_ROLE.name);
  for (const name of Object.values(SEPARATORS)) {
    if ((await ensureRole(guild, name, { hoist: false })).created) created.push(name);
  }

  // Team-Rollen über der Bot-Rolle kann der Bot nicht verschieben → Team-Trenner dann weglassen.
  const botTop = guild.members.me.roles.highest.position;
  const groups = groupRoles(guild);
  const teamSkipped = groups.team.some(role => role.position >= botTop);

  const layout = [];
  for (const [key, roles] of Object.entries(groups)) {
    if (key === 'team' && teamSkipped) continue;
    if (roles.length === 0) continue;
    layout.push(findRole(guild, SEPARATORS[key]), ...roles);
  }

  // Von oben nach unten direkt unter die Bot-Rolle legen.
  const positions = layout.filter(Boolean).map((role, index) => ({ role: role.id, position: botTop - 1 - index }))
    .filter(entry => entry.position > 0);
  await guild.roles.setPositions(positions).catch(error =>
    logger.warn('[Ränge] Rollen konnten nicht sortiert werden', { guildId: guild.id, error: error.message }));

  return { created, teamSkipped };
}

export function rankFor({ days, messages, voiceMinutes }) {
  return [...RANKS].reverse().find(rank =>
    days >= rank.days && (rank.messages === 0 || messages >= rank.messages || voiceMinutes >= rank.voiceHours * 60)) || RANKS[0];
}

// Alle 10 Min.: richtigen Rang vergeben (nur Verifizierte) und passende Trenner setzen.
export async function syncRanks(client, guild) {
  const rankRoles = RANKS.map(rank => findRole(guild, rank.name));
  if (rankRoles.some(role => !role)) return; // /rollen setup noch nicht gelaufen

  const verified = findVerifiedRole(guild);
  const botTop = guild.members.me.roles.highest.position;
  const [chat, voice] = await Promise.all(['chat', 'voice'].map(category =>
    client.db.get(`guild:${guild.id}:rangliste:${category}:all:all`).then(stats => stats || {}).catch(() => ({}))));

  await guild.members.fetch().catch(() => null);
  const groups = groupRoles(guild);
  const separators = Object.fromEntries(Object.keys(SEPARATORS).map(key => [key, findRole(guild, SEPARATORS[key])]));

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const add = [];
    const remove = [];
    const want = (role, yes) => {
      if (!role || role.position >= botTop) return;
      if (yes && !member.roles.cache.has(role.id)) add.push(role);
      if (!yes && member.roles.cache.has(role.id)) remove.push(role);
    };

    const isVerified = verified ? member.roles.cache.has(verified.id) : true;
    const target = isVerified ? rankFor({
      days: (Date.now() - (member.joinedTimestamp || Date.now())) / 86_400_000,
      messages: chat[member.id] || 0,
      voiceMinutes: voice[member.id] || 0
    }) : null;
    RANKS.forEach((rank, index) => want(rankRoles[index], rank === target));

    for (const [key, roles] of Object.entries(groups)) {
      if (key === 'team' && roles.some(role => role.position >= botTop)) continue;
      const hasGroupRole = roles.some(role => member.roles.cache.has(role.id))
        || (key === 'rank' && Boolean(target));
      want(separators[key], hasGroupRole);
    }

    if (add.length) await member.roles.add(add, 'Ränge').catch(() => {});
    if (remove.length) await member.roles.remove(remove, 'Ränge').catch(() => {});
  }
}

export async function syncAllRanks(client) {
  if (!client?.isReady?.() || !client.db) return;
  for (const guild of client.guilds.cache.values()) {
    await syncRanks(client, guild).catch(error =>
      logger.error('[Ränge] Sync fehlgeschlagen', { guildId: guild.id, error: error.message }));
  }
}

// VIP-Kategorie unter VOICE: Chat nur für Ehrengäste, Lounge sehen alle (nur VIP kann rein), Warteraum für alle.
export async function setupVipArea(guild) {
  const vip = findRole(guild, VIP_ROLE.name);
  const audience = findVerifiedRole(guild) || guild.roles.everyone;
  const me = guild.members.me.id;
  const F = PermissionFlagsBits;
  const base = [{ id: guild.id, deny: [F.ViewChannel] }, { id: me, allow: [F.ViewChannel, F.Connect, F.ManageChannels, F.MoveMembers, F.SendMessages] }];

  let category = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === VIP_CATEGORY_NAME);
  const created = [];
  if (!category) {
    category = await guild.channels.create({ name: VIP_CATEGORY_NAME, type: ChannelType.GuildCategory, permissionOverwrites: base });
    created.push(VIP_CATEGORY_NAME);
  }

  const specs = [
    { name: VIP_CHANNELS.chat, type: ChannelType.GuildText, overwrites: [{ id: vip.id, allow: [F.ViewChannel, F.SendMessages, F.ReadMessageHistory] }] },
    { name: VIP_CHANNELS.lounge, type: ChannelType.GuildVoice, overwrites: [
      { id: audience.id, allow: [F.ViewChannel], deny: [F.Connect] },
      { id: vip.id, allow: [F.ViewChannel, F.Connect, F.Speak, F.MoveMembers] }] },
    { name: VIP_CHANNELS.waiting, type: ChannelType.GuildVoice, overwrites: [
      { id: audience.id, allow: [F.ViewChannel, F.Connect, F.Speak] },
      { id: vip.id, allow: [F.ViewChannel, F.Connect, F.Speak, F.MoveMembers] }] }
  ];

  for (const spec of specs) {
    if (guild.channels.cache.some(channel => channel.parentId === category.id && channel.name === spec.name)) continue;
    await guild.channels.create({
      name: spec.name, type: spec.type, parent: category.id,
      permissionOverwrites: [...base, ...spec.overwrites], reason: 'NaafyrBot VIP-Bereich'
    });
    created.push(spec.name);
  }
  return created;
}
