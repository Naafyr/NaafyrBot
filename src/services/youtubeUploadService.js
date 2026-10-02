import axios from 'axios';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { logger } from '../utils/logger.js';

const YOUTUBE_HANDLE = 'Naafyr';
const YOUTUBE_CHANNEL_URL = `https://www.youtube.com/@${YOUTUBE_HANDLE}`;
const YOUTUBE_FEED_BASE = 'https://www.youtube.com/feeds/videos.xml';
const YOUTUBE_CHANNEL_NAMES = new Set(['📺┃neue-videos', 'neue-videos', 'videos']);
const FOOTER_PREFIX = 'YouTube • ';

let cachedChannelId = null;

function decodeXml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractFirst(text, pattern) {
  const match = text.match(pattern);
  return match?.[1] ? decodeXml(match[1].trim()) : null;
}

async function resolveChannelId() {
  if (cachedChannelId) return cachedChannelId;

  const response = await axios.get(YOUTUBE_CHANNEL_URL, {
    timeout: 15_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NaafyrBot/1.0)'
    }
  });

  const html = response.data;

  const candidates = [
    /"channelId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /<meta\s+itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{20,})"/i,
    /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{20,})/
  ];

  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (match?.[1]) {
      cachedChannelId = match[1];
      return cachedChannelId;
    }
  }

  throw new Error(`Could not resolve YouTube channel ID for @${YOUTUBE_HANDLE}`);
}

function parseLatestEntry(xml) {
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
  if (!entryMatch) return null;

  const entry = entryMatch[1];
  const videoId = extractFirst(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/i);
  const title = extractFirst(entry, /<title>([\s\S]*?)<\/title>/i);
  const published = extractFirst(entry, /<published>([^<]+)<\/published>/i);
  const linkMatch = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i)
    || entry.match(/<link[^>]+href="([^"]+)"[^>]+rel="alternate"/i);
  const thumbnailMatch = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i);

  if (!videoId || !title) return null;

  return {
    videoId,
    title,
    published,
    url: decodeXml(linkMatch?.[1] || `https://www.youtube.com/watch?v=${videoId}`),
    thumbnail: thumbnailMatch?.[1] ? decodeXml(thumbnailMatch[1]) : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };
}

async function fetchLatestVideo() {
  const channelId = await resolveChannelId();

  const response = await axios.get(YOUTUBE_FEED_BASE, {
    params: { channel_id: channelId },
    timeout: 15_000,
    responseType: 'text'
  });

  return parseLatestEntry(response.data);
}

function findYouTubeChannel(guild) {
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    YOUTUBE_CHANNEL_NAMES.has(channel.name)
  ) || null;
}

async function alreadyPosted(channel, clientUserId, videoId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return false;

  return messages.some(message =>
    message.author.id === clientUserId &&
    message.embeds?.some(embed => embed.footer?.text === `${FOOTER_PREFIX}${videoId}`)
  );
}

function buildVideoEmbed(video) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('📺 Neues Video ist online!')
    .setURL(video.url)
    .setDescription(video.title)
    .setImage(video.thumbnail)
    .setFooter({ text: `${FOOTER_PREFIX}${video.videoId}` });

  if (video.published) {
    embed.setTimestamp(new Date(video.published));
  }

  return embed;
}

function buildVideoButton(video) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Video ansehen')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Link)
      .setURL(video.url)
  );
}

export async function checkYouTubeUploads(client) {
  if (!client?.isReady?.()) return;

  const video = await fetchLatestVideo();
  if (!video) return;

  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = findYouTubeChannel(guild);
      if (!channel) continue;

      if (await alreadyPosted(channel, client.user.id, video.videoId)) {
        continue;
      }

      await channel.send({
        embeds: [buildVideoEmbed(video)],
        components: [buildVideoButton(video)]
      });

      logger.info('[YouTube] New upload announcement created', {
        guildId: guild.id,
        channelId: channel.id,
        videoId: video.videoId
      });
    } catch (error) {
      logger.error('[YouTube] Failed to update Discord upload feed', {
        guildId: guild.id,
        error: error.message
      });
    }
  }
}
