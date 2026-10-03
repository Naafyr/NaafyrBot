import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { reportProblem } from '../utils/statusReporter.js';
import { getTwitchConfig, twitchGet } from './twitchLiveService.js';

const CLIP_CHANNEL_NAMES = new Set(['✂️┃clips-und-highlights', 'clips-und-highlights', 'clips']);
// Twitch listet neue Clips teils verzögert → immer die letzten 2 Stunden abfragen, Doppelte über IDs filtern.
const LOOKBACK_MS = 2 * 60 * 60 * 1000;
const MAX_REMEMBERED_IDS = 300;

let broadcasterId = null;

function stateKey(guildId) {
  return `guild:${guildId}:twitch:clips`;
}

async function getBroadcasterId(config) {
  if (broadcasterId) return broadcasterId;
  const response = await twitchGet(config, '/users', { login: config.channel });
  broadcasterId = response.data?.data?.[0]?.id || null;
  if (!broadcasterId) throw new Error(`Twitch user ${config.channel} not found`);
  return broadcasterId;
}

export async function fetchRecentClips(config, now = new Date()) {
  const response = await twitchGet(config, '/clips', {
    broadcaster_id: await getBroadcasterId(config),
    started_at: new Date(now.getTime() - LOOKBACK_MS).toISOString(),
    ended_at: now.toISOString(),
    first: 100
  });
  return response.data?.data || [];
}

function buildClipEmbed(clip) {
  return new EmbedBuilder()
    .setColor(0x9146FF)
    .setAuthor({ name: '✂️ Neuer Clip' })
    .setTitle(String(clip.title || 'Clip').slice(0, 256))
    .setURL(clip.url)
    .setDescription([
      `🎬 Geclippt von **${clip.creator_name || 'Unbekannt'}**`,
      `⏱️ ${Math.round(Number(clip.duration) || 0)} Sekunden`
    ].join('\n'))
    .setImage(clip.thumbnail_url || null)
    .setFooter({ text: 'Twitch Clips' })
    .setTimestamp(new Date(clip.created_at));
}

function buildClipButton(clip) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Clip ansehen')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Link)
      .setURL(clip.url)
  );
}

// Postet alle Clips, die nach dem ersten Start erstellt und noch nicht gepostet wurden (älteste zuerst).
export async function postNewClips(client, guild, clips, now = new Date()) {
  const channel = guild.channels.cache.find(candidate =>
    candidate.type === ChannelType.GuildText && CLIP_CHANNEL_NAMES.has(candidate.name)
  );
  if (!channel) return 0;

  const key = stateKey(guild.id);
  const state = (await client.db.get(key)) || null;

  // Erster Lauf: nichts Altes nachposten, nur ab jetzt.
  if (!state?.since) {
    await client.db.set(key, { since: now.toISOString(), ids: [] });
    return 0;
  }

  const since = new Date(state.since).getTime();
  const posted = new Set(state.ids || []);
  const fresh = clips
    .filter(clip => !posted.has(clip.id) && new Date(clip.created_at).getTime() >= since)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (const clip of fresh) {
    await channel.send({ embeds: [buildClipEmbed(clip)], components: [buildClipButton(clip)] });
    posted.add(clip.id);
    await client.db.set(key, { since: state.since, ids: [...posted].slice(-MAX_REMEMBERED_IDS) });
    logger.info('[TwitchClips] Clip posted', { guildId: guild.id, clipId: clip.id });
  }

  return fresh.length;
}

export async function checkTwitchClips(client) {
  const config = getTwitchConfig();
  if (!config || !client?.isReady?.() || !client.db) return;

  const clips = await fetchRecentClips(config);

  for (const guild of client.guilds.cache.values()) {
    try {
      await postNewClips(client, guild, clips);
    } catch (error) {
      logger.error('[TwitchClips] Failed to post clips', { guildId: guild.id, error: error.message });
      reportProblem('✂️ Twitch-Clips', `Clips konnten nicht gepostet werden: ${error.message}`);
    }
  }
}
