import { ChannelType } from 'discord.js';
import { logger } from './logger.js';

// Gewünschte Reihenfolge der Kategorien von oben nach unten.
export const CATEGORY_ORDER = [
  '──── 📊 SERVER-STATISTIKEN 📊 ────',
  '──── 👋 MOIN 👋 ────',
  '──── 🎬 CONTENT 🎬 ────',
  '──── 🏆 LEADERBOARD 🏆 ────',
  '──── 🎭 WILLKOMMEN 🎭 ────',
  '──── 💬 COMMUNITY 💬 ────',
  '──── 🔊 VOICE 🔊 ────',
  '──── 🎮 GAMES 🎮 ────',
  '──── 📰 PATCH-NOTES 📰 ────',
  '──── 🛡️ MODERATION 🛡️ ────'
];

export function desiredCategoryOrder(categories) {
  const known = CATEGORY_ORDER
    .map(name => categories.find(category => category.name === name))
    .filter(Boolean);
  const others = categories
    .filter(category => !CATEGORY_ORDER.includes(category.name))
    .sort((a, b) => a.position - b.position);
  return [...known, ...others];
}

// Sortiert die Kategorien. Gibt die Namen zurück, die nicht verschoben werden konnten.
export async function sortCategories(guild) {
  const categories = [...guild.channels.cache.filter(channel => channel.type === ChannelType.GuildCategory).values()]
    .sort((a, b) => a.position - b.position);
  const desired = desiredCategoryOrder(categories);

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
