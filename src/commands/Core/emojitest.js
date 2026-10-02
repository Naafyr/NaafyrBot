import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

const METHODS = [
    {
        name: '1 Literal direkt',
        value: '🤝'
    },
    {
        name: '2 String.fromCodePoint',
        value: String.fromCodePoint(0x1F91D)
    },
    {
        name: '3 JS Unicode Escape',
        value: '\uD83E\uDD1D'
    },
    {
        name: '4 JSON.parse Escape',
        value: JSON.parse('"\\uD83E\\uDD1D"')
    },
    {
        name: '5 UTF-8 Buffer',
        value: Buffer.from([0xF0, 0x9F, 0xA4, 0x9D]).toString('utf8')
    },
    {
        name: '6 Code units',
        value: String.fromCharCode(0xD83E, 0xDD1D)
    }
];

function makeLines() {
    return METHODS.map(method => `${method.name}: ${method.value}`);
}

export default {
    data: new SlashCommandBuilder()
        .setName('emojitest')
        .setDescription('Testet verschiedene Emoji-Varianten in Discord')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const lines = makeLines();

        const embed = new EmbedBuilder()
            .setColor(0xB84DFF)
            .setTitle(`📜 Emoji-Test | Literal: 🤝`)
            .setDescription([
                '**Embed-Beschreibung:**',
                ...lines
            ].join('\n'))
            .addFields(
                {
                    name: '🤝 Literal im Feldnamen',
                    value: 'Direktes Emoji im Feldwert: 🤝'
                },
                {
                    name: `${String.fromCodePoint(0x1F91D)} fromCodePoint im Feldnamen`,
                    value: `fromCodePoint im Feldwert: ${String.fromCodePoint(0x1F91D)}`
                }
            )
            .setFooter({
                text: `Footer literal 🤝 | codePoint ${String.fromCodePoint(0x1F91D)}`
            });

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('emoji_test_literal')
                .setLabel('Literal')
                .setEmoji('🤝')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('emoji_test_codepoint')
                .setLabel('CodePoint')
                .setEmoji(String.fromCodePoint(0x1F91D))
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: [
                '**Normaler Chat-Text:**',
                ...lines,
                '',
                'Weitere direkte Emojis: 📜 👋 🚫 📢 🔞 🙅 🎙️ 🎥 📂 📌 ✅'
            ].join('\n'),
            embeds: [embed],
            components: [buttons],
            flags: MessageFlags.Ephemeral
        });
    }
};
