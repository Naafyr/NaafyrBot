import { gunzipSync, gzipSync } from 'node:zlib';
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

// Liest eine Backup-Datei (.json.gz) und gibt eine Übersicht zurück – noch ohne etwas zu ändern.
export function readBackup(buffer) {
  const data = JSON.parse(gunzipSync(buffer).toString('utf8'));
  if (!data?.tables || typeof data.tables !== 'object') throw new Error('Keine gültige Backup-Datei');
  const rowCount = Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0);
  return { data, tableCount: Object.keys(data.tables).length, rowCount, createdAt: data.createdAt };
}

const quote = name => `"${String(name).replace(/"/g, '""')}"`;
// JSON-Spalten kommen als Objekt/Array zurück → für pg wieder als JSON-Text übergeben.
const toParam = value => (value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value);

// Spielt ein Backup ein: alles in EINER Transaktion – bei einem Fehler bleibt die Datenbank wie sie war.
export async function restoreBackup(data) {
  const pool = pgDb.pool;
  if (!pool) throw new Error('Datenbank nicht verbunden');
  const { rows: existing } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  );
  const known = new Set(existing.map(row => row.table_name));
  const tables = Object.keys(data.tables).filter(name => known.has(name));
  // JSON-Spalten immer als JSON-Text übergeben (auch Strings/Zahlen darin).
  const { rows: jsonColumns } = await pool.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('json', 'jsonb')"
  );
  const isJson = new Set(jsonColumns.map(row => `${row.table_name}.${row.column_name}`));

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (tables.length) await db.query(`TRUNCATE ${tables.map(quote).join(', ')} RESTART IDENTITY CASCADE`);
    let restored = 0;
    for (const name of tables) {
      for (const row of data.tables[name]) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        await db.query(
          `INSERT INTO ${quote(name)} (${columns.map(quote).join(', ')}) VALUES (${placeholders})`,
          columns.map(column => (isJson.has(`${name}.${column}`) && row[column] !== null
            ? JSON.stringify(row[column])
            : toParam(row[column])))
        );
        restored++;
      }
    }
    await db.query('COMMIT');
    return { tableCount: tables.length, rowCount: restored, skipped: Object.keys(data.tables).filter(name => !known.has(name)) };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
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

  // Zusätzlich per DM an die Server-Besitzer – DMs bleiben, auch wenn der Channel gelöscht wird.
  const ownerIds = new Set(channels.map(channel => channel.guild.ownerId).filter(Boolean));
  for (const ownerId of ownerIds) {
    const owner = await client.users.fetch(ownerId).catch(() => null);
    await owner?.send({
      content: `💾 Backup: **${tableCount} Tabellen**, ${rowCount} Einträge, ${sizeKb} KB`,
      files: [new AttachmentBuilder(buffer, { name: `backup_${stamp()}.json.gz` })]
    }).catch(error => logger.warn('[Backup] DM fehlgeschlagen', { ownerId, error: error.message }));
  }
  logger.info('[Backup] Fertig', { tableCount, rowCount, sizeKb });
}
