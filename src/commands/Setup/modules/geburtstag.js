import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { buildBirthdayPanel, savePanelRef } from '../../../services/birthdayService.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';

const CHANNEL_NAME = '🎂┃geburtstage';
const COMMUNITY_CATEGORY = '──── 💬 COMMUNITY 💬 ────';

async function getOrCreateChannel(guild) {
  const existing = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText && [CHANNEL_NAME, 'geburtstage'].includes(channel.name)
  );
  const category = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildCategory && channel.name === COMMUNITY_CATEGORY
  );
  const verifiedRole = guild.roles.cache.find(role => role.name.toLowerCase() === 'verifiziert' && !role.managed);

  // Nur lesen; gratuliert wird in den Threads unter den Glückwunsch-Posts.
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.EmbedLinks] },
    ...(verifiedRole
      ? [{
        id: verifiedRole.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads]
      }]
      : [])
  ];

  if (existing) {
    if (category && existing.parentId !== category.id) await existing.setParent(category.id, { lockPermissions: false });
    await existing.permissionOverwrites.set(overwrites);
    return existing;
  }

  return guild.channels.create({
    name: CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: category?.id,
    topic: 'Geburtstage eintragen und gemeinsam feiern 🎉',
    permissionOverwrites: overwrites,
    reason: 'NaafyrBot Geburtstage'
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('geburtstag')
    .setDescription('Geburtstage verwalten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Legt 🎂┃geburtstage an und postet die Geburtstags-Box')
    ),

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    const { guild, client } = interaction;

    try {
      const channel = await getOrCreateChannel(guild);

      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      if (recent) {
        const oldPanels = recent.filter(message =>
          message.author.id === client.user.id &&
          message.components.some(row => row.components.some(component => component.customId?.startsWith('geburtstag:')))
        );
        for (const message of oldPanels.values()) {
          await message.delete().catch(() => {});
        }
      }

      const message = await channel.send(await buildBirthdayPanel(client, guild.id));
      await savePanelRef(client, guild.id, message);

      return await InteractionHelper.safeEditReply(interaction, {
        content: `✅ **Geburtstage eingerichtet** in ${channel}.\nMitglieder tragen sich über den Button ein, gratuliert wird täglich um Mitternacht.`
      });
    } catch (error) {
      logger.error('[Geburtstage] Setup failed', { guildId: interaction.guildId, error: error.message, stack: error.stack });
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Beim Einrichten der Geburtstage ist ein Fehler aufgetreten.'
      });
    }
  }
};
