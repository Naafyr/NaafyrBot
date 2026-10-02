import {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

const CATEGORY_NAME = '🧪 Test-Channel-Varianten';
const TEST_TOPIC = 'NaafyrBot temporary channel style test';

const TEST_CHANNEL_NAMES = [
    // Variante 1: Klammern
    '📜【-regeln-】',
    '🔴【-live-】',
    '📺【-neue-videos-】',
    '✂️【-clips-und-highlights-】',

    // Variante 2: langer, dünner Strich
    '📜│regeln',
    '🔴│live',
    '📺│neue-videos',
    '✂️│clips-und-highlights',

    // Variante 3: kurzer/dicker Strich
    '📜┃regeln',
    '🔴┃live',
    '📺┃neue-videos',
    '✂️┃clips-und-highlights'
];

export default {
    data: new SlashCommandBuilder()
        .setName('testchannels-create')
        .setDescription('Erstellt 12 Test-Channels in drei Kanalnamen-Styles')
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
            reason: 'Temporary channel-name style test'
        });

        let created = 0;

        try {
            for (const name of TEST_CHANNEL_NAMES) {
                await guild.channels.create({
                    name,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    topic: TEST_TOPIC,
                    reason: 'Temporary channel-name style test'
                });
                created += 1;
            }
        } catch (error) {
            return interaction.editReply(
                `⚠️ Test-Kategorie erstellt, aber nur **${created}/12** Channels konnten angelegt werden. Fehler: ${error.message}`
            );
        }

        return interaction.editReply(
            '✅ **12 Test-Channels erstellt.**\n' +
            'Je 4 Beispiele für Klammern, │ und ┃.\n\n' +
            'Zum Aufräumen: **/testchannels-delete**'
        );
    }
};
