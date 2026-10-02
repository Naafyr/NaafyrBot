import { logger } from '../utils/logger.js';
import { handleCustomVoiceCreate } from '../services/customVoiceCreateService.js';

export default {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        if (newState.member?.user.bot) return;

        try {
            await handleCustomVoiceCreate(oldState, newState);
        } catch (error) {
            logger.error(`Error in voiceStateUpdate for guild ${newState.guild.id}:`, error);
        }
    }
};
