import { EmbedBuilder, MessageFlags } from 'discord.js';
import { verifyUser } from '../services/verificationService.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';

function verifiedNextStepEmbed(roleName) {
    return new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Verifiziert – abgeschlossen')
        .setDescription(
            'Du hast die Regeln bestätigt und die Rolle **' + roleName + '** erhalten.\n\n' +
            '➡️ **Und jetzt?**\n' +
            '**Als Nächstes: Rollen & Interessen**\n' +
            'Dort kannst du dir später die Rollen auswählen, die zu dir passen.'
        );
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

        if (result.status === 'already_verified') {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [verifiedNextStepEmbed(result.roleName || 'Verifiziert')]
            });
        }

        logger.info('User verified via button', {
            guildId: guild.id,
            userId,
            roleName: result.roleName
        });

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [verifiedNextStepEmbed(result.roleName || 'Verifiziert')]
        });

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
