import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  CATEGORIES,
  ensureLeaderboardRoles,
  findLeaderboardChannel,
  flushLeaderboard,
  postLeaderboardMessages,
  syncLeaderboardRoles
} from '../../../services/leaderboardService.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rangliste')
    .setDescription('Rangliste für Chat, Voice und Fotos verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Postet die Rangliste in 🏆┃leaderboard und legt die Top-3-Rollen an')
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

      const channel = findLeaderboardChannel(guild);
      if (!channel) {
        return await replyUserError(interaction, {
          type: ErrorTypes.CONFIGURATION,
          message: 'Der Channel **🏆┃leaderboard** wurde nicht gefunden. Führe zuerst `/setup willkommen` aus.'
        });
      }

      const createdRoles = await ensureLeaderboardRoles(guild);

      // Rangliste ist nur zum Lesen.
      const verifiedRole = guild.roles.cache.find(role => role.name.toLowerCase() === 'verifiziert' && !role.managed);
      if (verifiedRole) {
        await channel.permissionOverwrites.edit(verifiedRole.id, { SendMessages: false }).catch(() => {});
      }

      await flushLeaderboard(client);
      await postLeaderboardMessages(client, guild, channel);
      await syncLeaderboardRoles(client, guild);

      const lowRoles = Object.values(CATEGORIES)
        .flatMap(config => config.roles)
        .map(name => guild.roles.cache.find(role => role.name === name))
        .filter(role => role && role.position >= botMember.roles.highest.position)
        .map(role => role.name);

      const lines = [
        '✅ **Rangliste eingerichtet** in **🏆┃leaderboard**.',
        createdRoles.length > 0 ? `Neue Rollen: ${createdRoles.join(', ')}` : 'Alle Top-3-Rollen waren schon vorhanden.',
        'Gezählt wird ab jetzt, aktualisiert wird alle 10 Minuten.'
      ];
      if (lowRoles.length > 0) {
        lines.push(`⚠️ Diese Rollen stehen über der Bot-Rolle und können nicht vergeben werden: ${lowRoles.join(', ')}`);
      }

      return await InteractionHelper.safeEditReply(interaction, { content: lines.join('\n') });
    } catch (error) {
      logger.error('[Rangliste] Setup failed', { guildId: interaction.guildId, error: error.message, stack: error.stack });
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Beim Einrichten der Rangliste ist ein Fehler aufgetreten.'
      });
    }
  }
};
