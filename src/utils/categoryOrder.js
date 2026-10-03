import { ChannelType } from 'discord.js';
import { logger } from './logger.js';

// Gewünschte Reihenfolge von oben nach unten. Erkannt wird über den exakten Namen,
// sonst über ein Stichwort im Namen (falls eine Kategorie früher anders hieß).
export const CATEGORY_ORDER = [
  { name: '▬▬▬ 📊 AUSHANG 📊 ▬▬▬', keywords: ['STATISTIK', 'AUSHANG'] },
  { name: '▬▬▬ 🚪 EINGANG 🚪 ▬▬▬', keywords: ['MOIN', 'EINGANG'] },
  { name: '▬▬▬ 🔔 GLOCKE 🔔 ▬▬▬', keywords: ['CONTENT', 'GLOCKE'] },
  { name: '▬▬▬ 🏆 EHRENTAFEL 🏆 ▬▬▬', keywords: ['LEADERBOARD', 'EHRENTAFEL'] },
  { name: '▬▬▬ 🛎️ EMPFANG 🛎️ ▬▬▬', keywords: ['WILLKOMMEN', 'EMPFANG'] },
  { name: '▬▬▬ 🍻 STAMMTISCH 🍻 ▬▬▬', keywords: ['COMMUNITY', 'STAMMTISCH'] },
  { name: '▬▬▬ 🛏️ ZIMMER 🛏️ ▬▬▬', keywords: ['VOICE', '🛏️ ZIMMER'] },
  { name: '▬▬▬ 🕯️ HINTERZIMMER 🕯️ ▬▬▬', keywords: ['VIP', 'HINTERZIMMER'] },
  { name: '▬▬▬ 🎲 SPIELTISCHE 🎲 ▬▬▬', keywords: ['GAMES', 'SPIELTISCHE'] },
  { name: '▬▬▬ 📰 NEUIGKEITEN 📰 ▬▬▬', keywords: ['PATCH', 'NEUIGKEITEN'] },
  { name: '▬▬▬ 🗝️ KELLER 🗝️ ▬▬▬', keywords: ['MODERATION', 'KELLER'] }
];

export const matchesCategoryEntry = (entry, name) => entry.keywords.some(keyword => name.toUpperCase().includes(keyword));

// Taverne-Umbenennung (04.10.2026): alte Namen → neue. Läuft beim Start, benennt nur um.
export const TAVERN_RENAMES = {
  '▬▬▬ 📊 SERVER-STATISTIKEN 📊 ▬▬▬': '▬▬▬ 📊 AUSHANG 📊 ▬▬▬',
  '▬▬▬ 👋 MOIN 👋 ▬▬▬': '▬▬▬ 🚪 EINGANG 🚪 ▬▬▬',
  '▬▬▬ 🎬 CONTENT 🎬 ▬▬▬': '▬▬▬ 🔔 GLOCKE 🔔 ▬▬▬',
  '▬▬▬ 🎭 WILLKOMMEN 🎭 ▬▬▬': '▬▬▬ 🛎️ EMPFANG 🛎️ ▬▬▬',
  '▬▬▬ 💬 COMMUNITY 💬 ▬▬▬': '▬▬▬ 🍻 STAMMTISCH 🍻 ▬▬▬',
  '▬▬▬ 🔊 VOICE 🔊 ▬▬▬': '▬▬▬ 🛏️ ZIMMER 🛏️ ▬▬▬',
  '▬▬▬ 💎 VIP 💎 ▬▬▬': '▬▬▬ 🕯️ HINTERZIMMER 🕯️ ▬▬▬',
  '▬▬▬ 🎮 GAMES 🎮 ▬▬▬': '▬▬▬ 🎲 SPIELTISCHE 🎲 ▬▬▬',
  '▬▬▬ 📰 PATCH-NOTES 📰 ▬▬▬': '▬▬▬ 📰 NEUIGKEITEN 📰 ▬▬▬',
  '▬▬▬ 🛡️ MODERATION 🛡️ ▬▬▬': '▬▬▬ 🗝️ KELLER 🗝️ ▬▬▬',
  '👋┃willkommen': '📜┃gästebuch',
  '💬┃allgemein': '🍺┃tresen',
  '➕┃channel-erstellen': '➕┃tisch-nehmen',
  '🔒┃privaten-channel-erstellen': '🔒┃zimmer-mieten',
  '😴┃afk': '😴┃schlafkammer',
  '💬┃vip-chat': '🗨️┃hinterzimmer-geflüster',
  '🔊┃VIP-Lounge': '🔊┃Hinterzimmer',
  '⏳┃vip-warteraum': '⏳┃vor-der-tür',
  '▬▬▬ 🏆 LEADERBOARD 🏆 ▬▬▬': '▬▬▬ 🏆 EHRENTAFEL 🏆 ▬▬▬',
  '🏆┃leaderboard': '🏆┃ehrentafel',
  '📜┃regeln': '📜┃hausordnung',
  '🎭┃rollen-auswahl': '🎒┃ausrüstung',
  '💭┃zitate': '🍺┃kneipenweisheiten',
  '📸┃allgemein-bilder': '🖼️┃bilderwand',
  '🍕┃essen-bilder': '🍖┃aus-der-küche',
  '🖥️┃setups': '⚒️┃die-schmiede',
  '💡┃vorschläge': '📮┃briefkasten-vom-wirt'
};

