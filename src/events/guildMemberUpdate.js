import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { GAMES, NOTIFY_OPTIONS } from '../services/roleSelectionService.js';
import { CATEGORIES as LEADERBOARD_CATEGORIES } from '../services/leaderboardService.js';
import { logger } from '../utils/logger.js';

// Rollen, die der Bot oder die Mitglieder selbst per Button vergeben → würden den Mod-Log nur zuspammen.
const SELF_SERVICE_ROLES = new Set([
  'verifiziert',
  ...Object.values(GAMES).flatMap(game => [game.name, ...game.aliases]),
  ...Object.values(NOTIFY_OPTIONS).map(option => option.name),
  ...Object.values(LEADERBOARD_CATEGORIES).flatMap(category => category.roles)
].map(name => name.toLowerCase()));

function isLoggedRole(role) {
  return !role.managed && !SELF_SERVICE_ROLES.has(role.name.toLowerCase());
}

export default {
  name: Events.GuildMemberUpdate,
  once: false,

  async execute(oldMember, newMember) {
    try {
      if (!newMember.guild) return;

      if (oldMember.nickname !== newMember.nickname) {
        await logEvent({
          client: newMember.client,
          guildId: newMember.guild.id,
          eventType: EVENT_TYPES.MEMBER_NAME_CHANGE,
          data: {
            title: '🏷️ Nickname geändert',
            lines: [
              `**User:** ${newMember.user.toString()} (${newMember.user.tag})`,
              `**ID:** \`${newMember.user.id}\``,
              `**Vorher:** ${oldMember.nickname || '*(kein Nickname)*'}`,
              `**Nachher:** ${newMember.nickname || '*(kein Nickname)*'}`,
            ],
            thumbnail: newMember.user.displayAvatarURL({ dynamic: true }),
            userId: newMember.user.id,
          }
        });
      }

      // Bei nicht gecachten Mitgliedern kennt Discord die alten Rollen nicht → nichts vergleichen.
      if (oldMember.partial) return;

      const added = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id) && isLoggedRole(role));
      const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id) && isLoggedRole(role));
      if (added.size === 0 && removed.size === 0) return;

      await logEvent({
        client: newMember.client,
        guildId: newMember.guild.id,
        eventType: 'member.rolechange',
        data: {
          title: '🎭 Rollen geändert',
          color: 0x3498DB,
          lines: [
            `**User:** ${newMember.user.toString()} (${newMember.user.tag})`,
            ...(added.size > 0 ? [`**➕ Hinzugefügt:** ${added.map(role => role.toString()).join(', ')}`] : []),
            ...(removed.size > 0 ? [`**➖ Entfernt:** ${removed.map(role => role.toString()).join(', ')}`] : []),
          ],
          thumbnail: newMember.user.displayAvatarURL({ dynamic: true }),
          userId: newMember.user.id,
        }
      });
    } catch (error) {
      logger.error('Error in guildMemberUpdate event:', error);
    }
  }
};
