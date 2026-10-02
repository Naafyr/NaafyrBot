import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  configureLogging,
  ensureAutoModRules,
  ensureModLogChannel,
  ensureTestChannel,
  removeDiscordDefaults
} from '../../services/moderationSetupService.js';
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
      const testChannel = await ensureTestChannel(guild, channel);

      // Den Channel, in dem der Command gerade läuft, nicht löschen (sonst geht die Antwort ins Leere).
      const removed = await removeDiscordDefaults(guild, { keepChannelId: interaction.channelId });
      const keptCurrent = guild.channels.cache.get(interaction.channelId)?.parent
        && ['textkanäle', 'text channels'].includes(guild.channels.cache.get(interaction.channelId).parent.name.toLowerCase());

      const notSorted = await sortCategories(guild);

      const lines = [
        `✅ **Moderation eingerichtet** in ${channel} (nur für Admins sichtbar).`,
        `🧪 Dein Test-Channel: ${testChannel.channel}${testChannel.created ? ' (neu)' : ''}`,
        ...(removed.length > 0 ? [`🗑️ Discord-Standard entfernt: ${removed.join(', ')}`] : []),
        ...(keptCurrent ? ['ℹ️ Den Channel, in dem du gerade bist, habe ich nicht gelöscht. Führ `/mod setup` nochmal in 🧪┃test aus, dann ist er weg.'] : []),
        ...(notSorted.length > 0 ? [`⚠️ Diese Kategorien konnte ich nicht verschieben (Bot hat dort keinen Zugriff): ${notSorted.join(', ')}`] : []),
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