// Die Statistik-Kategorie erkennt man sicher an ihren Zähler-Channels.
const COUNTER_CHANNEL = /^(👥|🟢|🚀) /;

function isStatsCategory(category, channels) {
  return channels.some(channel => channel.parentId === category.id && COUNTER_CHANNEL.test(channel.name));
}

export function desiredCategoryOrder(categories, channels = []) {
  const used = new Set();
  const pick = category => { used.add(category.id); return category; };

  const known = CATEGORY_ORDER.map((entry, index) => {
    const exact = categories.find(category => !used.has(category.id) && category.name === entry.name);
    if (exact) return pick(exact);
    if (index === 0) {
      const stats = categories.find(category => !used.has(category.id) && isStatsCategory(category, channels));
      if (stats) return pick(stats);
    }
    const byKeyword = categories.find(category => !used.has(category.id) && matchesCategoryEntry(entry, category.name));
    return byKeyword ? pick(byKeyword) : null;
  }).filter(Boolean);

  const others = categories
    .filter(category => !used.has(category.id))
    .sort((a, b) => a.position - b.position);
  return [...known, ...others];
}

// Alte Namen umbenennen: "──── X ────" → "▬▬▬ X ▬▬▬" und die Taverne-Umbenennung (Kategorien + Channels).
export async function migrateCategoryNames(guild) {
  for (const category of guild.channels.cache.values()) {
    const match = category.type === ChannelType.GuildCategory ? category.name.match(/^─{3,} (.+) ─{3,}$/) : null;
    const styled = match ? `▬▬▬ ${match[1]} ▬▬▬` : category.name;
    const target = TAVERN_RENAMES[styled] || styled;
    if (target === category.name) continue;
    try {
      await category.setName(target, 'Taverne: neuer Name');
    } catch (error) {
      logger.warn('[Kategorien] Umbenennen fehlgeschlagen', { guildId: guild.id, category: category.name, error: error.message });
    }
  }
}

// Statistik-Kategorie an ihren Zähler-Channels erkennen und in AUSHANG umbenennen (egal wie sie vorher hieß).
async function renameStatsCategory(guild) {
  const target = CATEGORY_ORDER[0].name;
  const channels = [...guild.channels.cache.values()];
  if (channels.some(channel => channel.type === ChannelType.GuildCategory && channel.name === target)) return;
  const stats = channels.find(channel => channel.type === ChannelType.GuildCategory && isStatsCategory(channel, channels));
  if (!stats) return;
  await stats.setName(target, 'Taverne: Aushang').catch(error =>
    logger.warn('[Kategorien] Aushang umbenennen fehlgeschlagen', { guildId: guild.id, error: error.message }));
}

// Sortiert die Kategorien. Gibt die Namen zurück, die nicht verschoben werden konnten.
export async function sortCategories(guild) {
  await migrateCategoryNames(guild);
  await renameStatsCategory(guild);
  const allChannels = [...guild.channels.cache.values()];
  const categories = allChannels
    .filter(channel => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);
  const desired = desiredCategoryOrder(categories, allChannels);

  if (desired.every((category, index) => categories[index]?.id === category.id)) return [];

  try {
    await guild.channels.setPositions(desired.map((category, index) => ({ channel: category.id, position: index })));
    return [];
  } catch (error) {
    // Meist fehlt dem Bot bei einer Kategorie der Zugriff → einzeln verschieben, Rest trotzdem sortieren.
    logger.warn('[Kategorien] Sammel-Sortierung fehlgeschlagen, versuche einzeln', { guildId: guild.id, error: error.message });
  }

  const failed = [];
  for (const [index, category] of desired.entries()) {
    await category.setPosition(index).catch(error => {
      failed.push(category.name);
      logger.warn('[Kategorien] Konnte Kategorie nicht verschieben', { guildId: guild.id, category: category.name, error: error.message });
    });
  }
  return failed;
}

export function currentCategoryOrder(guild) {
  return [...guild.channels.cache.filter(channel => channel.type === ChannelType.GuildCategory).values()]
    .sort((a, b) => a.position - b.position)
    .map(category => category.name);
}
