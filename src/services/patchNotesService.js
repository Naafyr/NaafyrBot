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
import { GAMES } from './roleSelectionService.js';

const HTTP = { timeout: 15_000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NaafyrBot/1.0)' } };
const MAX_NEW_PER_CHECK = 3;
const SUMMARY_LENGTH = 350;

// Steam: nur echte Patch-/Update-Posts, keine Sales, Turniere oder Werbung.
const STEAM_INCLUDE = /patch|update|hotfix|season|notes|release|\bv?\d+\.\d+/i;
const STEAM_EXCLUDE = /\bsale\b|% off|discount|tournament|finals|esports|giveaway|twitch drops|store update|service report|bans? notice/i;

function stateKey(guildId, gameKey) {
  return `guild:${guildId}:patchnotes:${gameKey}`;
}

function cleanText(text = '') {
  return String(text)
    .replace(/\[\/?[^\]]+\]/g, ' ')          // Steam-BBCode
    .replace(/<[^>]+>/g, ' ')                // HTML
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(text, length = SUMMARY_LENGTH) {
  return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, '')} …` : text;
}

// ---------- Quellen (liefern neueste zuerst) ----------

async function fetchSteam(source) {
  const response = await axios.get('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/', {
    ...HTTP,
    // Manche Games (z. B. PUBG) posten Patch Notes nur monatlich zwischen vielen News → weit zurückschauen,
    // Inhalt dafür kürzen.
    params: { appid: source.appId, count: 100, maxlength: 1500, feeds: 'steam_community_announcements' }
  });

  return (response.data?.appnews?.newsitems || [])
    .filter(item => item.tags?.includes('patchnotes') || (source.titleMatch
      ? source.titleMatch.test(item.title)
      : STEAM_INCLUDE.test(item.title) && !STEAM_EXCLUDE.test(item.title)))
    .map(item => {
      const imagePath = item.contents?.match(/\{STEAM_CLAN_IMAGE\}\/(\S+?\.(?:png|jpe?g|gif))/i)?.[1];
      return {
        id: String(item.gid),
        title: item.title,
        url: item.url,
        date: new Date(item.date * 1000),
        summary: shorten(cleanText(item.contents)),
        image: imagePath ? `https://clan.akamai.steamstatic.com/images/${imagePath}` : null
      };
    });
}

function collectRiotArticles(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach(child => collectRiotArticles(child, found));
    return found;
  }

  const url = node.action?.payload?.url;
  if (typeof node.title === 'string' && typeof url === 'string' && node.publishedAt && /patch/i.test(url)) {
    found.push(node);
  }
  Object.values(node).forEach(child => collectRiotArticles(child, found));
  return found;
}

async function fetchRiot(source) {
  const response = await axios.get(source.page, { ...HTTP, responseType: 'text' });
  const json = response.data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error('Riot page structure changed (no __NEXT_DATA__)');

  const origin = new URL(source.page).origin;
  const seen = new Set();

  return collectRiotArticles(JSON.parse(json))
    .filter(article => source.urlMatch.test(article.action.payload.url))
    .map(article => {
      const path = article.action.payload.url;
      return {
        id: path,
        title: article.title,
        url: path.startsWith('http') ? path : `${origin}${path}`,
        date: new Date(article.publishedAt),
        summary: shorten(cleanText(article.description?.body || '')),
        image: article.imageMedia?.url || article.media?.url || null
      };
    })
    .filter(article => !seen.has(article.id) && seen.add(article.id))
    .sort((a, b) => b.date - a.date);
}

async function fetchMojang() {
  const response = await axios.get('https://launchercontent.mojang.com/v2/javaPatchNotes.json', HTTP);

  return (response.data?.entries || [])
    .filter(entry => entry.type === 'release')
    .map(entry => ({
      id: String(entry.id),
      title: entry.title,
      url: `https://www.minecraft.net/de-de/article/minecraft-java-edition-${String(entry.version).replace(/\./g, '-')}`,
      date: new Date(entry.date),
      summary: shorten(cleanText(entry.shortText || '')),
      image: entry.image?.url ? `https://launchercontent.mojang.com${entry.image.url}` : null
    }))
    .sort((a, b) => b.date - a.date);
}

