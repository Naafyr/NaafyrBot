import { customRoomName, renameRoom } from '../../../services/customVoiceCreateService.js';
import { requireOwner, voiceReply } from '../../buttons/voice/voice.js';
import { renameMessage } from '../../selectMenus/voice/voice.js';

export default {
  name: 'voice',
  async execute(interaction, client, args) {
    const record = await requireOwner(interaction, client);
    if (!record) return;

    const room = interaction.channel;
    const value = interaction.fields.getTextInputValue('value').trim();

    if (args?.[0] === 'rename') {
      const name = customRoomName(value, record.isPrivate);
      return voiceReply(interaction, renameMessage(await renameRoom(room, name), name));
    }

    if (args?.[0] === 'limit') {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        return voiceReply(interaction, '❌ Bitte eine Zahl von **0** (kein Limit) bis **99** eingeben.', 0xED4245);
      }
      await room.setUserLimit(limit, 'Limit vom Raum-Owner');
      return voiceReply(interaction, limit === 0 ? '👥 **Kein Limit** mehr.' : `👥 Limit: **${limit} Leute**.`);
    }

    return voiceReply(interaction, '❌ Unbekannte Aktion.', 0xED4245);
  }
};
