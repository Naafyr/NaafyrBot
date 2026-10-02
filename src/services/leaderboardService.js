import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { Mutex } from '../utils/mutex.js';

const TIME_ZONE = 'Europe/Vienna';
const TOP_LIMIT = 10;
const CHAT_COOLDOWN_MS = 10_000;

export const LEADERBOARD_CHANNEL_NAMES = new Set(['🏆┃leaderboard', 'leaderboard']);
const PHOTO_CHANNEL_NAMES = new Set([
  '🍕┃essen-bilder', '🐾┃tier-bilder', '📸┃allgemein-bilder',
  'essen-bilder', 'tier-bilder', 'allgemein-bilder'
]);
const AFK_CHANNEL_NAMES = new Set(['😴┃afk', 'afk']);

export const CATEGORIES = {
  chat: {
    title: '💬 Chat',
    format: value => `${value} ${value === 1 ? 'Nachricht' : 'Nachrichten'}`,
    roles: ['Schreibkünstler', 'Aktiver Chatter', 'Tastaturkrieger']
  },
  voice: {
    title: '🎙️ Voice',
    format: formatMinutes,
    roles: ['Sprechmeister', 'Voice-Veteran', 'Dauerredner']
  },
  photo: {
    title: '📸 Fotos',
    format: value => `${value} ${value === 1 ? 'Bild' : 'Bilder'}`,
    roles: ['Meisterfotograf', 'Fotograf', 'Schnappschütze']
  }
};

export const PERIODS = {
  week: { label: 'Diese Woche', button: 'Woche', emoji: '📅' },
  month: { label: 'Dieser Monat', button: 'Monat', emoji: '🗓️' },
  all: { label: 'All-Time', button: 'All-Time', emoji: '♾️' }
};

// Die Top-3-Rollen richten sich nach dem laufenden Monat.
const ROLE_PERIOD = 'month';
export const RANK_COLORS = [0xF1C40F, 0xBDC3C7, 0xCD7F32];
const MEDALS = ['🥇', '🥈', '🥉'];

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

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours} Std. ${rest} Min.`;
  if (hours > 0) return `${hours} Std.`;
  return `${rest} Min.`;
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

export async function buildLeaderboardEmbed(client, guild, period) {
  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle(`🏆 RANGLISTE – ${PERIODS[period].label}`)
    .setFooter({ text: 'Aktualisiert alle 10 Minuten • Top 3 des Monats erhalten Rollen' })
    .setTimestamp();

  for (const [category, config] of Object.entries(CATEGORIES)) {
    const entries = await topEntries(client, guild.id, category, period);
    const lines = entries.map(([userId, value], index) =>
      `${MEDALS[index] || `**${index + 1}.**`} <@${userId}> – ${config.format(value)}`
    );
    embed.addFields({ name: config.title, value: lines.join('\n') || '*Noch keine Einträge*' });
  }

  return embed;
}

export function buildPeriodButtons() {
  return new ActionRowBuilder().addComponents(
    Object.entries(PERIODS).map(([period, config]) =>
      new ButtonBuilder()
        .setCustomId(`rangliste:${period}`)
        .setLabel(config.button)
        .setEmoji(config.emoji)
        .setStyle(ButtonStyle.Secondary)
    )
  );
}

export function findLeaderboardChannel(guild) {
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText && LEADERBOARD_CHANNEL_NAMES.has(channel.name)
  ) || null;
}

export async function saveLeaderboardMessage(client, guildId, message) {
  await client.db.set(messageKey(guildId), { channelId: message.channelId, messageId: message.id });
}

async function refreshMessage(client, guild, ref) {
  const channel = guild.channels.cache.get(ref.channelId);
  if (!channel) return;

  const payload = {
    embeds: [await buildLeaderboardEmbed(client, guild, 'week')],
    components: [buildPeriodButtons()]
  };

  const message = await channel.messages.fetch(ref.messageId).catch(() => null);
  if (message) {
    await message.edit(payload);
    return;
  }

  // Nachricht wurde gelöscht → neu posten.
  const created = await channel.send(payload);
  await saveLeaderboardMessage(client, guild.id, created);
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
      // Nur Server, auf denen /rangliste setup ausgeführt wurde.
      const ref = await client.db.get(messageKey(guild.id));
      if (!ref?.channelId || !ref?.messageId) continue;

      await refreshMessage(client, guild, ref);
      await syncRoles(client, guild);
    } catch (error) {
      logger.error('[Rangliste] Update failed', { guildId: guild.id, error: error.message });
    }
  }
}

export async function syncLeaderboardRoles(client, guild) {
  await syncRoles(client, guild);
}