const FETCHERS = { steam: fetchSteam, riot: fetchRiot, mojang: fetchMojang };

export async function fetchPatchNotes(game) {
  return FETCHERS[game.source.type](game.source);
}

// ---------- Posten ----------

function buildPatchEmbed(game, item) {
  const embed = new EmbedBuilder()
    .setColor(game.color)
    .setAuthor({ name: `${game.emoji} ${game.name} • Patch Notes` })
    .setTitle(item.title.slice(0, 256))
    .setURL(item.url)
    .setDescription([item.summary || null, '📖 Alle Details findest du über den Button unten.'].filter(Boolean).join('\n\n'))
    .setFooter({ text: `Quelle: ${game.source.label}` })
    .setTimestamp(item.date);

  if (item.image) embed.setImage(item.image);
  return embed;
}

function buildPatchButton(item) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Patch Notes lesen')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Link)
      .setURL(item.url)
  );
}

const MAX_REMEMBERED_IDS = 50;

// Gespeichert werden alle geposteten IDs + Datum des neuesten Posts. Gepostet wird nur, was neuer UND
// noch nicht gepostet ist – so entstehen keine Doppelposts, wenn eine Quelle kurz eine veraltete Liste liefert.
function readState(raw, items) {
  if (raw && typeof raw === 'object') {
    return { lastDate: Number(raw.lastDate) || 0, ids: new Set(raw.ids || []) };
  }
  if (typeof raw === 'string') {
    // Altes Format (nur letzte ID): ab dem neuesten bekannten Eintrag weitermachen, nichts nachposten.
    const known = items.find(item => item.id === raw);
    return { lastDate: (known || items[0])?.date.getTime() || 0, ids: new Set([raw]) };
  }
  return null;
}

export async function postForGuild(client, guild, gameKey, game, items) {
  const channel = guild.channels.cache.find(candidate =>
    candidate.type === ChannelType.GuildText && candidate.name === game.patch
  );
  if (!channel || items.length === 0) return 0;

  const key = stateKey(guild.id, gameKey);
  const state = readState(await client.db.get(key), items);

  // Erster Lauf: nur den neuesten Patch posten, damit der Channel nicht leer ist.
  const fresh = state
    ? items
      .filter(item => !state.ids.has(item.id) && item.date.getTime() > state.lastDate)
      .slice(0, MAX_NEW_PER_CHECK)
      .reverse()
    : [items[0]];

  const ids = state?.ids || new Set();
  let lastDate = state?.lastDate || 0;

  for (const item of fresh) {
    await channel.send({ embeds: [buildPatchEmbed(game, item)], components: [buildPatchButton(item)] });
    ids.add(item.id);
    lastDate = Math.max(lastDate, item.date.getTime());
    await client.db.set(key, { lastDate, ids: [...ids].slice(-MAX_REMEMBERED_IDS) });
    logger.info('[PatchNotes] Posted', { guildId: guild.id, game: gameKey, title: item.title });
  }

  return fresh.length;
}

export async function checkPatchNotes(client) {
  if (!client?.isReady?.() || !client.db) return;

  for (const [gameKey, game] of Object.entries(GAMES)) {
    let items;
    try {
      items = await fetchPatchNotes(game);
    } catch (error) {
      logger.warn('[PatchNotes] Source failed', { game: gameKey, error: error.message });
      reportProblem(`📰 Patch-Notes ${game.name}`, `Quelle nicht erreichbar: ${error.message}`);
      continue;
    }

    for (const guild of client.guilds.cache.values()) {
      try {
        await postForGuild(client, guild, gameKey, game, items);
      } catch (error) {
        logger.error('[PatchNotes] Post failed', { guildId: guild.id, game: gameKey, error: error.message });
        reportProblem(`📰 Patch-Notes ${game.name}`, `Posten fehlgeschlagen: ${error.message}`);
      }
    }
  }
}
