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
// Wer neu da und noch nicht verifiziert ist.
export const TRAVELER_ROLE = { name: '🧭 Reisender', color: 0x95A5A6 };
// Am Geburtstag 24 Std. ganz oben in der Mitgliederliste.
export const BIRTHDAY_ROLE = { name: '🎂 Geburtstagskind', color: 0xFF73FA };

// Rollen-Trenner (Emoji vorne und hinten). Unsichtbare Zeichen (U+2800) hinten sorgen dafür,
// dass der Trenner im Profil eine ganze Zeile füllt (Discord kürzt mit "...").
const SEPARATOR_LABELS = {
  team: '👑 TEAM 👑',
  server: '🏠 SERVER 🏠',
  rank: '🍺 RANG 🍺',
  top: '🏆 RANGLISTE 🏆',
  games: '🎮 GAMES 🎮',
  pings: '🔕 PINGS 🔕'
};
export const SEPARATORS = Object.fromEntries(Object.entries(SEPARATOR_LABELS)
  .map(([key, label]) => [key, `▬▬▬ ${label} ▬▬▬${'\u2800'.repeat(40)}`]));

// Findet einen Trenner auch unter altem Namen (z. B. kurzer Balken).
function findSeparator(guild, key) {
  return guild.roles.cache.find(role => !role.managed && /^(━━━|───|▬▬▬) /.test(role.name) && role.name.includes(` ${SEPARATOR_LABELS[key]} `)) || null;
}

export const VIP_CATEGORY_NAME = '▬▬▬ 💎 VIP 💎 ▬▬▬';
const VIP_CHANNELS = { chat: '💬┃vip-chat', lounge: '🔊┃VIP-Lounge', waiting: '⏳┃vip-warteraum' };

const isSeparatorName = name => /^(━━━|───|▬▬▬) /.test(name);
const findRole = (guild, name) => guild.roles.cache.find(role => role.name === name && !role.managed) || null;
const findVerifiedRole = guild => guild.roles.cache.find(role => role.name.toLowerCase() === 'verifiziert' && !role.managed) || null;

// Namen der Rollen, die der Bot automatisch vergibt (für den Mod-Log-Filter).
export const AUTO_ROLE_NAMES = [BIRTHDAY_ROLE.name, TRAVELER_ROLE.name, ...RANKS.map(rank => rank.name), ...Object.values(SEPARATORS)];

