import { ChannelType, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { Mutex } from '../utils/mutex.js';

const TIME_ZONE = 'Europe/Vienna';
const TOP_LIMIT = 5;
const CHAT_COOLDOWN_MS = 10_000;

export const LEADERBOARD_CHANNEL_NAMES = new Set(['🏆┃leaderboard', 'leaderboard']);
const PHOTO_CHANNEL_NAMES = new Set([
  '🍕┃essen-bilder', '🐾┃tier-bilder', '📸┃allgemein-bilder',
  'essen-bilder', 'tier-bilder', 'allgemein-bilder'
]);
const AFK_CHANNEL_NAMES = new Set(['😴┃afk', 'afk']);

export const CATEGORIES = {
  chat: {
    title: '💬 CHAT – Nachrichten',
    color: 0x5865F2,
    short: value => `${value}`,
    roles: ['Schreibkünstler', 'Aktiver Chatter', 'Tastaturkrieger']
  },
  voice: {
    title: '🎙️ VOICE – Zeit im Voice',
    color: 0x57F287,
    short: formatMinutesShort,
    roles: ['Sprechmeister', 'Voice-Veteran', 'Dauerredner']
  },
  photo: {
    title: '📸 FOTOS – Bilder',
    color: 0xEB459E,
    short: value => `${value}`,
    roles: ['Meisterfotograf', 'Fotograf', 'Schnappschütze']
  }
};

export const PERIODS = {
  week: { label: 'Woche', emoji: '📅' },
  month: { label: 'Monat', emoji: '🗓️' },
  all: { label: 'All-Time', emoji: '♾️' }
};

// Die Top-3-Rollen richten sich nach dem laufenden Monat.
const ROLE_PERIOD = 'month';
export const RANK_COLORS = [0xF1C40F, 0xBDC3C7, 0xCD7F32];
const MEDALS = ['🥇', '🥈', '🥉'];
const COLUMN_RULE = '━━━━━━━━━━';

// ---------- Zeiträume ----------

function viennaDate(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map(part => [part.type, part.value])
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function isoWeek({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const week = Math.ceil(((date - Date.UTC(weekYear, 0, 1)) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function periodId(period, date = new Date()) {
  const local = viennaDate(date);
  if (period === 'week') return isoWeek(local);
  if (period === 'month') return `${local.year}-${String(local.month).padStart(2, '0')}`;
  return 'all';
}

function statsKey(guildId, category, period, date = new Date()) {
  return `guild:${guildId}:rangliste:${category}:${period}:${periodId(period, date)}`;
}

function messageKey(guildId) {
  return `guild:${guildId}:rangliste:message`;
}

function formatMinutesShort(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

// ---------- Zählen (im Speicher, Flush einmal pro Minute) ----------

const pending = new Map();
const chatCooldowns = new Map();

function addPending(guildId, category, userId, amount = 1) {
  if (!pending.has(guildId)) {
    pending.set(guildId, { chat: new Map(), voice: new Map(), photo: new Map() });
  }
  const bucket = pending.get(guildId)[category];
  bucket.set(userId, (bucket.get(userId) || 0) + amount);
}

// Zählt nur, wenn nach Entfernen von Emojis, Links (GIFs), Erwähnungen noch echter Text übrig ist.
export function isMeaningfulText(content) {
  const stripped = String(content || '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/<(@[!&]?|#)\d+>/g, '')
    .replace(/https?:\/\/\S+/gi, '');
  return /[\p{L}\p{N}]/u.test(stripped);
}

function isPhotoPost(message) {
  return message.attachments.some(attachment =>
    attachment.contentType?.startsWith('image/') && attachment.contentType !== 'image/gif'
  );
}

export function trackMessage(message) {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  if (PHOTO_CHANNEL_NAMES.has(message.channel.name) && isPhotoPost(message)) {
    addPending(guildId, 'photo', userId);
  }

  if (isMeaningfulText(message.content)) {
    const cooldownKey = `${guildId}:${userId}`;
    const now = Date.now();
    if (now - (chatCooldowns.get(cooldownKey) || 0) >= CHAT_COOLDOWN_MS) {
      chatCooldowns.set(cooldownKey, now);
      addPending(guildId, 'chat', userId);
    }
  }
}

function isAfkChannel(guild, channel) {
  return channel.id === guild.afkChannelId || AFK_CHANNEL_NAMES.has(channel.name);
}

// Jede Minute: Menschen in Voice-Channels mit mind. 2 Menschen, nicht taub, nicht AFK.
export function trackVoiceMinute(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
      if (isAfkChannel(guild, channel)) continue;

      const humans = channel.members.filter(member => !member.user.bot);
      if (humans.size < 2) continue;

      for (const member of humans.values()) {
        if (member.voice.selfDeaf || member.voice.serverDeaf) continue;
        addPending(guild.id, 'voice', member.id);
      }
    }
  }

  // Abgelaufene Cooldowns entfernen, damit die Map nicht wächst.
  const now = Date.now();
  for (const [key, time] of chatCooldowns) {
    if (now - time >= CHAT_COOLDOWN_MS) chatCooldowns.delete(key);
  }
}

export async function flushLeaderboard(client) {
  if (!client.db || pending.size === 0) return;

  const snapshot = new Map(pending);
  pending.clear();
  const now = new Date();

  for (const [guildId, categories] of snapshot) {
    await Mutex.runExclusive(`rangliste:${guildId}`, async () => {
      for (const [category, counts] of Object.entries(categories)) {
        if (counts.size === 0) continue;

        for (const period of Object.keys(PERIODS)) {
          const key = statsKey(guildId, category, period, now);
          try {
            const stats = (await client.db.get(key)) || {};
            for (const [userId, amount] of counts) {
              stats[userId] = (stats[userId] || 0) + amount;
            }
            await client.db.set(key, stats);
          } catch (error) {
            logger.error('[Rangliste] Flush failed', { guildId, key, error: error.message });
          }
        }
      }
    });
  }
}

// ---------- Anzeige ----------

async function topEntries(client, guildId, category, period) {
  const stats = (await client.db?.get?.(statsKey(guildId, category, period))) || {};
  return Object.entries(stats)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIMIT);
}

// Eine eigene Nachricht pro Kategorie, Woche / Monat / All-Time als Spalten nebeneinander.
export async function buildCategoryEmbed(client, guild, category) {
  const config = CATEGORIES[category];
  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(config.title)
    .setFooter({ text: 'Aktualisiert alle 10 Minuten • Top 3 des Monats erhalten Rollen' })
    .setTimestamp();

  const columns = [];
  for (const period of Object.keys(PERIODS)) {
    const entries = await topEntries(client, guild.id, category, period);
    const lines = entries.map(([userId, value], index) =>
      `${MEDALS[index] || `\`${index + 1}.\``} <@${userId}> · ${config.short(value)}`
    );
    columns.push({ period, lines: lines.length > 0 ? lines : ['*Noch leer*'] });
  }

  // Discord kennt keine Tabellenlinien → mit Rahmenzeichen nachbilden.
  // Alle Spalten gleich lang auffüllen, damit die senkrechte Linie durchgeht.
  const rows = Math.max(...columns.map(column => column.lines.length));

  for (const [index, { period, lines }] of columns.entries()) {
    const first = index === 0;
    const padded = [...lines, ...Array(rows - lines.length).fill('​')];
    const body = padded.map(line => (first ? line : `┃ ${line}`));

    embed.addFields({
      name: `${first ? '' : '┃ '}${PERIODS[period].emoji} ${PERIODS[period].label}`,
      value: [first ? COLUMN_RULE : `╋${COLUMN_RULE}`, ...body].join('\n'),
      inline: true
    });
  }

  return embed;
}

export function findLeaderboardChannel(guild) {
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText && LEADERBOARD_CHANNEL_NAMES.has(channel.name)
  ) || null;
}

// Löscht alte Ranglisten-Nachrichten des Bots und postet Chat, Voice, Fotos neu (in dieser Reihenfolge).
export async function postLeaderboardMessages(client, guild, channel) {
  const titles = Object.values(CATEGORIES).map(config => config.title);
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    const old = recent.filter(message =>
      message.author.id === client.user.id &&
      message.embeds.some(embed => titles.includes(embed.title) || embed.title?.startsWith('🏆 RANGLISTE'))
    );
    for (const message of old.values()) {
      await message.delete().catch(() => {});
    }
  }

  const messageIds = {};
  for (const category of Object.keys(CATEGORIES)) {
    const message = await channel.send({ embeds: [await buildCategoryEmbed(client, guild, category)] });
    messageIds[category] = message.id;
  }

  await client.db.set(messageKey(guild.id), { channelId: channel.id, messageIds });
}

async function refreshMessages(client, guild, ref) {
  const channel = guild.channels.cache.get(ref.channelId);
  if (!channel) return;

  // Altes Format (eine Nachricht) oder fehlende Nachricht → alle drei neu posten, damit die Reihenfolge stimmt.
  const messages = {};
  for (const category of Object.keys(CATEGORIES)) {
    const id = ref.messageIds?.[category];
    messages[category] = id ? await channel.messages.fetch(id).catch(() => null) : null;
  }

  if (Object.values(messages).some(message => !message)) {
    await postLeaderboardMessages(client, guild, channel);
    return;
  }

  for (const [category, message] of Object.entries(messages)) {
    await message.edit({ embeds: [await buildCategoryEmbed(client, guild, category)], components: [] });
  }
}

// ---------- Rollen ----------

function findRole(guild, name) {
  return guild.roles.cache.find(role => role.name === name && !role.managed) || null;
}

export async function ensureLeaderboardRoles(guild) {
  const created = [];
  for (const config of Object.values(CATEGORIES)) {
    for (const [index, name] of config.roles.entries()) {
      if (findRole(guild, name)) continue;
      await guild.roles.create({
        name,
        color: RANK_COLORS[index],
        permissions: [],
        hoist: false,
        mentionable: false,
        reason: 'NaafyrBot Rangliste Top-3-Rolle'
      });
      created.push(name);
    }
  }
  return created;
}

async function syncRoles(client, guild) {
  const botMember = guild.members.me;
  if (!botMember) return;

  await guild.members.fetch().catch(() => null);

  for (const [category, config] of Object.entries(CATEGORIES)) {
    const top = await topEntries(client, guild.id, category, ROLE_PERIOD);

    for (const [index, name] of config.roles.entries()) {
      const role = findRole(guild, name);
      if (!role || role.position >= botMember.roles.highest.position) continue;

      const desiredId = top[index]?.[0] || null;

      for (const member of role.members.values()) {
        if (member.id !== desiredId) {
          await member.roles.remove(role, 'Rangliste: nicht mehr in den Top 3').catch(() => {});
        }
      }

      if (desiredId && !role.members.has(desiredId)) {
        const member = await guild.members.fetch(desiredId).catch(() => null);
        if (member) {
          await member.roles.add(role, 'Rangliste: Top 3 des Monats').catch(() => {});
        }
      }
    }
  }
}

export async function updateLeaderboards(client) {
  if (!client?.isReady?.() || !client.db) return;

  await flushLeaderboard(client);

  for (const guild of client.guilds.cache.values()) {
    try {
      // Nur Server, auf denen /setup rangliste ausgeführt wurde.
      const ref = await client.db.get(messageKey(guild.id));
      if (!ref?.channelId) continue;

      await refreshMessages(client, guild, ref);
      await syncRoles(client, guild);
    } catch (error) {
      logger.error('[Rangliste] Update failed', { guildId: guild.id, error: error.message });
    }
  }
}

export async function syncLeaderboardRoles(client, guild) {
  await syncRoles(client, guild);
}
