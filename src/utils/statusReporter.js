import { ChannelType, EmbedBuilder } from 'discord.js';
import { logger } from './logger.js';

// Meldet Probleme der Social-Anbindungen (Twitch, YouTube, Clips, Patch-Notes) in 📡┃social-log.
// Pro Quelle höchstens einmal pro Stunde, damit der Channel nicht zugespammt wird.
export const SOCIAL_LOG_CHANNEL_NAME = '📡┃social-log';
const COOLDOWN_MS = 60 * 60_000;

// Cron-Tasks, die als "Social" zählen → lesbarer Name.
export const SOCIAL_TASKS = {
  twitch_live_check: '🔴 Twitch-Live',
  youtube_upload_check: '📺 YouTube',
  youtube_upload_check_final: '📺 YouTube',
  twitch_clips_check: '✂️ Twitch-Clips',
  patchnotes_check: '📰 Patch-Notes'
};

let statusClient = null;
const lastReport = new Map();

export function initStatusReporter(client) {
  statusClient = client;
}

export async function reportProblem(source, message, now = Date.now()) {
  const client = statusClient;
  if (!client?.isReady?.()) return;
  if (now - (lastReport.get(source) || 0) < COOLDOWN_MS) return;
  lastReport.set(source, now);

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`⚠️ ${source} – Problem`)
    .setDescription(String(message || 'Unbekannter Fehler').slice(0, 1500))
    .setFooter({ text: 'Gleiche Meldung frühestens wieder in 1 Std.' })
    .setTimestamp(now);

  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === SOCIAL_LOG_CHANNEL_NAME);
    await channel?.send({ embeds: [embed] }).catch(error =>
      logger.warn('[Status] Meldung fehlgeschlagen', { guildId: guild.id, error: error.message }));
  }
}
