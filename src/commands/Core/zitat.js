import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { logger } from '../../utils/logger.js';

export const QUOTE_COMMAND_NAME = 'Als Zitat speichern';
const QUOTE_CHANNEL_NAMES = new Set(['💭┃zitate', 'zitate']);
const MAX_REMEMBERED = 500;

function savedKey(guildId) {
  return `guild:${guildId}:zitate:ids`;
}

function reply(interaction, text, color = 0x9B59B6) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(color).setDescription(text)], flags: MessageFlags.Ephemeral });
}

// Rechtsklick auf eine Nachricht → Apps → "Als Zitat speichern" → landet in 💭┃zitate.
export default {
  data: new ContextMenuCommandBuilder()
    .setName(QUOTE_COMMAND_NAME)
    .setType(ApplicationCommandType.Message)
    .setDMPermission(false),

  async execute(interaction, guildConfig, client) {
    const message = interaction.targetMessage;
    const text = message.content?.trim();

    if (!text) {
      return reply(interaction, '❌ Nur Nachrichten mit Text können als Zitat gespeichert werden.', 0xED4245);
    }
    if (message.author.bot) {
      return reply(interaction, '❌ Bot-Nachrichten können nicht als Zitat gespeichert werden.', 0xED4245);
    }

    const channel = interaction.guild.channels.cache.find(candidate =>
      candidate.type === ChannelType.GuildText && QUOTE_CHANNEL_NAMES.has(candidate.name)
    );
    if (!channel) {
      return reply(interaction, '❌ Der Channel **💭┃zitate** wurde nicht gefunden.', 0xED4245);
    }

    const saved = (await client.db.get(savedKey(interaction.guildId))) || [];
    if (saved.includes(message.id)) {
      return reply(interaction, `ℹ️ Dieses Zitat steht schon in ${channel}.`);
    }

    const author = message.member?.displayName || message.author.username;
    const quote = text.length > 1000 ? `${text.slice(0, 1000)} …` : text;

    try {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x9B59B6)
            .setAuthor({ name: author, iconURL: message.author.displayAvatarURL() })
            .setDescription(`## „${quote}“`)
            .setFooter({ text: `💭 Gespeichert von ${interaction.member?.displayName || interaction.user.username}` })
            .setTimestamp(message.createdAt)
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Zur Nachricht').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(message.url)
          )
        ],
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      logger.error('[Zitate] Could not post quote', { guildId: interaction.guildId, error: error.message });
      return reply(interaction, '❌ Das Zitat konnte nicht gespeichert werden.', 0xED4245);
    }

    await client.db.set(savedKey(interaction.guildId), [...saved, message.id].slice(-MAX_REMEMBERED));
    return reply(interaction, `💭 Zitat von **${author}** in ${channel} gespeichert!`);
  }
};
