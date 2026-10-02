import {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

const CATEGORY_NAME = '🧪 Test-Channel-Varianten';
const TEST_TOPIC = 'NaafyrBot temporary channel style test';

const TEST_CHANNEL_NAMES = [
    '📜│regeln',
    '🔴│live',
    '📺│neue-videos',
    '✂️│clips-und-highlights'
];

export default {
    data: new SlashCommandBuilder()
        .setName('testchannels-create')
        .setDescription('Erstellt eine Vorschau der ausgewählten Kanalnamen')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const existing = guild.channels.cache.find(
            channel => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME
        );

        if (existing) {
            return interaction.editReply(
                '⚠️ Die Test-Kategorie existiert bereits. Nutze zuerst **/testchannels-delete**.'
            );
        }

        const category = await guild.channels.create({
            name: CATEGORY_NAME,
            type: ChannelType.GuildCategory,
            reason: 'Temporary real-name channel style preview'
        });

        let created = 0;

        try {
            for (const name of TEST_CHANNEL_NAMES) {
                await guild.channels.create({
                    name,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    topic: TEST_TOPIC,
                    reason: 'Temporary real-name channel style preview'
                });
                created += 1;
            }
        } catch (error) {
            return interaction.editReply(
                `⚠️ Vorschau erstellt, aber nur **${created}/4** Channels konnten angelegt werden. Fehler: ${error.message}`
            );
        }

        return interaction.editReply(
            '✅ **4 Vorschau-Channels erstellt.**\n' +
            '📜│regeln\n' +
            '🔴│live\n' +
            '📺│neue-videos\n' +
            '✂️│clips-und-highlights\n\n' +
            'Zum Aufräumen: **/testchannels-delete**'
        );
    }
};
