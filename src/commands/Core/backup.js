import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import axios from 'axios';
import { createBackup, readBackup } from '../../services/backupService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

// Hochgeladene Backups warten hier 5 Min. auf die Bestätigung per Button.
export const pendingRestores = new Map();
const PENDING_MS = 5 * 60_000;

export default {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Datenbank sichern oder wiederherstellen')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub => sub.setName('jetzt').setDescription('Sofort ein Backup erstellen (kommt hier als Datei)'))
    .addSubcommand(sub => sub
      .setName('laden')
      .setDescription('Backup-Datei wieder einspielen (überschreibt die aktuellen Daten)')
      .addAttachmentOption(option => option.setName('datei').setDescription('backup_….json.gz aus 💾┃backups oder deiner DM').setRequired(true))),

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'jetzt') {
        const { buffer, tableCount, rowCount } = await createBackup();
        return await InteractionHelper.safeEditReply(interaction, {
          content: `💾 Backup: **${tableCount} Tabellen**, ${rowCount} Einträge`,
          files: [new AttachmentBuilder(buffer, { name: `backup_${Date.now()}.json.gz` })]
        });
      }

      const file = interaction.options.getAttachment('datei');
      if (!file.name.endsWith('.json.gz')) {
        return await InteractionHelper.safeEditReply(interaction, { content: '❌ Bitte eine **.json.gz**-Datei vom Bot hochladen.' });
      }
      const response = await axios.get(file.url, { responseType: 'arraybuffer', timeout: 30_000 });
      const backup = readBackup(Buffer.from(response.data));

      pendingRestores.set(interaction.user.id, { data: backup.data, expiresAt: Date.now() + PENDING_MS });
      const created = backup.createdAt ? `<t:${Math.floor(Date.parse(backup.createdAt) / 1000)}:f>` : 'unbekannt';

      return await InteractionHelper.safeEditReply(interaction, {
        content: [
          '⚠️ **Backup wiederherstellen?**',
          `📅 Erstellt: ${created}`,
          `📦 ${backup.tableCount} Tabellen, ${backup.rowCount} Einträge`,
          '',
          'Alle **aktuellen** Daten (Ränge-Zählung, Geburtstage, Einstellungen …) werden durch das Backup **ersetzt**.',
          'Vorher schickt dir der Bot automatisch ein Backup vom jetzigen Stand per DM.',
          '',
          'Bestätigen innerhalb von 5 Minuten:'
        ].join('\n'),
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('backup:confirm').setLabel('Ja, wiederherstellen').setEmoji('♻️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('backup:cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
        )]
      });
    } catch (error) {
      logger.error('[Backup] Befehl fehlgeschlagen', { sub, error: error.message });
      return InteractionHelper.safeEditReply(interaction, { content: `❌ Fehler: ${error.message}` });
    }
  }
};
