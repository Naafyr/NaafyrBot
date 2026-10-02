import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { removeBirthday } from '../../../services/birthdayService.js';

// geburtstag:set öffnet das Pop-up, geburtstag:remove löscht den Eintrag.
export default {
  name: 'geburtstag',
  async execute(interaction, client, args) {
    if (args?.[0] === 'remove') {
      const removed = await removeBirthday(client, interaction.guild, interaction.user.id);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(removed ? 0x99AAB5 : 0xFEE75C)
          .setDescription(removed ? '🗑️ Dein Geburtstag wurde entfernt.' : 'ℹ️ Du hast noch keinen Geburtstag eingetragen.')],
        flags: MessageFlags.Ephemeral
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('geburtstag')
      .setTitle('🎂 Geburtstag eintragen')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('tag')
            .setLabel('Tag (1–31)')
            .setPlaceholder('z. B. 14')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(2)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('monat')
            .setLabel('Monat (1–12)')
            .setPlaceholder('z. B. 3')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(2)
            .setRequired(true)
        )
      );

    return interaction.showModal(modal);
  }
};
