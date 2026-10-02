import { logger } from '../utils/logger.js';

export const SUGGESTION_CHANNEL_NAMES = new Set(['💡┃vorschläge', 'vorschläge', 'vorschlaege']);

// Jeder Vorschlag bekommt 👍/👎 zum Abstimmen und einen eigenen Thread zum Diskutieren.
export async function handleSuggestion(message) {
  if (message.author.bot || !SUGGESTION_CHANNEL_NAMES.has(message.channel?.name)) return false;

  try {
    await message.react('👍');
    await message.react('👎');

    const preview = (message.content || 'Vorschlag').replace(/\s+/g, ' ').slice(0, 60);
    await message.startThread({ name: `💡 ${preview}`.slice(0, 100), reason: 'Diskussion zum Vorschlag' });
  } catch (error) {
    logger.warn('[Vorschläge] Could not prepare suggestion', { messageId: message.id, error: error.message });
  }
  return true;
}
