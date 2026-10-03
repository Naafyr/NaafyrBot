import { AttachmentBuilder } from 'discord.js';
import { pendingRestores } from '../../../commands/Core/backup.js';
import { createBackup, restoreBackup } from '../../../services/backupService.js';
import { logger } from '../../../utils/logger.js';

export default {
  name: 'backup',
  async execute(interaction, client, args) {
    const pending = pendingRestores.get(interaction.user.id);

    if (args?.[0] === 'cancel') {
      pendingRestores.delete(interaction.user.id);
      return interaction.update({ content: '✖️ Abgebrochen – nichts wurde geändert.', components: [] });
    }

    // Wiederherstellen darf nur der Server-Besitzer.
    if (interaction.user.id !== interaction.guild?.ownerId) {
      return interaction.reply({ content: '🔒 Nur der Server-Besitzer kann Backups einspielen.', ephemeral: true });
    }
    if (!pending || pending.expiresAt < Date.now()) {
      pendingRestores.delete(interaction.user.id);
      return interaction.update({ content: '⌛ Zu spät – bitte `/backup laden` nochmal ausführen.', components: [] });
    }

    await interaction.update({ content: '♻️ Stelle wieder her … (sichere vorher den jetzigen Stand)', components: [] });
    pendingRestores.delete(interaction.user.id);

    try {
      // Sicherheitsnetz: jetzigen Stand vorher per DM.
      const before = await createBackup();
      await interaction.user.send({
        content: '💾 Stand **vor** der Wiederherstellung (falls du zurück willst):',
        files: [new AttachmentBuilder(before.buffer, { name: `backup_vor_wiederherstellung_${Date.now()}.json.gz` })]
      }).catch(() => {});

      const result = await restoreBackup(pending.data);
      logger.info('[Backup] Wiederhergestellt', { userId: interaction.user.id, ...result });
      return interaction.editReply({
        content: [
          `✅ **Wiederhergestellt:** ${result.tableCount} Tabellen, ${result.rowCount} Einträge.`,
          ...(result.skipped.length ? [`ℹ️ Übersprungen (gibt es nicht mehr): ${result.skipped.join(', ')}`] : []),
          '🔄 Starte den Bot auf Railway einmal neu, damit er alles frisch einliest.'
        ].join('\n')
      });
    } catch (error) {
      logger.error('[Backup] Wiederherstellung fehlgeschlagen', { error: error.message });
      return interaction.editReply({ content: `❌ Fehlgeschlagen, es wurde **nichts** geändert: ${error.message}` });
    }
  }
};
