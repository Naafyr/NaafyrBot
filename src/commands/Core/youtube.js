import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { checkYouTubeForGuild } from '../../services/youtubeUploadService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('YouTube-Benachrichtigungen verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('forcecheck')
        .setDescription('Prüft sofort auf ein neues YouTube-Video')
    ),

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

    try {
      const result = await checkYouTubeForGuild(interaction.client, interaction.guild);

      if (result.posted) {
        return await InteractionHelper.safeEditReply(interaction, {
          content: '✅ Neues Video gefunden und in **📺┃neue-videos** gepostet.'
        });
      }

      if (result.reason === 'already_posted') {
        return await InteractionHelper.safeEditReply(interaction, {
          content: '✅ Geprüft. Das aktuellste Video wurde bereits gepostet.'
        });
      }

      if (result.reason === 'channel_missing') {
        return await replyUserError(interaction, {
          type: ErrorTypes.CONFIGURATION,
          message: 'Der Channel **📺┃neue-videos** wurde nicht gefunden.'
        });
      }

      return await InteractionHelper.safeEditReply(interaction, {
        content: 'ℹ️ Geprüft. Es wurde kein neues Video gefunden.'
      });
    } catch (error) {
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Die YouTube-Prüfung ist fehlgeschlagen.'
      });
    }
  }
};
