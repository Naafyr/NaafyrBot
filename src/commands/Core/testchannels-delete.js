import {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

const CATEGORY_NAME = '🧪 Test-Channel-Varianten';
const TEST_TOPIC = 'NaafyrBot temporary channel style test';

export default {
    data: new SlashCommandBuilder()
        .setName('testchannels-delete')
        .setDescription('Löscht die temporären Test-Channels für Kanalnamen-Styles')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const category = guild.channels.cache.find(
            channel => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME
        );

        if (!category) {
            return interaction.editReply('ℹ️ Es gibt aktuell keine Test-Kategorie zum Löschen.');
        }

        const children = guild.channels.cache.filter(
            channel => channel.parentId === category.id
        );

        let deleted = 0;

        for (const channel of children.values()) {
            if (channel.type !== ChannelType.GuildText || channel.topic !== TEST_TOPIC) {
                continue;
            }

            await channel.delete('Remove temporary channel-name style test');
            deleted += 1;
        }

        const remainingChildren = guild.channels.cache.filter(
            channel => channel.parentId === category.id
        );

        if (remainingChildren.size === 0) {
            await category.delete('Remove temporary channel-name style test category');
        }

        return interaction.editReply(
            `✅ **${deleted} Test-Channels gelöscht.**` +
            (remainingChildren.size === 0 ? '\nDie Test-Kategorie wurde ebenfalls entfernt.' : '')
        );
    }
};
