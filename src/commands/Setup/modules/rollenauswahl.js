import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  GAMES,
  buildGamesButtons,
  buildGamesEmbed,
  ensureGameChannels,
  buildNotifyButtons,
  buildNotifyEmbed,
  ensureGameRoles,
  ensureNotifyRoles,
  findGameRole,
  findRoleSelectionChannel
} from '../../../services/roleSelectionService.js';
import { checkPatchNotes } from '../../../services/patchNotesService.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { sortCategories } from '../../../utils/categoryOrder.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rollenauswahl')
    .setDescription('Rollen-Auswahl verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Postet die Game-Auswahl in 🎭┃rollen-auswahl und legt die Rollen an')
    ),

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

    const { guild, client } = interaction;

    try {
      const botMember = guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return await replyUserError(interaction, {
          type: ErrorTypes.PERMISSION,
          message: 'Dem Bot fehlt die Berechtigung **Rollen verwalten**.'
        });
      }

      const channel = findRoleSelectionChannel(guild);
      if (!channel) {
        return await replyUserError(interaction, {
          type: ErrorTypes.CONFIGURATION,
          message: 'Der Channel **🎭┃rollen-auswahl** wurde nicht gefunden. Führe zuerst `/setup willkommen` aus.'
        });
      }

      const createdRoles = await ensureGameRoles(guild);
      const createdChannels = await ensureGameChannels(guild);
      const notifyRoles = await ensureNotifyRoles(guild);

      // Auswahl-Channel ist nur zum Klicken, nicht zum Schreiben.
      const verifiedRole = guild.roles.cache.find(role => role.name.toLowerCase() === 'verifiziert' && !role.managed);
      if (verifiedRole) {
        await channel.permissionOverwrites.edit(verifiedRole.id, { SendMessages: false }).catch(() => {});
      }

      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (recent) {
        const oldPanels = recent.filter(message =>
          message.author.id === client.user.id &&
          message.components.some(row => row.components.some(component => component.customId?.startsWith('rolle:')))
        );
        for (const message of oldPanels.values()) {
          await message.delete().catch(() => {});
        }
      }

      await channel.send({ embeds: [buildGamesEmbed()], components: buildGamesButtons() });
      await channel.send({ embeds: [buildNotifyEmbed()], components: buildNotifyButtons() });

      const blocked = [...Object.values(GAMES).map(game => findGameRole(guild, game)), ...notifyRoles]
        .filter(role => role && role.position >= botMember.roles.highest.position)
        .map(role => role.name);

      const lines = [
        '✅ **Rollen-Auswahl eingerichtet** in **🎭┃rollen-auswahl**.',
        createdRoles.length > 0 ? `Neue Rollen: ${createdRoles.join(', ')}` : 'Alle Game-Rollen waren schon vorhanden.',
        `Game-Chats & Patch-Notes-Channels: ${createdChannels} neu angelegt, sichtbar nur mit der jeweiligen Rolle.`,
        '📰 Die neuesten Patch Notes werden gerade gepostet, danach wird alle 30 Minuten geprüft.',
        '🔔 Benachrichtigungen: **Keine Live-Pings** blendet 🔴┃live aus, **Keine Video-Pings** blendet 📺┃neue-videos und 📱┃neue-shorts aus.'
      ];
      if (!botMember.permissions.has(PermissionFlagsBits.MentionEveryone)) {
        lines.push('⚠️ Dem Bot fehlt **@everyone erwähnen** – ohne die Berechtigung kommen keine Stream-Pings an.');
      }
      if (blocked.length > 0) {
        lines.push(`⚠️ Diese Rollen stehen über der Bot-Rolle und können nicht vergeben werden: ${blocked.join(', ')}`);
      }

      await sortCategories(guild);
      await InteractionHelper.safeEditReply(interaction, { content: lines.join('\n') });

      checkPatchNotes(client).catch(error => {
        logger.error('[Rollen-Auswahl] Initial patch notes check failed', { error: error.message });
      });
      return;
    } catch (error) {
      logger.error('[Rollen-Auswahl] Setup failed', { guildId: interaction.guildId, error: error.message, stack: error.stack });
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Beim Einrichten der Rollen-Auswahl ist ein Fehler aufgetreten.'
      });
    }
  }
};
