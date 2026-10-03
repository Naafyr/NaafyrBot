import { gzipSync } from 'node:zlib';
import { AttachmentBuilder, ChannelType } from 'discord.js';
import { pgDb } from '../utils/database.js';
import { BACKUP_CHANNEL_NAME } from './moderationSetupService.js';
import { logger } from '../utils/logger.js';

// Komplette Datenbank als JSON (gezippt). Klein genug für Discord (~10 MB Limit).
export async function createBackup() {
  const pool = pgDb.pool;
  if (!pool) throw new Error('Datenbank nicht verbunden');
  const { rows: tables } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const data = { createdAt: new Date().toISOString(), tables: {} };
  for (const { table_name: name } of tables) {
    // Name kommt aus dem Systemkatalog, trotzdem sauber quoten.
    const { rows } = await pool.query(`SELECT * FROM "${name.replace(/"/g, '""')}"`);
    data.tables[name] = rows;
  }
  const rowCount = Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0);
  return { buffer: gzipSync(JSON.stringify(data)), tableCount: tables.length, rowCount };
}

function stamp(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' })
    .format(date).replace(' ', '_').replace(':', '-');
}

// 4x am Tag (Cron): in jeden Server mit 💾┃backups eine Sicherung posten.
export async function runBackups(client) {
  if (!client?.isReady?.()) return;
  const channels = client.guilds.cache
    .map(guild => guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === BACKUP_CHANNEL_NAME))
    .filter(Boolean);
  if (channels.length === 0) return;

  const { buffer, tableCount, rowCount } = await createBackup();
  const sizeKb = Math.ceil(buffer.length / 1024);
  for (const channel of channels) {
    await channel.send({
      content: `💾 Sicherung: **${tableCount} Tabellen**, ${rowCount} Einträge, ${sizeKb} KB`,
      files: [new AttachmentBuilder(buffer, { name: `backup_${stamp()}.json.gz` })]
    }).catch(error => logger.error('[Backup] Posten fehlgeschlagen', { guildId: channel.guild.id, error: error.message }));
  }
  logger.info('[Backup] Fertig', { tableCount, rowCount, sizeKb });
}
