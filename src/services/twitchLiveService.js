import axios from 'axios';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { reportProblem } from '../utils/statusReporter.js';

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const LIVE_CHANNEL_NAMES = new Set(['🔴┃live', 'live']);
const ACTIVE_FOOTER = 'Twitch • LIVE';
const OFFLINE_GRACE_MS = 15 * 60_000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export function getTwitchConfig() {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  const channel = process.env.TWITCH_CHANNEL?.trim().toLowerCase();

  if (!clientId || !clientSecret || !channel) {
    return null;
  }

  return { clientId, clientSecret, channel };
}

async function getAppAccessToken(config) {
  const now = Date.now();

  if (cachedToken && now < cachedTokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const response = await axios.post(
    TWITCH_TOKEN_URL,
    null,
    {
      params: {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials'
      },
      timeout: 15_000
    }
  );

  cachedToken = response.data.access_token;
  cachedTokenExpiresAt = now + (Number(response.data.expires_in || 0) * 1000);

  return cachedToken;
}

export async function twitchGet(config, path, params = {}) {
  const token = await getAppAccessToken(config);

  try {
    return await axios.get(`${TWITCH_API_BASE}${path}`, {
      params,
      headers: {
        'Client-Id': config.clientId,
        Authorization: `Bearer ${token}`
      },
      timeout: 15_000
    });
  } catch (error) {
    if (error.response?.status === 401) {
      cachedToken = null;
      cachedTokenExpiresAt = 0;

      const retryToken = await getAppAccessToken(config);

      return await axios.get(`${TWITCH_API_BASE}${path}`, {
        params,
        headers: {
          'Client-Id': config.clientId,
          Authorization: `Bearer ${retryToken}`
        },
        timeout: 15_000
      });
    }

    throw error;
  }
}

async function fetchStream(config) {
  const response = await twitchGet(config, '/streams', {
    user_login: config.channel
  });

  return response.data?.data?.[0] || null;
}

function findLiveChannel(guild) {
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    LIVE_CHANNEL_NAMES.has(channel.name)
  ) || null;
}

function twitchUrl(channel) {
  return `https://www.twitch.tv/${encodeURIComponent(channel)}`;
}

