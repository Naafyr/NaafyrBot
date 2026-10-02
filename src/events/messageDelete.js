import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { formatLogLine } from '../utils/logging/logEmbeds.js';

const MAX_LOGGED_MESSAGE_CONTENT_LENGTH = 1024;

export default {
  name: Events.MessageDelete,
  once: false,

  async execute(message) {
    try {
      if (!message.guild) return;
      if (message.author?.bot) return;

      const metaLines = [
        formatLogLine('Channel', message.channel ? `${message.channel.name} ${message.channel.toString()}` : 'Unbekannt'),
        formatLogLine('Nachrichten-ID', `\`${message.id}\``),
        formatLogLine('Autor', message.author ? message.author.toString() : 'Unbekannt'),
        formatLogLine('Geschrieben', `<t:${Math.floor(message.createdTimestamp / 1000)}:R>`),
      ];

      let messageBody = null;
      if (message.content) {
        messageBody = message.content.length > MAX_LOGGED_MESSAGE_CONTENT_LENGTH
          ? `${message.content.substring(0, MAX_LOGGED_MESSAGE_CONTENT_LENGTH - 3)}...`
          : message.content;
      }

      if (message.attachments.size > 0) {
        metaLines.push(formatLogLine('Anhänge', String(message.attachments.size)));
      }

      await logEvent({
        client: message.client,
        guildId: message.guild.id,
        eventType: EVENT_TYPES.MESSAGE_DELETE,
        data: {
          title: '❌ Nachricht gelöscht',
          lines: metaLines,
          quoted: true,
          section: messageBody ? { title: 'Nachricht', body: messageBody || '*(leere Nachricht)*' } : null,
          userId: message.author?.id,
          channelId: message.channel.id,
        }
      });

    } catch (error) {
      logger.error('Error in messageDelete event:', error);
    }
  }
};
