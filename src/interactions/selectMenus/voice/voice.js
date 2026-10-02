import { GAMES } from '../../../services/roleSelectionService.js';
import { gameRoomName, ownerRoomName, renameRoom } from '../../../services/customVoiceCreateService.js';
import { requireOwner, voiceReply } from '../../buttons/voice/voice.js';

export function renameMessage(result, name) {
  if (result === 'failed') return '❌ Umbenennen hat nicht geklappt.';
  if (result === 'delayed') return `⏳ Discord erlaubt nur 2 Namensänderungen pro 10 Minuten – **${name}** wird übernommen, sobald es wieder geht.`;
  return `✅ Raum heißt jetzt **${name}**.`;
}

export default {
  name: 'voice',
  async execute(interaction, client, args) {
    const record = await requireOwner(interaction, client);
    if (!record) return;

    const room = interaction.channel;
    const choice = interaction.values?.[0];

    if (args?.[0] === 'game') {
      const name = choice === 'reset'
        ? ownerRoomName(interaction.member, record.isPrivate)
        : GAMES[choice] ? gameRoomName(GAMES[choice], record.isPrivate) : null;
      if (!name) return voiceReply(interaction, '❌ Unbekanntes Spiel.', 0xED4245);

      return voiceReply(interaction, renameMessage(await renameRoom(room, name), name));
    }

    if (args?.[0] === 'kickpick') {
      const target = room.members.get(choice);
      if (!target) return voiceReply(interaction, 'ℹ️ Die Person ist nicht mehr im Raum.');

      await target.voice.disconnect('Vom Raum-Owner rausgeworfen').catch(() => {});
      // Darf nicht direkt wieder rein (gilt, solange der Raum existiert).
      await room.permissionOverwrites.edit(target.id, { Connect: false }, { reason: 'Vom Raum-Owner rausgeworfen' }).catch(() => {});
      return voiceReply(interaction, `👢 **${target.displayName}** wurde rausgeworfen und kann diesem Raum nicht mehr beitreten.`);
    }

    return voiceReply(interaction, '❌ Unbekannte Aktion.', 0xED4245);
  }
};
