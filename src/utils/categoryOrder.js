import { ChannelType } from 'discord.js';
import { logger } from './logger.js';

// Gewünschte Reihenfolge von oben nach unten. Erkannt wird über den exakten Namen,
// sonst über ein Stichwort im Namen (falls eine Kategorie früher anders hieß).
export const CATEGORY_ORDER = [
  { name: '▬▬▬ 📊 SERVER-STATISTIKEN 📊 ▬▬▬', keyword: 'STATISTIK' },
  { name: '▬▬▬ 👋 MOIN 👋 ▬▬▬', keyword: 'MOIN' },
  { name: '▬▬▬ 🎬 CONTENT 🎬 ▬▬▬', keyword: 'CONTENT' },
  { name: '▬▬▬ 🏆 LEADERBOARD 🏆 ▬▬▬', keyword: 'LEADERBOARD' },
  { name: '▬▬▬ 🎭 WILLKOMMEN 🎭 ▬▬▬', keyword: 'WILLKOMMEN' },
  { name: '▬▬▬ 💬 COMMUNITY 💬 ▬▬▬', keyword: 'COMMUNITY' },
  { name: '▬▬▬ 🔊 VOICE 🔊 ▬▬▬', keyword: 'VOICE' },
  { name: '▬▬▬ 💎 VIP 💎 ▬▬▬', keyword: 'VIP' },
  { name: '▬▬▬ 🎮 GAMES 🎮 ▬▬▬', keyword: 'GAMES' },
  { name: '▬▬▬ 📰 PATCH-NOTES 📰 ▬▬▬', keyword: 'PATCH' },
  { name: '▬▬▬ 🛡️ MODERATION 🛡️ ▬▬▬', keyword: 'MODERATION' }
];

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
    const byKeyword = categories.find(category => !used.has(category.id) && category.name.toUpperCase().includes(entry.keyword));
    return byKeyword ? pick(byKeyword) : null;
  }).filter(Boolean);

  const others = categories
    .filter(category => !used.has(category.id))
    .sort((a, b) => a.position - b.position);
  return [...known, ...others];
}

// Alte Kategorie-Namen "──── X ────" auf den neuen Stil "▬▬▬ X ▬▬▬" umbenennen.
export async function migrateCategoryNames(guild) {
  for (const category of guild.channels.cache.values()) {
    if (category.type !== ChannelType.GuildCategory) continue;
    const match = category.name.match(/^─{3,} (.+) ─{3,}$/);
    if (!match) continue;
    try {
      await category.setName(`▬▬▬ ${match[1]} ▬▬▬`, 'Neuer Kategorie-Stil');
    } catch (error) {
      logger.warn('[Kategorien] Umbenennen fehlgeschlagen', { guildId: guild.id, category: category.name, error: error.message });
    }
  }
}

// Sortiert die Kategorien. Gibt die Namen zurück, die nicht verschoben werden konnten.
export async function sortCategories(guild) {
  await migrateCategoryNames(guild);
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
