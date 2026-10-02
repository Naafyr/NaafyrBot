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
// Fest eingetragen: Die @Naafyr-Seite liefert von Servern aus oft nur die Cookie-Zustimmungsseite.
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID?.trim() || 'UChbVmSrU8EtJChFwbf7JVbQ';
const YOUTUBE_CHANNEL_URL = `https://www.youtube.com/@${YOUTUBE_HANDLE}`;
const YOUTUBE_FEED_BASE = 'https://www.youtube.com/feeds/videos.xml';
const LEGACY_FOOTER_PREFIX = 'YouTube • ';

const shortCache = new Map();

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

function parseEntry(entry) {
  const videoId = extractFirst(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/i);
  const title = extractFirst(entry, /<title>([\s\S]*?)<\/title>/i);
  const published = extractFirst(entry, /<published>([^<]+)<\/published>/i);
  const linkMatch = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i)
    || entry.match(/<link[^>]+href="([^"]+)"[^>]+rel="alternate"/i);

  if (!videoId || !title) return null;

  return {
    videoId,
    title,
    published,
    url: decodeXml(linkMatch?.[1] || `https://www.youtube.com/watch?v=${videoId}`),
    thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
  };
}

function parseEntries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)]
    .map(match => parseEntry(match[1]))
    .filter(Boolean);
}

async function fetchEntries() {
  const response = await axios.get(YOUTUBE_FEED_BASE, {
    params: { channel_id: YOUTUBE_CHANNEL_ID },
    timeout: 15_000,
    responseType: 'text'
  });

  return parseEntries(response.data);
}

// /shorts/<id> antwortet bei Shorts mit 200, bei normalen Videos mit Redirect auf /watch.
async function isShort(video) {
  if (video.url.includes('/shorts/')) return true;
  if (shortCache.has(video.videoId)) return shortCache.get(video.videoId);

  const response = await axios.head(`https://www.youtube.com/shorts/${video.videoId}`, {
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 15_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NaafyrBot/1.0)',
      Cookie: 'SOCS=CAI'
    }
  });

  let result;
  if (response.status === 200) {
    result = true;
  } else if (response.status >= 300 && response.status < 400 && String(response.headers.location || '').includes('/watch')) {
    result = false;
  } else {
    // Lieber nicht posten als im falschen Channel.
    throw new Error(`Could not classify YouTube video ${video.videoId} (status ${response.status})`);
  }

  shortCache.set(video.videoId, result);
  return result;
}

async function fetchLatest() {
  const entries = await fetchEntries();
  let video = null;
  let short = null;

  for (const entry of entries) {
    if (await isShort(entry)) {
      short ??= { ...entry, url: `https://www.youtube.com/shorts/${entry.videoId}` };
    } else {
      video ??= entry;
    }
    if (video && short) break;
  }

  return { video, short };
}

function buildVideoEmbed(video) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0033)
    .setAuthor({
      name: 'Naafyr auf YouTube',
      url: YOUTUBE_CHANNEL_URL
    })
    .setTitle('📺 Neues Video ist online!')
    .setURL(video.url)
    .setDescription([
      `## ${video.title}`,
      '',
      '🎬 **Frisch hochgeladen – jetzt auf YouTube ansehen.**'
    ].join('\n'))
    .setImage(video.thumbnail)
    .setFooter({ text: 'YouTube • @Naafyr' });

  if (video.published) {
    embed.setTimestamp(new Date(video.published));
  }

  return embed;
}

function buildShortEmbed(short) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0033)
    .setAuthor({
      name: 'Naafyr auf YouTube',
      url: YOUTUBE_CHANNEL_URL
    })
    .setTitle('📱 Neuer Short!')
    .setURL(short.url)
    .setDescription(`**${short.title}**`)
    .setThumbnail(`https://i.ytimg.com/vi/${short.videoId}/hqdefault.jpg`)
    .setFooter({ text: 'YouTube Shorts • @Naafyr' });

  if (short.published) {
    embed.setTimestamp(new Date(short.published));
  }

  return embed;
}

function buildButton(label, url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(label)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

const UPLOAD_TYPES = {
  video: {
    channelNames: new Set(['📺┃neue-videos', 'neue-videos', 'videos']),
    stateKey: guildId => `guild:${guildId}:youtube:lastVideoId`,
    build: video => ({ embeds: [buildVideoEmbed(video)], components: [buildButton('Video ansehen', video.url)] })
  },
  short: {
    channelNames: new Set(['📱┃neue-shorts', 'neue-shorts', 'shorts']),
    stateKey: guildId => `guild:${guildId}:youtube:lastShortId`,
    build: short => ({ embeds: [buildShortEmbed(short)], components: [buildButton('Short ansehen', short.url)] })
  }
};

function findChannel(guild, names) {
  return guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    names.has(channel.name)
  ) || null;
}

async function alreadyPosted(client, stateKey, channel, item) {
  try {
    const savedId = await client.db?.get?.(stateKey);
    if (savedId === item.videoId) {
      return true;
    }
  } catch (error) {
    logger.warn('[YouTube] Could not read last posted ID from database', {
      stateKey,
      error: error.message
    });
  }

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return false;

  const found = messages.some(message => {
    if (message.author.id !== client.user.id) return false;

    return message.embeds?.some(embed =>
      embed.url?.includes(item.videoId) ||
      embed.footer?.text === `${LEGACY_FOOTER_PREFIX}${item.videoId}`
    );
  });

  if (found) {
    try {
      await client.db?.set?.(stateKey, item.videoId);
    } catch (error) {
      logger.warn('[YouTube] Could not persist discovered ID', { stateKey, error: error.message });
    }
  }

  return found;
}

async function postIfNew(client, guild, type, item) {
  if (!item) return { posted: false, reason: 'none' };

  const config = UPLOAD_TYPES[type];
  const channel = findChannel(guild, config.channelNames);
  if (!channel) return { posted: false, reason: 'channel_missing', item };

  const stateKey = config.stateKey(guild.id);
  if (await alreadyPosted(client, stateKey, channel, item)) {
    return { posted: false, reason: 'already_posted', item, channel };
  }

  await channel.send(config.build(item));

  try {
    await client.db?.set?.(stateKey, item.videoId);
  } catch (error) {
    logger.warn('[YouTube] Could not persist posted ID', {
      guildId: guild.id,
      type,
      videoId: item.videoId,
      error: error.message
    });
  }

  logger.info('[YouTube] New upload announcement created', {
    guildId: guild.id,
    channelId: channel.id,
    type,
    videoId: item.videoId
  });

  return { posted: true, reason: 'posted', item, channel };
}

export async function checkYouTubeForGuild(client, guild, latest = null) {
  if (!client?.isReady?.()) {
    return { checked: false, reason: 'client_not_ready' };
  }

  latest ??= await fetchLatest();

  return {
    checked: true,
    video: await postIfNew(client, guild, 'video', latest.video),
    short: await postIfNew(client, guild, 'short', latest.short)
  };
}

export async function checkYouTubeUploads(client) {
  if (!client?.isReady?.()) return;

  const latest = await fetchLatest();

  for (const guild of client.guilds.cache.values()) {
    try {
      await checkYouTubeForGuild(client, guild, latest);
    } catch (error) {
      logger.error('[YouTube] Failed to update Discord upload feed', {
        guildId: guild.id,
        error: error.message
      });
    }
  }
}
