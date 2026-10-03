import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { RANKS, VIP_ROLE, ensurePromotionChannel, setupRoles, setupVipArea, syncRanks } from '../../../services/rankService.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { sortCategories } from '../../../utils/categoryOrder.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rollen')
    .setDescription('Ränge, Rollen-Trenner und VIP-Bereich einrichten')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Legt Tavernen-Ränge, 💎 Ehrengast, Trenner und die VIP-Kategorie an')
    ),

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    const { guild, client } = interaction;

    try {
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return await replyUserError(interaction, {
          type: ErrorTypes.PERMISSION,
          message: 'Dem Bot fehlt **Rollen verwalten**.'
        });
      }

      const { created, teamSkipped, sortError, blocked } = await setupRoles(guild);
      const vipCreated = await setupVipArea(guild);
      const promo = await ensurePromotionChannel(guild);
      await sortCategories(guild);
      await syncRanks(client, guild);

      const lines = [
        '✅ **Ränge eingerichtet** (rein optisch, ohne Berechtigungen).',
        ...RANKS.map(rank => `${rank.name}${rank.days ? ` – ab ${rank.days} Tagen + ${rank.messages} Nachrichten oder ${rank.voiceHours} Std. Voice` : ' – nach dem Verifizieren'}`),
        `${VIP_ROLE.name} – vergibst du selbst (= VIP)`,
        '',
        ...(created.length > 0 ? [`🆕 Neu angelegt: ${created.join(', ')}`] : []),
        ...(vipCreated.length > 0 ? [`💎 VIP-Bereich: ${vipCreated.join(', ')}`] : ['💎 VIP-Bereich war schon da.']),
        `🍻 Aufstiege werden in ${promo.channel} verkündet${promo.created ? ' (neu)' : ''}.`,
        ...(sortError ? ['', `❌ Sortieren fehlgeschlagen: ${sortError}`] : []),
        ...(blocked?.length ? ['', `⚠️ Diese Rollen stehen **über der Bot-Rolle** und können nicht einsortiert werden: ${blocked.join(', ')}`] : []),
        ...(teamSkipped ? ['', '⚠️ Team-Trenner fehlt: Zieh die **Bot-Rolle** in den Server-Einstellungen ganz nach oben und führ `/setup rollen` nochmal aus.'] : []),
        '',
        'ℹ️ Ränge werden alle 10 Minuten automatisch aktualisiert.'
      ];
      return await InteractionHelper.safeEditReply(interaction, { content: lines.join('\n') });
    } catch (error) {
      logger.error('[Rollen-Setup] Setup failed', { guildId: interaction.guildId, error: error.message, stack: error.stack });
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Beim Einrichten der Rollen ist ein Fehler aufgetreten.'
      });
    }
  }
};
