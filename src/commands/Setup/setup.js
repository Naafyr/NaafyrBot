import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import newwelcome from './modules/newwelcome.js';
import rollenauswahl from './modules/rollenauswahl.js';
import rangliste from './modules/rangliste.js';
import geburtstag from './modules/geburtstag.js';
import mod from './modules/mod.js';
import rollen from './modules/rollen.js';
import { handleSetup as serverstatsSetup } from '../ServerStats/modules/serverstats_setup.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

// Reihenfolge = Reihenfolge bei "/setup alles" (Willkommen zuerst, weil es die Channels anlegt).
const STEPS = [
  { name: 'willkommen', label: '👋 Willkommen & Channels', description: 'Kategorien, Channels, Regeln & Verifizierung', run: (i) => newwelcome.execute(i) },
  { name: 'statistik', label: '📊 Server-Statistik', description: 'Zähler-Channels ganz oben', run: (i, client) => serverstatsSetup(i, client) },
  { name: 'rollenauswahl', label: '🎭 Rollen-Auswahl', description: 'Game- und Content-Panels', run: (i) => rollenauswahl.execute(i) },
  { name: 'rangliste', label: '🏆 Rangliste', description: 'Leaderboard + Top-3-Rollen', run: (i) => rangliste.execute(i) },
  { name: 'geburtstag', label: '🎂 Geburtstage', description: 'Geburtstags-Channel + Liste', run: (i) => geburtstag.execute(i) },
  { name: 'moderation', label: '🛡️ Moderation', description: 'Mod-Log, Auto-Mod, Test, Backups, AFK', run: (i) => mod.execute(i) },
  { name: 'rollen', label: '🍺 Ränge & VIP', description: 'Ränge, Rollen-Trenner, VIP-Bereich', run: (i) => rollen.execute(i) }
];

const builder = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Server einrichten')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand(sub => sub.setName('alles').setDescription('Alles auf einmal in der richtigen Reihenfolge einrichten'));
for (const step of STEPS) {
  builder.addSubcommand(sub => sub.setName(step.name).setDescription(`${step.label} – ${step.description}`.slice(0, 100)));
}

// Fehler-Antworten sind rote Embeds → als "❌ <Beschreibung>" zusammenfassen.
function summarize(payload) {
  if (!payload || typeof payload === 'string') return payload || '';
  const embed = payload.embeds?.[0];
  const data = embed?.toJSON ? embed.toJSON() : embed;
  if (payload.content) return payload.content;
  const isError = data?.color === 0xED4245 || /denied|wrong|error|fehler/i.test(data?.title || '');
  return isError ? `❌ ${data?.description || data?.title}` : (data?.title || data?.description || '');
}

// Fängt die Antworten eines Schritts ab, damit "/setup alles" eine einzige Übersicht zeigt.
function captureInteraction(interaction, collected) {
  const capture = async payload => { collected.push(summarize(payload)); return null; };
  return Object.create(interaction, {
    deferred: { value: true, writable: true },
    replied: { value: false, writable: true },
    deferReply: { value: async () => null },
    reply: { value: capture },
    editReply: { value: capture },
    followUp: { value: capture }
  });
}

export default {
  data: builder,

  async execute(interaction, guildConfig, client) {
    const sub = interaction.options.getSubcommand();
    const step = STEPS.find(entry => entry.name === sub);
    if (step) return step.run(interaction, client);

    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    const lines = ['⚙️ **Setup – alles**', ''];
    for (const entry of STEPS) {
      const collected = [];
      try {
        await entry.run(captureInteraction(interaction, collected), client);
        const first = collected.filter(Boolean).pop()?.split('\n').find(line => line.trim()) || 'fertig';
        const failed = first.startsWith('❌');
        lines.push(`${failed ? '❌' : '✅'} **${entry.label}:** ${first.replace(/^[✅❌⚠️\s]+/u, '').slice(0, 150)}`);
      } catch (error) {
        logger.error('[Setup] Schritt fehlgeschlagen', { step: entry.name, error: error.message });
        lines.push(`❌ **${entry.label}:** ${error.message}`);
      }
    }
    lines.push('', 'ℹ️ Einzelne Teile kannst du mit `/setup <teil>` nochmal ausführen und siehst dann alle Details.');
    return InteractionHelper.safeEditReply(interaction, { content: lines.join('\n').slice(0, 2000) });
  }
};