function groupRoles(guild) {
  const me = guild.members.me;
  const names = list => new Set(list.map(name => name.toLowerCase()));
  const byNames = set => [...guild.roles.cache.values()].filter(role => !role.managed && set.has(role.name.toLowerCase()));
  const sortDesc = roles => roles.sort((a, b) => b.position - a.position);

  return {
    team: sortDesc([...guild.roles.cache.values()].filter(role =>
      !role.managed && role.id !== guild.id && !isSeparatorName(role.name)
      && role.permissions.has(PermissionFlagsBits.Administrator) && role.id !== me?.roles.highest.id)),
    server: [findVerifiedRole(guild)].filter(Boolean),
    // Ehrengast oben, dann höchster Rang zuerst
    rank: [findRole(guild, BIRTHDAY_ROLE.name), findRole(guild, VIP_ROLE.name), ...[...RANKS].reverse().map(rank => findRole(guild, rank.name)), findRole(guild, TRAVELER_ROLE.name)].filter(Boolean),
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
  if ((await ensureRole(guild, BIRTHDAY_ROLE.name, { color: BIRTHDAY_ROLE.color, hoist: true })).created) created.push(BIRTHDAY_ROLE.name);
  if ((await ensureRole(guild, TRAVELER_ROLE.name, { color: TRAVELER_ROLE.color, hoist: true })).created) created.push(TRAVELER_ROLE.name);
  for (const [key, name] of Object.entries(SEPARATORS)) {
    const existing = findSeparator(guild, key);
    if (existing) {
      if (existing.name !== name) await existing.setName(name, 'Trenner verlängert').catch(() => {});
      continue;
    }
    await guild.roles.create({ name, permissions: [], mentionable: false, hoist: false, reason: 'NaafyrBot Rollen-Trenner' });
    created.push(SEPARATOR_LABELS[key]);
  }

  const { teamSkipped, sortError, blocked } = await sortRoles(guild);
  return { created, teamSkipped, sortError, blocked };
}

// Bringt ALLE Rollen unter der Bot-Rolle in die Wunsch-Reihenfolge:
// je Gruppe erst der Trenner, dann ihre Rollen; alle übrigen Rollen darunter (alte Reihenfolge bleibt).
export async function sortRoles(guild) {
  const botTop = guild.members.me.roles.highest.position;
  const groups = groupRoles(guild);
  // Team-Rollen über der Bot-Rolle kann der Bot nicht verschieben → Team-Trenner dann weglassen.
  const teamSkipped = groups.team.some(role => role.position >= botTop);

  const layout = [];
  for (const [key, roles] of Object.entries(groups)) {
    if (key === 'team' && teamSkipped) continue;
    const separator = findSeparator(guild, key);
    if (roles.length === 0 || !separator) continue;
    layout.push(separator, ...roles);
  }

  const movable = role => role.id !== guild.id && role.position < botTop;
  const inLayout = new Set(layout.map(role => role.id));
  const rest = [...guild.roles.cache.values()]
    .filter(role => movable(role) && !inLayout.has(role.id))
    .sort((a, b) => b.position - a.position);
  const desired = [...layout.filter(movable), ...rest];

  const current = [...guild.roles.cache.values()].filter(movable).sort((a, b) => b.position - a.position);
  // Rollen über der Bot-Rolle kann der Bot nie verschieben → melden, damit man die Bot-Rolle hochzieht.
  const blocked = Object.entries(groups).filter(([key]) => key !== 'team').flatMap(([, roles]) => roles)
    .concat(Object.keys(SEPARATORS).map(key => findSeparator(guild, key)).filter(Boolean))
    .filter(role => role.position >= botTop).map(role => role.name);
  if (desired.every((role, index) => current[index]?.id === role.id)) return { teamSkipped, changed: false, blocked };

  // Positionen 1..n von unten, oberste direkt unter der Bot-Rolle.
  const positions = desired.map((role, index) => ({ role: role.id, position: desired.length - index }));
  let sortError = null;
  await guild.roles.setPositions(positions).catch(async error => {
    logger.warn('[Ränge] Sammel-Sortierung fehlgeschlagen, versuche einzeln', { guildId: guild.id, error: error.message });
    // Einzeln: von unten nach oben jede Rolle direkt unter die Bot-Rolle legen → am Ende stimmt die Reihenfolge.
    const failed = [];
    for (const role of [...desired].reverse()) {
      const target = guild.members.me.roles.highest.position - 1;
      if (role.position === target) continue;
      await role.setPosition(target).catch(err => failed.push(`${role.name} (${err.message})`));
    }
    if (failed.length) sortError = `Diese Rollen ließen sich nicht verschieben: ${failed.join(', ')}`;
  });
  return { teamSkipped, changed: true, sortError, blocked };
}

export function rankFor({ days, messages, voiceMinutes }) {
  return [...RANKS].reverse().find(rank =>
    days >= rank.days && (rank.messages === 0 || messages >= rank.messages || voiceMinutes >= rank.voiceHours * 60)) || RANKS[0];
}

// Alle 10 Min.: richtigen Rang vergeben (nur Verifizierte) und passende Trenner setzen.
export async function syncRanks(client, guild) {
  const rankRoles = RANKS.map(rank => findRole(guild, rank.name));
  if (rankRoles.some(role => !role)) return; // /setup rollen noch nicht gelaufen
  await sortRoles(guild).catch(() => {}); // z. B. neue Game-Rollen unter ihren Trenner schieben

  const verified = findVerifiedRole(guild);
  const travelerRole = findRole(guild, TRAVELER_ROLE.name);
  const botTop = guild.members.me.roles.highest.position;
  const [chat, voice] = await Promise.all(['chat', 'voice'].map(category =>
    client.db.get(`guild:${guild.id}:rangliste:${category}:all:all`).then(stats => stats || {}).catch(() => ({}))));

  await guild.members.fetch().catch(() => null);
  const groups = groupRoles(guild);
  const separators = Object.fromEntries(Object.keys(SEPARATORS).map(key => [key, findSeparator(guild, key)]));

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
    want(travelerRole, !isVerified);
    for (const [key, roles] of Object.entries(groups)) {
      if (key === 'team' && roles.some(role => role.position >= botTop)) continue;
      const hasGroupRole = roles.some(role => member.roles.cache.has(role.id))
        || (key === 'rank' && (Boolean(target) || !isVerified));
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

// Direkt beim Beitritt: 🧭 Reisender (der 10-Min.-Abgleich macht nach dem Verifizieren 🍺 Gast daraus).
export async function assignTraveler(member) {
  if (member.user.bot) return;
  const role = findRole(member.guild, TRAVELER_ROLE.name);
  if (role) await member.roles.add(role, 'Neu auf dem Server').catch(() => {});
}

// Nach dem Verifizieren sofort: 🧭 Reisender → 🍺 Gast (höhere Ränge vergibt der 10-Min.-Abgleich).
export async function promoteTravelerToGuest(member) {
  const traveler = findRole(member.guild, TRAVELER_ROLE.name);
  const guest = findRole(member.guild, RANKS[0].name);
  if (traveler && member.roles.cache.has(traveler.id)) await member.roles.remove(traveler, 'Verifiziert').catch(() => {});
  if (guest && !RANKS.some(rank => member.roles.cache.some(role => role.name === rank.name))) await member.roles.add(guest, 'Verifiziert').catch(() => {});
}
