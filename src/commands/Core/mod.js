import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { configureLogging, ensureAutoModRules, ensureModLogChannel } from '../../services/moderationSetupService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { sortCategories } from '../../utils/categoryOrder.js';

export default {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation einrichten')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Legt 📝┃mod-log an (nur Admins) und richtet Auto-Mod + Logging ein')
    ),

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    const { guild, client } = interaction;

    try {
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return await replyUserError(interaction, {
          type: ErrorTypes.PERMISSION,
          message: 'Dem Bot fehlt **Server verwalten** – ohne die Berechtigung kann er keinen Auto-Mod einrichten.'
        });
      }

      const channel = await ensureModLogChannel(guild);
      await configureLogging(client, guild.id, channel.id);
      const { results, canTimeout } = await ensureAutoModRules(guild, channel.id);
      await sortCategories(guild);

      const lines = [
        `✅ **Moderation eingerichtet** in ${channel} (nur für Admins sichtbar).`,
        '',
        '🛡️ **Auto-Mod**',
        ...results,
        '',
        '📝 **Mod-Log:** gelöschte & bearbeitete Nachrichten, Mod-Aktionen, Leaves, Rollen- & Namensänderungen, neue Accounts, Raid-Alarm.'
      ];
      if (!canTimeout) {
        lines.push('', '⚠️ Dem Bot fehlt **Mitglieder im Timeout** – bei Massen-Erwähnungen wird nur blockiert, nicht stummgeschaltet.');
      }

      return await InteractionHelper.safeEditReply(interaction, { content: lines.join('\n') });
    } catch (error) {
      logger.error('[Mod-Setup] Setup failed', { guildId: interaction.guildId, error: error.message, stack: error.stack });
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Beim Einrichten der Moderation ist ein Fehler aufgetreten.'
      });
    }
  }
};
