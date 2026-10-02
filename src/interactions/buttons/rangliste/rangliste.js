import { MessageFlags } from 'discord.js';
import { PERIODS, buildLeaderboardEmbed } from '../../../services/leaderboardService.js';

// Zeigt die gewählte Zeitspanne nur dem klickenden User.
export default {
  name: 'rangliste',
  async execute(interaction, client, args) {
    const period = PERIODS[args?.[0]] ? args[0] : 'week';

    await interaction.reply({
      embeds: [await buildLeaderboardEmbed(client, interaction.guild, period)],
      flags: MessageFlags.Ephemeral
    });
  }
};
