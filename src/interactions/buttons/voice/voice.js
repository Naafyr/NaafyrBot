import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import {
  getRoomRecord,
  refreshControlPanel,
  toggleRoomAccess,
  toggleRoomVisibility
} from '../../../services/customVoiceCreateService.js';

export function voiceReply(interaction, text, color = 0x5865F2) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(color).setDescription(text)], flags: MessageFlags.Ephemeral });
}

// Gibt den Raum-Eintrag zurück, wenn der Klickende der Owner ist – sonst Hinweis.
export async function requireOwner(interaction, client) {
  const record = await getRoomRecord(client, interaction.guildId, interaction.channelId);
  if (!record) {
    await voiceReply(interaction, '❌ Dieser Raum wird nicht mehr vom Bot verwaltet.', 0xED4245);
    return null;
  }
  if (record.ownerId !== interaction.user.id) {
    await voiceReply(interaction, `🔒 Nur der Owner <@${record.ownerId}> kann den Raum steuern.`, 0xED4245);
    return null;
  }
  return record;
}

function textModal(id, title, label, placeholder, maxLength) {
  return new ModalBuilder()
    .setCustomId(`voice:${id}`)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('value')
        .setLabel(label)
        .setPlaceholder(placeholder)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(maxLength)
        .setRequired(true)
    ));
}

export default {
  name: 'voice',
  async execute(interaction, client, args) {
    const record = await requireOwner(interaction, client);
    if (!record) return;

    const room = interaction.channel;

    switch (args?.[0]) {
      case 'rename':
        return interaction.showModal(textModal('rename', '✏️ Raum umbenennen', 'Neuer Name', 'z. B. Chill-Runde', 40));

      case 'limit':
        return interaction.showModal(textModal('limit', '👥 Limit setzen', 'Max. Leute (0 = kein Limit)', 'z. B. 4', 2));

      // 'lock' = Button aus älteren Boxen
      case 'lock':
      case 'access': {
        const closed = await toggleRoomAccess(client, room);
        await refreshControlPanel(client, room);
        return voiceReply(interaction, closed
          ? '🔒 **Raum ist jetzt privat.** Wer rein will, wartet im ⏳ Wartebereich darunter.'
          : '🔓 **Raum ist jetzt öffentlich.** Alle können beitreten, Wartende wurden reingeholt.');
      }

      case 'visibility': {
        const hidden = await toggleRoomVisibility(room);
        await refreshControlPanel(client, room);
        return voiceReply(interaction, hidden
          ? '🙈 **Raum ist jetzt unsichtbar.** Wer drin ist, bleibt drin – alle anderen sehen ihn nicht mehr.'
          : '👁️ **Raum ist wieder sichtbar.**');
      }

      case 'kick': {
        const others = room.members.filter(member => member.id !== interaction.user.id && !member.user.bot);
        if (others.size === 0) return voiceReply(interaction, 'ℹ️ Außer dir ist niemand im Raum.');

        const select = new StringSelectMenuBuilder()
          .setCustomId('voice:kickpick')
          .setPlaceholder('Wen willst du rauswerfen?')
          .addOptions(others.first(25).map(member => ({ label: member.displayName.slice(0, 100), value: member.id, emoji: '👢' })));

        return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
      }

      default:
        return voiceReply(interaction, '❌ Unbekannte Aktion.', 0xED4245);
    }
  }
};
