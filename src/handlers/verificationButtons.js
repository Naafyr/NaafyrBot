import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { verifyUser } from '../services/verificationService.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';

// "Was nun?" nach dem Verifizieren: kurze Tour + Buttons, die direkt in die Channels springen.
const NEXT_STEPS = [
    { names: ['🎭┃rollen-auswahl', 'rollen-auswahl'], emoji: '🎭', label: 'Rollen-Auswahl', text: 'Wähl deine **Games** und schalte Game-Chats & Patch Notes frei' },
    { names: ['🎂┃geburtstage', 'geburtstage'], emoji: '🎂', label: 'Geburtstag', text: 'Trag deinen **Geburtstag** ein – wir gratulieren dir' },
    { names: ['➕┃channel-erstellen', 'channel-erstellen'], emoji: '🔊', label: 'Voice-Raum', text: 'Join den Channel und du bekommst deinen **eigenen Voice-Raum**' }
];

export function verifiedNextStep(guild) {
    const steps = NEXT_STEPS
        .map(step => ({ ...step, channel: guild.channels.cache.find(channel => step.names.includes(channel.name)) }))
        .filter(step => step.channel);

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Willkommen in der Taverne! 🍻')
        .setDescription([
            'Du bist verifiziert und siehst jetzt alle Channels. 🎉',
            '',
            '## ➡️ Was nun?',
            ...steps.map(step => `${step.emoji} ${step.text} → ${step.channel}`)
        ].join('\n'));

    const components = steps.length > 0
        ? [new ActionRowBuilder().addComponents(steps.map(step =>
            new ButtonBuilder()
                .setLabel(step.label)
                .setEmoji(step.emoji)
                .setStyle(ButtonStyle.Link)
                .setURL(`https://discord.com/channels/${guild.id}/${step.channel.id}`)
        ))]
        : [];

    return { embeds: [embed], components };
}

export async function handleVerificationButton(interaction, client) {
    try {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        if (!interaction.guild) {
            return await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: 'Dieser Button kann nur auf einem Server verwendet werden.'
            });
        }

        const guild = interaction.guild;
        const userId = interaction.user.id;

        logger.debug('User clicked verify button', {
            guildId: guild.id,
            userId,
            userTag: interaction.user.tag
        });

        const result = await verifyUser(client, guild.id, userId, {
            source: 'button_click',
            moderatorId: null
        });

        if (result.status !== 'already_verified') {
            logger.info('User verified via button', {
                guildId: guild.id,
                userId,
                roleName: result.roleName
            });
        }

        await InteractionHelper.safeEditReply(interaction, verifiedNextStep(guild));

    } catch (error) {
        logger.error('Error in verification button handler', {
            error: error.message,
            guildId: interaction.guild?.id,
            userId: interaction.user.id
        });

        await handleInteractionError(
            interaction,
            error,
            { command: 'verify_button', action: 'verification' }
        );
    }
}

export default {
    customId: 'verify_user',
    execute: handleVerificationButton
};
