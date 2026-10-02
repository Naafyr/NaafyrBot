import { EmbedBuilder, MessageFlags } from 'discord.js';
import { GAMES, findGameRole } from '../../../services/roleSelectionService.js';
import { logger } from '../../../utils/logger.js';

function reply(interaction, color, text) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setColor(color).setDescription(text)],
    flags: MessageFlags.Ephemeral
  });
}

// Rollen-Auswahl: Klick gibt die Rolle, erneuter Klick nimmt sie wieder weg.
export default {
  name: 'rolle',
  async execute(interaction, client, args) {
    const game = GAMES[args?.[0]];
    const role = game ? findGameRole(interaction.guild, game) : null;

    if (!role) {
      return reply(interaction, 0xED4245, '❌ Diese Rolle gibt es gerade nicht. Bitte sag einem Admin Bescheid.');
    }

    const member = interaction.member;

    try {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Rollen-Auswahl');
        return reply(interaction, 0x99AAB5, `➖ ${game.emoji} **${game.name}** wurde entfernt.`);
      }

      await member.roles.add(role, 'Rollen-Auswahl');
      return reply(interaction, 0x57F287, `✅ ${game.emoji} **${game.name}** ist jetzt deine Rolle. Viel Spaß beim Zocken! 🎮`);
    } catch (error) {
      logger.error('[Rollen-Auswahl] Role toggle failed', {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        role: role.name,
        error: error.message
      });
      return reply(interaction, 0xED4245, '❌ Das hat nicht geklappt. Wahrscheinlich steht die Bot-Rolle unter dieser Rolle.');
    }
  }
};
