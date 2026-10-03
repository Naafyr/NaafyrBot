import { EmbedBuilder } from 'discord.js';
import { getWelcomeConfig } from './database.js';
import { logger } from './logger.js';

// Einmalig: alte Willkommens-Nachrichten "🐺 Rudel #3" → "🧭 Reisender #3" (Taverne statt Rudel).
const OLD = '🐺 **Rudel #';
const NEW = '🧭 **Reisender #';

export async function migrateOldWelcomeMessages(client) {
  for (const guild of client.guilds.cache.values()) {
    const doneKey = `guild:${guild.id}:migration:rudel`;
    try {
      if (await client.db?.get?.(doneKey)) continue;
      const channelId = (await getWelcomeConfig(client, guild.id))?.channelId;
      const channel = channelId ? guild.channels.cache.get(channelId) : null;
      if (!channel?.messages) continue;

      let before;
      let edited = 0;
      // Bis zu 1000 Nachrichten zurück durchgehen
      for (let page = 0; page < 10; page++) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (batch.size === 0) break;
        for (const message of batch.values()) {
          if (message.author.id !== client.user.id) continue;
          const embed = message.embeds?.[0];
          if (!embed?.description?.includes(OLD)) continue;
          const updated = EmbedBuilder.from(embed).setDescription(embed.description.replaceAll(OLD, NEW));
          await message.edit({ embeds: [updated, ...message.embeds.slice(1)] }).then(() => edited++).catch(() => {});
        }
        before = batch.last().id;
      }

      await client.db?.set?.(doneKey, true);
      if (edited) logger.info('[Willkommen] Alte Nachrichten umgeschrieben', { guildId: guild.id, edited });
    } catch (error) {
      logger.warn('[Willkommen] Umschreiben fehlgeschlagen', { guildId: guild.id, error: error.message });
    }
  }
}
