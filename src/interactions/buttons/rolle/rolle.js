import { EmbedBuilder, MessageFlags } from 'discord.js';
import { GAMES, NOTIFY_OPTIONS, findGameRole } from '../../../services/roleSelectionService.js';
import { logger } from '../../../utils/logger.js';

function reply(interaction, color, text) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setColor(color).setDescription(text)],
    flags: MessageFlags.Ephemeral
  });
}

// Rollen-Auswahl: Klick gibt die Rolle, erneuter Klick nimmt sie wieder weg.
// Bei den Benachrichtigungen ist es umgekehrt: Rolle = Pings aus.
export default {
  name: 'rolle',
  async execute(interaction, client, args) {
    const key = args?.[0];
    const notify = NOTIFY_OPTIONS[key];
    const option = notify || GAMES[key];
    const role = option ? findGameRole(interaction.guild, option) : null;

    if (!role) {
      return reply(interaction, 0xED4245, '❌ Diese Rolle gibt es gerade nicht. Bitte sag einem Admin Bescheid.');
    }

    const member = interaction.member;

    try {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Rollen-Auswahl');
        return notify
          ? reply(interaction, 0x57F287, notify.onText)
          : reply(interaction, 0x99AAB5, `➖ ${option.emoji} **${option.name}** wurde entfernt.`);
      }

      await member.roles.add(role, 'Rollen-Auswahl');
      return notify
        ? reply(interaction, 0x99AAB5, `${notify.offText}\nNochmal klicken zum Rückgängig machen.`)
        : reply(interaction, 0x57F287, `✅ ${option.emoji} **${option.name}** ist jetzt deine Rolle. Viel Spaß beim Zocken! 🎮`);
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
