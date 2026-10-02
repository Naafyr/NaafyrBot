import { PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { loadCommands, registerCommands } from '../../handlers/loaders/commandLoader.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('refresh')
        .setDescription('Lädt Bot-Commands neu und synchronisiert sie mit Discord')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({
                content: '❌ Dieser Befehl ist nur für Administratoren.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await loadCommands(interaction.client, { bustCache: true });
            await registerCommands(interaction.client, {
                clientId: interaction.client.config.bot.clientId
            });

            await interaction.editReply(
                '✅ **Bot aktualisiert.** Commands wurden neu geladen und erneut mit Discord synchronisiert.\n' +
                'Falls Discord einen alten Slash-Command noch cached, kann es kurz dauern, bis die Anzeige aktualisiert ist.'
            );

            logger.info('[Refresh] Commands force-refreshed from Discord', {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                commandCount: interaction.client.commands.size
            });
        } catch (error) {
            logger.error('[Refresh] Force refresh failed', {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                error: error.message,
                stack: error.stack
            });

            await interaction.editReply(
                '❌ Aktualisierung fehlgeschlagen. Schau bitte in die Railway-Logs; der Bot selbst bleibt online.'
            );
        }
    }
};
