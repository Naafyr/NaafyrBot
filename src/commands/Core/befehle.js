import { ApplicationCommandOptionType, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';

const CATEGORY_LABELS = {
  Core: '⭐ Allgemein',
  Setup: '⚙️ Einrichten',
  Moderation: '🛡️ Moderation',
  Logging: '📝 Logging',
  Ticket: '🎫 Tickets',
  Tools: '🧰 Tools',
  Utility: 'ℹ️ Infos',
  ServerStats: '📊 Statistik'
};

// Listet alle geladenen Befehle – immer aktuell, weil direkt aus dem Bot gelesen.
function commandLines(command) {
  const json = command.data.toJSON();
  const lock = json.default_member_permissions && json.default_member_permissions !== '0' ? ' 🔒' : '';
  if (json.type === 3) return [`🖱️ Rechtsklick auf Nachricht → **${json.name}**${lock}`];
  if (json.type === 2) return [`🖱️ Rechtsklick auf Person → **${json.name}**${lock}`];

  const subs = (json.options || []).filter(option => option.type === ApplicationCommandOptionType.Subcommand);
  if (subs.length === 0) return [`\`/${json.name}\` – ${json.description}${lock}`];
  return subs.map(sub => `\`/${json.name} ${sub.name}\` – ${sub.description}${lock}`);
}

export default {
  data: new SlashCommandBuilder()
    .setName('befehle')
    .setDescription('Zeigt alle Befehle des Bots als Liste'),

  async execute(interaction) {
    const groups = new Map();
    for (const command of interaction.client.commands.values()) {
      const label = CATEGORY_LABELS[command.category] || `📁 ${command.category || 'Sonstiges'}`;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(...commandLines(command));
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📜 Alle Befehle')
      .setFooter({ text: '🔒 = nur für Admins/Mods' });
    for (const [label, lines] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      let value = '';
      for (const line of lines.sort()) {
        if ((value + line).length > 1000) { embed.addFields({ name: label, value }); value = ''; }
        value += `${line}\n`;
      }
      if (value) embed.addFields({ name: label, value });
    }

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
