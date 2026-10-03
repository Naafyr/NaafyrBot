import { EmbedBuilder } from 'discord.js';
import { getWelcomeConfig } from './database.js';
import { logger } from './logger.js';

// Einmalig: alte Willkommens-Nachrichten "🐺 Rudel #3" → "🧭 Reisender #3" (Taverne statt Rudel).
// Erkennt auch Varianten ohne Fett/Emoji, z. B. "Rudel #3", "🐺 Rudelmitglied #3".
const OLD = /(?:🐺[ \t]*)?(\*\*)?[ \t]*Rudel(?:mitglied)?[ \t]*#[ \t]*(\d+)[ \t]*(\*\*)?/gu;
const NEW = '🧭 **Reisender #$2**';
const fix = text => (typeof text === 'string' ? text.replace(OLD, NEW) : text);

export async function migrateOldWelcomeMessages(client) {
  for (const guild of client.guilds.cache.values()) {
    const doneKey = `guild:${guild.id}:migration:rudel2`;
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
          const embeds = message.embeds || [];
          const changedEmbeds = embeds.map(embed => {
            const builder = EmbedBuilder.from(embed);
            if (embed.description) builder.setDescription(fix(embed.description));
            if (embed.title) builder.setTitle(fix(embed.title));
            return builder;
          });
          const newContent = fix(message.content);
          const changed = newContent !== message.content
            || embeds.some((embed, i) => changedEmbeds[i].data.description !== (embed.description ?? undefined) || changedEmbeds[i].data.title !== (embed.title ?? undefined));
          if (!changed) continue;
          await message.edit({ ...(message.content ? { content: newContent } : {}), embeds: changedEmbeds }).then(() => edited++).catch(() => {});
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
