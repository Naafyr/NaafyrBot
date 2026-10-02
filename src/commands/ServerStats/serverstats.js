import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { handleSetup } from './modules/serverstats_setup.js';

export default {
    data: new SlashCommandBuilder()
        .setName("serverstats")
        .setDescription("Server-Statistik verwalten")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName("setup")
                .setDescription("Erstellt die Server-Statistik automatisch")
        ),

    async execute(interaction, guildConfig, client) {
        await handleSetup(interaction, client);
    }
};
