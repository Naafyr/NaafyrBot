import axios from 'axios';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { logger } from '../utils/logger.js';

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const LIVE_CHANNEL_NAMES = new Set(['🔴┃live', 'live']);
const ACTIVE_FOOTER = 'Twitch • LIVE';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getTwitchConfig() {
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

async function twitchGet(config, path, params = {}) {
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

function buildLiveEmbed(stream, channel) {
  const startedAt = new Date(stream.started_at);
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

function buildEndedEmbed(activeEmbed, endTime) {
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
        name: 'Spiel',
        value: game,
        inline: true
      },
      {
        name: 'Zeitraum',
        value: `${formatTime(startTime)} – ${formatTime(endTime)} Uhr`,
        inline: true
      },
      {
        name: 'Dauer',
        value: formatDuration(startTime, endTime),
        inline: true
      }
    )
    .setFooter({ text: `Twitch • Stream beendet • ${formatTime(endTime)} Uhr` })
    .setTimestamp(endTime);
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

function sameStream(message, stream) {
  const timestamp = message?.embeds?.[0]?.timestamp;
  if (!timestamp || !stream?.started_at) return false;

  const messageStart = new Date(timestamp).getTime();
  const twitchStart = new Date(stream.started_at).getTime();

  return Math.abs(messageStart - twitchStart) < 120_000;
}

async function handleGuild(client, guild, stream, config) {
  const channel = findLiveChannel(guild);
  if (!channel) return;

  const activeMessage = await findActiveBotMessage(channel, client.user.id);

  if (stream) {
    if (activeMessage && sameStream(activeMessage, stream)) {
      const newEmbed = buildLiveEmbed(stream, config.channel);
      await activeMessage.edit({
        embeds: [newEmbed],
        components: [buildStreamButton(config.channel)]
      });
      return;
    }

    if (activeMessage) {
      const endedEmbed = buildEndedEmbed(activeMessage.embeds[0], new Date());
      await activeMessage.edit({
        embeds: [endedEmbed],
        components: []
      });
    }

    await channel.send({
      embeds: [buildLiveEmbed(stream, config.channel)],
      components: [buildStreamButton(config.channel)]
    });

    logger.info('[TwitchLive] Live announcement created', {
      guildId: guild.id,
      channelId: channel.id,
      twitchChannel: config.channel
    });

    return;
  }

  if (activeMessage) {
    const endedEmbed = buildEndedEmbed(activeMessage.embeds[0], new Date());

    await activeMessage.edit({
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
      logger.error('[TwitchLive] Failed to update Discord live status', {
        guildId: guild.id,
        error: error.message
      });
    }
  }
}
