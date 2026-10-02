import { EmbedBuilder, MessageFlags } from 'discord.js';
import { formatBirthday, isValidBirthday, saveBirthday } from '../../../services/birthdayService.js';

function reply(interaction, color, text) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setColor(color).setDescription(text)],
    flags: MessageFlags.Ephemeral
  });
}

export default {
  name: 'geburtstag',
  async execute(interaction, client) {
    const day = Number(interaction.fields.getTextInputValue('tag').trim());
    const month = Number(interaction.fields.getTextInputValue('monat').trim());

    if (!isValidBirthday(day, month)) {
      return reply(interaction, 0xED4245, '❌ Das Datum gibt es nicht. Bitte gib Tag und Monat als Zahl ein, z. B. **14** und **3**.');
    }

    const ok = await saveBirthday(client, interaction.guild, interaction.user.id, day, month);
    if (!ok) {
      return reply(interaction, 0xED4245, '❌ Speichern hat nicht geklappt. Bitte versuch es später nochmal.');
    }

    return reply(interaction, 0x57F287, `🎂 Gespeichert: **${formatBirthday(day, month)}**. Wir gratulieren dir an deinem Tag! 🎉`);
  }
};
