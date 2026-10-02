import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import { getColor } from '../../config/bot.js';
import { updateWelcomeConfig } from '../../utils/database.js';
import { patchGuildConfig } from '../../services/config/guildConfig.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ErrorTypes, replyUserError } from '../../utils/errorHandler.js';

const RULES_TEXT = [
    '🤝 **1. Respektvoll miteinander umgehen**\nBehandle andere Mitglieder freundlich und respektvoll. Beleidigungen, Provokationen und unnötiger Streit gehören hier nicht hin.',
    '🚫 **2. Kein Spam**\nKein unnötiges Spammen von Nachrichten, Emojis, Bildern, Sounds oder Erwähnungen.',
    '📢 **3. Keine Werbung**\nWerbung für eigene Server, Social-Media-Kanäle, Streams oder andere Inhalte ist ohne vorherige Erlaubnis nicht gestattet.',
    '🔞 **4. Keine unangemessenen Inhalte**\nExtremistische, diskriminierende, sexuelle oder anderweitig problematische Inhalte haben auf dem Server nichts verloren.',
    '🙅 **5. Andere Mitglieder nicht nerven oder bedrängen**\nRespektiere, wenn Leute gerade miteinander reden oder spielen.',
    '🎙️ **6. Rücksicht im Voice-Chat**\nKein absichtliches Schreien, Soundboard-Spam oder extrem laute Geräusche.',
    '🎥 **7. Aufnahmen nur mit Zustimmung**\nWenn Stimmen oder Gespräche aufgenommen oder veröffentlicht werden sollen, sollten die betroffenen Personen vorher Bescheid wissen.',
    '📂 **8. Nutzt die richtigen Channels**\nVersucht Inhalte in die dafür vorgesehenen Channels zu schicken.',
    '📌 **9. Discord-Regeln gelten weiterhin**\nDie Nutzungsbedingungen und Community-Richtlinien von Discord gelten selbstverständlich auch hier.'
].join('\n\n');

function findRoleGating(channel, guild) {
    const overwrites = channel.permissionOverwrites?.cache;
    if (!overwrites) return false;

    return overwrites.some(overwrite => {
        if (overwrite.id === guild.id) return false;
        if (overwrite.type !== 0) return false;
        return overwrite.allow.has(PermissionFlagsBits.ViewChannel)
            || overwrite.deny.has(PermissionFlagsBits.ViewChannel);
    });
}

async function ensureVerifiedRole(guild) {
    let role = guild.roles.cache.find(r => r.name.toLowerCase() === 'verifiziert' && !r.managed);
    if (role) return role;

    return await guild.roles.create({
        name: 'Verifiziert',
        permissions: [],
        reason: 'NaafyrBot welcome setup'
    });
}

async function ensureTextChannel(guild, name, verifiedRole, topic) {
    let channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === name);
    if (channel) return channel;

    return await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        topic,
        permissionOverwrites: [
            {
                id: guild.id,
                allow: [PermissionFlagsBits.ViewChannel],
                deny: [PermissionFlagsBits.SendMessages]
            },
            {
                id: verifiedRole.id,
                allow: [PermissionFlagsBits.ViewChannel],
                deny: [PermissionFlagsBits.SendMessages]
            }
        ],
        reason: 'NaafyrBot welcome setup'
    });
}

