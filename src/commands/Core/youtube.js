import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { checkYouTubeForGuild } from '../../services/youtubeUploadService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';

function describe(result, { label, channelName }) {
  switch (result?.reason) {
    case 'posted':
      return `✅ ${label}: Neu gefunden und in **${channelName}** gepostet.`;
    case 'already_posted':
      return `✅ ${label}: Das aktuellste wurde bereits gepostet.`;
    case 'channel_missing':
      return `⚠️ ${label}: Der Channel **${channelName}** wurde nicht gefunden. Führe \`/setup willkommen\` aus.`;
    default:
      return `ℹ️ ${label}: Nichts gefunden.`;
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('YouTube-Benachrichtigungen verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('forcecheck')
        .setDescription('Prüft sofort auf ein neues YouTube-Video oder einen neuen Short')
    ),

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

    try {
      const result = await checkYouTubeForGuild(interaction.client, interaction.guild);

      return await InteractionHelper.safeEditReply(interaction, {
        content: [
          describe(result.video, { label: 'Video', channelName: '📺┃neue-videos' }),
          describe(result.short, { label: 'Short', channelName: '📱┃neue-shorts' })
        ].join('\n')
      });
    } catch (error) {
      logger.error('[YouTube] Force check failed', {
        guildId: interaction.guildId,
        error: error.message
      });

      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Die YouTube-Prüfung ist fehlgeschlagen.'
      });
    }
  }
};
