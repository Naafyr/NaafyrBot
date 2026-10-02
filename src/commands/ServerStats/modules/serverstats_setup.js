import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  getServerCounters,
  saveServerCounters,
  updateCounter
} from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

const COUNTER_TYPES = ['members_only', 'online', 'boosts'];

function buildVisibilityOverwrites(guild, verifiedRole) {
  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
    }
  ];

  if (verifiedRole) {
    overwrites.push({
      id: verifiedRole.id,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.Connect]
    });
  }

  return overwrites;
}

export async function handleSetup(interaction, client) {
  const guild = interaction.guild;

  try {
    await InteractionHelper.safeDefer(interaction);
  } catch (error) {
    logger.error('Failed to defer serverstats setup:', error);
    return;
  }

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return await replyUserError(interaction, {
      type: ErrorTypes.PERMISSION,
      message: 'Du brauchst **Kanäle verwalten**, um die Server-Statistik einzurichten.'
    });
  }

  try {
    const verifiedRole = guild.roles.cache.find(
      role => role.name.toLowerCase() === 'verifiziert' && !role.managed
    ) || null;

    let category = guild.channels.cache.find(
      channel => channel.type === ChannelType.GuildCategory && channel.name === '📊 Server-Statistiken'
    );

    if (!category) {
      category = await guild.channels.create({
        name: '📊 Server-Statistiken',
        type: ChannelType.GuildCategory,
        permissionOverwrites: buildVisibilityOverwrites(guild, verifiedRole),
        reason: 'NaafyrBot server statistics setup'
      });
    }

    const counters = await getServerCounters(client, guild.id);
    const nextCounters = counters.filter(counter => !COUNTER_TYPES.includes(counter.type));

    const existingByType = new Map();
    for (const counter of counters) {
      if (COUNTER_TYPES.includes(counter.type)) {
        existingByType.set(counter.type, counter);
      }
    }

    for (const type of COUNTER_TYPES) {
      let counter = existingByType.get(type);
      let channel = counter ? guild.channels.cache.get(counter.channelId) : null;

      if (!channel) {
        channel = await guild.channels.create({
          name: 'wird aktualisiert…',
          type: ChannelType.GuildVoice,
          parent: category.id,
          permissionOverwrites: buildVisibilityOverwrites(guild, verifiedRole),
          reason: 'NaafyrBot server statistics setup'
        });

        counter = {
          id: Date.now().toString() + '-' + type,
          type,
          channelId: channel.id,
          guildId: guild.id,
          createdAt: new Date().toISOString(),
          enabled: true
        };
      } else if (channel.parentId !== category.id) {
        await channel.setParent(category.id, { lockPermissions: false });
      }

      nextCounters.push(counter);
      await updateCounter(client, guild, counter);
    }

    await saveServerCounters(client, guild.id, nextCounters);

    await InteractionHelper.safeEditReply(interaction, {
      content:
        '✅ **Server-Statistik eingerichtet.**\n' +
        'Erstellt/verwendet wurden **📊 Server-Statistiken** mit:\n' +
        '👥 Mitglieder\n' +
        '🟢 Online\n' +
        '🚀 Boosts\n\n' +
        'Bots werden bei Mitglieder und Online nicht mitgezählt. Die Werte werden automatisch aktualisiert.'
    });
  } catch (error) {
    logger.error('Error setting up server statistics:', error);
    await replyUserError(interaction, {
      type: ErrorTypes.UNKNOWN,
      message: 'Beim Einrichten der Server-Statistik ist ein Fehler aufgetreten.'
    }).catch(() => {});
  }
}