async function applyOnboardingVisibility(guild, verifiedRole, welcomeChannel, rulesChannel) {
    const protectedIds = new Set([welcomeChannel.id, rulesChannel.id]);

    for (const channel of guild.channels.cache.values()) {
        if (protectedIds.has(channel.id)) continue;
        if (!channel.permissionOverwrites) continue;

        const roleGated = findRoleGating(channel, guild);

        await channel.permissionOverwrites.edit(guild.id, {
            ViewChannel: false
        }, { reason: 'Hide channels until verification' });

        if (!roleGated) {
            await channel.permissionOverwrites.edit(verifiedRole.id, {
                ViewChannel: true
            }, { reason: 'Show normal channels after verification' });
        }
    }

    for (const channel of [welcomeChannel, rulesChannel]) {
        await channel.permissionOverwrites.edit(guild.id, {
            ViewChannel: true,
            SendMessages: false
        }, { reason: 'Onboarding channel visibility' });

        await channel.permissionOverwrites.edit(verifiedRole.id, {
            ViewChannel: true,
            SendMessages: false
        }, { reason: 'Onboarding channel visibility' });
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Willkommensbereich einrichten')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Erstellt Willkommen, Regeln und Verifizierung automatisch')),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) return;

        const { guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du brauchst die Berechtigung **Server verwalten**, um das Welcome-Setup zu starten.'
            });
        }

        const botMember = guild.members.me;
        const required = [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
        ];
        const missing = required.filter(permission => !botMember?.permissions.has(permission));

        if (missing.length > 0) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Mir fehlen Berechtigungen für das automatische Welcome-Setup. Ich brauche **Kanäle verwalten**, **Rollen verwalten**, **Kanäle ansehen**, **Nachrichten senden** und **Links einbetten**.'
            });
        }

        try {
            const verifiedRole = await ensureVerifiedRole(guild);

            if (verifiedRole.position >= botMember.roles.highest.position) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Die Rolle **Verifiziert** muss unter meiner höchsten Bot-Rolle stehen, damit ich sie vergeben kann.'
                });
            }

            const welcomeChannel = await ensureTextChannel(
                guild,
                'willkommen',
                verifiedRole,
                'Willkommen auf dem Server'
            );

            const rulesChannel = await ensureTextChannel(
                guild,
                'regeln',
                verifiedRole,
                'Regeln lesen und anschließend verifizieren'
            );

            await applyOnboardingVisibility(guild, verifiedRole, welcomeChannel, rulesChannel);

            const rulesEmbed = new EmbedBuilder()
                .setColor(0xB84DFF)
                .setTitle('📜 SERVER-REGELN')
                .setDescription(
                    'Willkommen auf **' + guild.name + '**! 👋\n' +
                    'Bitte lies dir die Regeln kurz durch, bevor du dich verifizierst.\n\n' +
                    RULES_TEXT +
                    '\n\n✅ **VERIFIZIERUNG**\n' +
                    'Mit einem Klick auf **✅ Verifizieren** bestätigst du, dass du die Regeln gelesen hast und akzeptierst.\n\n' +
                    'Danach erhältst du Zugriff auf die normalen Server-Channels.'
                );

            const verifyButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_user')
                    .setLabel('Verifizieren')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success)
            );

            const oldMessages = await rulesChannel.messages.fetch({ limit: 25 }).catch(() => null);
            if (oldMessages) {
                const oldBotPanels = oldMessages.filter(message =>
                    message.author.id === client.user.id
                    && message.components.some(row =>
                        row.components.some(component => component.customId === 'verify_user')
                    )
                );

                for (const message of oldBotPanels.values()) {
                    await message.delete().catch(() => {});
                }
            }

            const verificationMessage = await rulesChannel.send({
                embeds: [rulesEmbed],
                components: [verifyButton]
            });

            await updateWelcomeConfig(client, guild.id, {
                enabled: true,
                channelId: welcomeChannel.id,
                welcomePing: false,
                randomMessages: true,
                rulesChannelId: rulesChannel.id
            });

            await patchGuildConfig(client, guild.id, {
                verification: {
                    enabled: true,
                    channelId: rulesChannel.id,
                    messageId: verificationMessage.id,
                    roleId: verifiedRole.id,
                    message: 'Lies die Regeln und klicke anschließend auf Verifizieren.',
                    buttonText: 'Verifizieren',
                    autoVerify: {
                        enabled: false,
                        criteria: 'none'
                    }
                }
            }, { source: 'welcome_setup' });

            const doneEmbed = new EmbedBuilder()
                .setColor(getColor('success'))
                .setTitle('✅ Willkommen eingerichtet')
                .setDescription([
                    'Erstellt/verwendet: ' + welcomeChannel.toString(),
                    'Erstellt/verwendet: ' + rulesChannel.toString(),
                    'Rolle: ' + verifiedRole.toString(),
                    '',
                    'Neue Mitglieder sehen zunächst nur **Willkommen** und **Regeln**.',
                    'Nach **✅ Verifizieren** sehen sie die normalen, nicht speziell rollengebundenen Bereiche.'
                ].join('\n'));

            await InteractionHelper.safeEditReply(interaction, { embeds: [doneEmbed] });

            logger.info('[Welcome] Automated onboarding setup completed', {
                guildId: guild.id,
                welcomeChannelId: welcomeChannel.id,
                rulesChannelId: rulesChannel.id,
                verifiedRoleId: verifiedRole.id
            });
        } catch (error) {
            logger.error('[Welcome] Automated setup failed', {
                guildId: guild.id,
                error: error.message,
                stack: error.stack
            });

            await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: 'Beim Welcome-Setup ist ein Fehler aufgetreten.'
            });
        }
    }
};