function buildThumbnailUrl(stream) {
  if (!stream?.thumbnail_url) return null;

  return stream.thumbnail_url
    .replace('{width}', '1280')
    .replace('{height}', '720') +
    `?t=${Date.now()}`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatDuration(start, end) {
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours} Std. ${minutes} Min.`;
  if (hours > 0) return `${hours} Std.`;
  return `${minutes} Min.`;
}

function buildLiveEmbed(stream, channel, startOverride = null) {
  const startedAt = new Date(startOverride || stream.started_at);
  const embed = new EmbedBuilder()
    .setColor(0x9146FF)
    .setTitle('🔴 Naafyr ist live!')
    .setURL(twitchUrl(channel))
    .setDescription(stream.title || 'Der Stream ist live.')
    .addFields(
      {
        name: 'Spiel',
        value: stream.game_name || 'Keine Kategorie',
        inline: true
      },
      {
        name: 'Live seit',
        value: `${formatTime(startedAt)} Uhr`,
        inline: true
      }
    )
    .setFooter({ text: ACTIVE_FOOTER })
    .setTimestamp(startedAt);

  const thumbnail = buildThumbnailUrl(stream);
  if (thumbnail) embed.setImage(thumbnail);

  return embed;
}

function buildEndedEmbed(activeEmbed, endTime, games = []) {
  const raw = activeEmbed.toJSON ? activeEmbed.toJSON() : activeEmbed;
  const startTime = raw.timestamp ? new Date(raw.timestamp) : new Date(endTime);
  const title = raw.description || 'Stream';
  const game = raw.fields?.find(field => field.name === 'Spiel')?.value || 'Keine Kategorie';

  return new EmbedBuilder()
    .setColor(0x4B4B52)
    .setTitle('⚫ Naafyr war live – danke fürs Zuschauen!')
    .setDescription(title)
    .addFields(
      {
        name: games.length > 1 ? 'Gestreamt' : 'Spiel',
        value: games.length > 1 ? games.join(' → ') : game,
        inline: true
      },
      {
        name: 'Dauer',
        value: formatDuration(startTime, endTime),
        inline: true
      },
      {
        name: 'Zeitraum',
        value: `▶️ Stream-Start: **${formatTime(startTime)} Uhr**\n⏹️ Stream beendet: **${formatTime(endTime)} Uhr**`,
        inline: false
      }
    )
    .setFooter({ text: `Twitch • Stream beendet • ${formatTime(endTime)} Uhr` })
    .setTimestamp(endTime);
}

// Text über der Box: statt "ist jetzt live" steht nach dem Stream "war live" + Dauer.
function endedContent(endedEmbed) {
  const duration = endedEmbed.toJSON().fields.find(field => field.name === 'Dauer')?.value;
  return `⚫ **Naafyr war live**${duration ? ` – ${duration}` : ''}`;
}

function buildStreamButton(channel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Stream öffnen')
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Link)
      .setURL(twitchUrl(channel))
  );
}

async function findActiveBotMessage(channel, clientUserId) {
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!messages) return null;

  return messages.find(message => {
    if (message.author.id !== clientUserId) return false;
    const embed = message.embeds?.[0];
    return embed?.footer?.text === ACTIVE_FOOTER;
  }) || null;
}

// Alle Games eines Streams in Reihenfolge (ohne direkte Wiederholung).
async function loadGames(client, key) {
  const games = await client.db?.get?.(key).catch(() => null);
  return Array.isArray(games) ? games : [];
}

async function rememberGame(client, key, game) {
  if (!game) return;
  const games = await loadGames(client, key);
  if (games.at(-1) === game) return;
  await client.db?.set?.(key, [...games, game].slice(-10)).catch(() => {});
}

function sameStream(message, stream) {
  const timestamp = message?.embeds?.[0]?.timestamp;
  if (!timestamp || !stream?.started_at) return false;

  const messageStart = new Date(timestamp).getTime();
  const twitchStart = new Date(stream.started_at).getTime();

  return Math.abs(messageStart - twitchStart) < 120_000;
}

// Merkt sich die aktive Live-Nachricht (ID + Startzeit). So wird pro Stream nur EINMAL gepostet,
// auch wenn die Nachricht beim Durchsuchen mal nicht gefunden wird.
async function loadActiveMessage(client, channel, recordKey) {
  const record = await client.db?.get?.(recordKey).catch(() => null);
  let deleted = false;
  let message = record?.messageId
    ? await channel.messages.fetch(record.messageId).catch(error => { deleted = error?.code === 10008; return null; })
    : null;
  if (!message) message = await findActiveBotMessage(channel, client.user.id);
  const isLive = message?.embeds?.[0]?.footer?.text === ACTIVE_FOOTER;
  // Gemerkte Nachricht wurde gelöscht (Discord: "Unknown Message") → Merker gilt nicht mehr.
  const validRecord = record && typeof record === 'object' && !(deleted && !isLive) ? record : null;
  return { record: validRecord, message: isLive ? message : null };
}

// Einmalig beim Start: alle Bot-Nachrichten im Live-Channel löschen außer der neuesten (Aufräumen nach dem Spam-Fehler).
export async function cleanupLiveChannelOnce(client) {
  for (const guild of client.guilds.cache.values()) {
    const doneKey = `guild:${guild.id}:migration:liveCleanup`;
    try {
      if (await client.db?.get?.(doneKey)) continue;
      const channel = findLiveChannel(guild);
      if (!channel) continue;
      const own = [];
      let before;
      for (let page = 0; page < 10; page++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (batch.size === 0) break;
        own.push(...batch.filter(message => message.author.id === client.user.id).values());
        before = batch.last().id;
      }
      own.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const [keep, ...remove] = own;
      // Jünger als 14 Tage → Sammel-Löschung, ältere einzeln (Discord-Regel).
      const cutoff = Date.now() - 13 * 86_400_000;
      const recent = remove.filter(message => message.createdTimestamp > cutoff);
      for (let i = 0; i < recent.length; i += 100) {
        const chunk = recent.slice(i, i + 100);
        if (chunk.length === 1) await chunk[0].delete().catch(() => {});
        else await channel.bulkDelete(chunk.map(message => message.id)).catch(() => {});
      }
      for (const message of remove.filter(message => message.createdTimestamp <= cutoff)) await message.delete().catch(() => {});
      if (keep) await client.db?.set?.(`guild:${guild.id}:twitch:liveMessage`, { messageId: keep.id, postedAt: keep.createdTimestamp, ended: keep.embeds?.[0]?.footer?.text !== ACTIVE_FOOTER }).catch(() => {});
      await client.db?.set?.(doneKey, true);
      logger.info('[TwitchLive] Live-Channel aufgeräumt', { guildId: guild.id, deleted: remove.length });
    } catch (error) {
      logger.warn('[TwitchLive] Aufräumen fehlgeschlagen', { guildId: guild.id, error: error.message });
    }
  }
}

// Doppelte Live-Boxen (z. B. vom alten Fehler) löschen – nur eigene, die aktive bleibt.
async function deleteDuplicateLiveMessages(channel, keepId, botId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;
  const duplicates = messages.filter(message => message.id !== keepId && message.author.id === botId
    && message.embeds?.[0]?.footer?.text === ACTIVE_FOOTER);
  for (const message of duplicates.values()) await message.delete().catch(() => {});
  if (duplicates.size) logger.info('[TwitchLive] Doppelte Live-Nachrichten gelöscht', { count: duplicates.size });
}

async function handleGuild(client, guild, stream, config) {
  const channel = findLiveChannel(guild);
  if (!channel) return;

  const recordKey = `guild:${guild.id}:twitch:liveMessage`;
  const offlineKey = `guild:${guild.id}:twitch:offlineSince`;
  const gamesKey = `guild:${guild.id}:twitch:games`;
  const { record, message: activeMessage } = await loadActiveMessage(client, channel, recordKey);
  const openRecord = Boolean(record && !record.ended);
  const offlineSince = activeMessage || openRecord ? Number(await client.db?.get?.(offlineKey).catch(() => null)) || null : null;

  if (stream) {
    // Eine noch laufende Live-Box (jünger als 24 Std.) gehört IMMER zum aktuellen Stream:
    // nur bearbeiten, nie neu posten. Startzeit der Box bleibt (auch nach Aussetzern).
    const boxStart = activeMessage?.embeds?.[0]?.timestamp;
    const boxFresh = boxStart && Date.now() - new Date(boxStart).getTime() < 24 * 3_600_000;
    if (activeMessage && (boxFresh || sameStream(activeMessage, stream))) {
      if (offlineSince) await client.db?.delete?.(offlineKey).catch(() => {});
      if (record?.messageId !== activeMessage.id) {
        await client.db?.set?.(recordKey, { messageId: activeMessage.id, postedAt: record?.postedAt || Date.now(), ended: false }).catch(() => {});
      }
      await deleteDuplicateLiveMessages(channel, activeMessage.id, client.user.id);
      await rememberGame(client, gamesKey, stream.game_name);
      await activeMessage.edit({
        embeds: [buildLiveEmbed(stream, config.channel, boxStart || null)],
        components: [buildStreamButton(config.channel)]
      });
      return;
    }

    // Sicherung: Es gibt eine noch nicht beendete Live-Nachricht (< 24 Std.) → nicht nochmal pingen.
    if (record && !record.ended && Date.now() - (record.postedAt || 0) < 24 * 3_600_000) {
      logger.warn('[TwitchLive] Live-Nachricht nicht gefunden, poste aber nicht doppelt', { guildId: guild.id });
      reportProblem('🔴 Twitch-Live', 'Die Live-Nachricht wurde nicht gefunden (gelöscht oder keine Leserechte im Live-Channel?). Es wird nicht nochmal gepostet.');
      return;
    }

    if (activeMessage) {
      await client.db?.set?.(recordKey, { ...(record || {}), ended: true }).catch(() => {});
      const endedEmbed = buildEndedEmbed(activeMessage.embeds[0], new Date(), await loadGames(client, gamesKey));
      await activeMessage.edit({
        content: endedContent(endedEmbed),
        allowedMentions: { parse: [] },
        embeds: [endedEmbed],
        components: []
      });
    }

    await client.db?.set?.(gamesKey, stream.game_name ? [stream.game_name] : []).catch(() => {});

    // Pingt alle, die den Channel sehen. Wer "Keine Live-Pings" hat, sieht ihn nicht.
    const sent = await channel.send({
      content: '@everyone 🔴 **Naafyr ist jetzt live – komm vorbei!**',
      allowedMentions: { parse: ['everyone'] },
      embeds: [buildLiveEmbed(stream, config.channel)],
      components: [buildStreamButton(config.channel)]
    });
    await client.db?.set?.(recordKey, { messageId: sent.id, postedAt: Date.now(), ended: false }).catch(() => {});

    logger.info('[TwitchLive] Live announcement created', {
      guildId: guild.id,
      channelId: channel.id,
      twitchChannel: config.channel
    });

    return;
  }

  if (activeMessage || openRecord) {
    // Erst nach 15 Min. am Stück offline als beendet werten (Twitch-Aussetzer, Stream-Absturz).
    const now = Date.now();
    if (!offlineSince) {
      await client.db?.set?.(offlineKey, now);
      return;
    }
    if (now - offlineSince < OFFLINE_GRACE_MS) return;
    await client.db?.delete?.(offlineKey).catch(() => {});
    await client.db?.set?.(recordKey, { ...(record || {}), ended: true }).catch(() => {});

    // Nachricht nicht lesbar → nur als beendet merken.
    if (!activeMessage) return;
    await deleteDuplicateLiveMessages(channel, activeMessage.id, client.user.id);

    // Ende = Zeitpunkt, ab dem der Stream wirklich weg war.
    const endedEmbed = buildEndedEmbed(activeMessage.embeds[0], new Date(offlineSince), await loadGames(client, gamesKey));

    await activeMessage.edit({
      content: endedContent(endedEmbed),
      allowedMentions: { parse: [] },
      embeds: [endedEmbed],
      components: []
    });

    logger.info('[TwitchLive] Live announcement marked as ended', {
      guildId: guild.id,
      channelId: channel.id,
      twitchChannel: config.channel
    });
  }
}

export async function checkTwitchLive(client) {
  const config = getTwitchConfig();

  if (!config) {
    logger.warn('[TwitchLive] Missing TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET or TWITCH_CHANNEL');
    reportProblem('🔴 Twitch-Live', 'Twitch-Zugangsdaten fehlen in Railway (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET / TWITCH_CHANNEL).');
    return;
  }

  if (!client?.isReady?.()) {
    return;
  }

  const stream = await fetchStream(config);

  for (const guild of client.guilds.cache.values()) {
    try {
      await handleGuild(client, guild, stream, config);
    } catch (error) {
      reportProblem('🔴 Twitch-Live', `Live-Box konnte nicht aktualisiert werden: ${error.message}`);
      logger.error('[TwitchLive] Failed to update Discord live status', {
        guildId: guild.id,
        error: error.message
      });
    }
  }
}
