import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

import { updateWelcomeConfig } from '../../utils/database.js';
import { patchGuildConfig } from '../../services/config/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';

async function getOrCreateVerifiedRole(guild) {
    let role = guild.roles.cache.find(
        r => r.name.toLowerCase() === 'verifiziert' && !r.managed
    );

    if (!role) {
        role = await guild.roles.create({
            name: 'Verifiziert',
            permissions: [],
            reason: 'NaafyrBot new welcome setup'
        });
    }

    return role;
}

async function getOrCreateCategory(guild, name, aliases = []) {
    let category = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && (c.name === name || aliases.includes(c.name))
    );

    if (!category) {
        category = await guild.channels.create({
            name,
            type: ChannelType.GuildCategory,
            reason: 'NaafyrBot server structure setup'
        });
    } else if (category.name !== name) {
        await category.setName(name, 'NaafyrBot server structure style update');
    }

    return category;
}

async function getOrCreateTextChannel(guild, name, topic, aliases = [], parent = null) {
    let channel = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && (c.name === name || aliases.includes(c.name))
    );

    if (!channel) {
        channel = await guild.channels.create({
            name,
            type: ChannelType.GuildText,
            topic,
            parent: parent?.id,
            reason: 'NaafyrBot new welcome setup'
        });
    } else {
        const updates = {};

        if (channel.name !== name) {
            updates.name = name;
        }

        if (channel.topic !== topic) {
            updates.topic = topic;
        }

        if (Object.keys(updates).length > 0) {
            await channel.edit({
                ...updates,
                reason: 'NaafyrBot channel style update'
            });
        }

        if (parent && channel.parentId !== parent.id) {
            await channel.setParent(parent.id, { lockPermissions: false });
        }
    }

    return channel;
}

async function getOrCreateVoiceChannel(guild, name, aliases = [], parent = null) {
    let channel = guild.channels.cache.find(
        c => c.type === ChannelType.GuildVoice && (c.name === name || aliases.includes(c.name))
    );

    if (!channel) {
        channel = await guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: parent?.id,
            reason: 'NaafyrBot voice structure setup'
        });
    } else {
        if (channel.name !== name) {
            await channel.setName(name, 'NaafyrBot channel style update');
        }

        if (parent && channel.parentId !== parent.id) {
            await channel.setParent(parent.id, { lockPermissions: false });
        }
    }

    return channel;
}

function hasSpecialRoleGate(channel, guild) {
    if (!channel.permissionOverwrites?.cache) return false;

    return channel.permissionOverwrites.cache.some(overwrite => {
        if (overwrite.id === guild.id) return false;
        if (overwrite.type !== 0) return false;

        return overwrite.allow.has(PermissionFlagsBits.ViewChannel)
            || overwrite.deny.has(PermissionFlagsBits.ViewChannel);
    });
}

async function applyVisibility(guild, verifiedRole, welcomeChannel, rulesChannel) {
    const onboardingIds = new Set([welcomeChannel.id, rulesChannel.id]);

    for (const channel of guild.channels.cache.values()) {
        if (!channel.permissionOverwrites) continue;

        if (onboardingIds.has(channel.id)) {
            await channel.permissionOverwrites.edit(guild.id, {
                ViewChannel: true,
                SendMessages: false
            });

            await channel.permissionOverwrites.edit(verifiedRole.id, {
                ViewChannel: true,
                SendMessages: false
            });

            continue;
        }

        const specialRoleGate = hasSpecialRoleGate(channel, guild);

        await channel.permissionOverwrites.edit(guild.id, {
            ViewChannel: false
        });

        if (!specialRoleGate) {
            await channel.permissionOverwrites.edit(verifiedRole.id, {
                ViewChannel: true
            });
        }
    }
}

function buildRulesEmbed(guild) {
    return new EmbedBuilder()
        .setColor(0xB84DFF)
        .setTitle('📜 SERVER-REGELN')
        .setDescription([
            `Willkommen auf **${guild.name}**! 👋`,
            'Bitte lies dir die Regeln kurz durch, bevor du dich verifizierst.',
            '',
            '🤝 **1. Respektvoll miteinander umgehen**',
            'Behandle andere Mitglieder freundlich und respektvoll. Beleidigungen, Provokationen und unnötiger Streit gehören hier nicht hin.',
            '',
            '🚫 **2. Kein Spam**',
            'Kein unnötiges Spammen von Nachrichten, Emojis, Bildern, Sounds oder Erwähnungen.',
            '',
            '📢 **3. Keine Werbung**',
            'Werbung für eigene Server, Social-Media-Kanäle, Streams oder andere Inhalte ist ohne vorherige Erlaubnis nicht gestattet.',
            '',
            '🔞 **4. Keine unangemessenen Inhalte**',
            'Extremistische, diskriminierende, sexuelle oder anderweitig problematische Inhalte haben auf dem Server nichts verloren.',
            '',
            '🙅 **5. Andere Mitglieder nicht nerven oder bedrängen**',
            'Respektiere, wenn Leute gerade miteinander reden oder spielen.',
            '',
            '🎙️ **6. Rücksicht im Voice-Chat**',
            'Kein absichtliches Schreien, Soundboard-Spam oder extrem laute Geräusche.',
            '',
            '🎥 **7. Aufnahmen nur mit Zustimmung**',
            'Wenn Stimmen oder Gespräche aufgenommen oder veröffentlicht werden sollen, sollten die betroffenen Personen vorher Bescheid wissen.',
            '',
            '📂 **8. Nutzt die richtigen Channels**',
            'Versucht Inhalte in die dafür vorgesehenen Channels zu schicken.',
            '',
            '📌 **9. Discord-Regeln gelten weiterhin**',
            'Die Nutzungsbedingungen und Community-Richtlinien von Discord gelten selbstverständlich auch hier.',
            '',
            '✅ **VERIFIZIERUNG**',
            '',
            'Mit einem Klick auf **✅ Verifizieren** bestätigst du, dass du die Regeln gelesen hast und akzeptierst.',
            '',
            'Danach erhältst du Zugriff auf die normalen Server-Channels.'
        ].join('\n'));
}

export default {
    data: new SlashCommandBuilder()
        .setName('newwelcome')
        .setDescription('Neues unabhängiges Welcome-System einrichten')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub
                .setName('setup')
                .setDescription('Richtet das neue Welcome-System komplett neu ein')
        ),

    async execute(interaction) {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const { guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du brauchst **Server verwalten**, um das neue Welcome-System einzurichten.'
            });
        }

        try {
            const botMember = guild.members.me;

            if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)
                || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
                || !botMember.permissions.has(PermissionFlagsBits.SendMessages)
                || !botMember.permissions.has(PermissionFlagsBits.EmbedLinks)) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Dem Bot fehlen Berechtigungen für Kanäle, Rollen oder Embeds.'
                });
            }

            const verifiedRole = await getOrCreateVerifiedRole(guild);

            if (verifiedRole.position >= botMember.roles.highest.position) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Die Rolle **Verifiziert** muss unter der höchsten Bot-Rolle stehen.'
                });
            }

            const moinCategory = await getOrCreateCategory(
                guild,
                '──── 👋 MOIN 👋 ────',
                ['Moin', 'Start', 'Start Hier']
            );

            const contentCategory = await getOrCreateCategory(
                guild,
                '──── 🎬 CONTENT 🎬 ────',
                ['Content']
            );

            const welcomeCategory = await getOrCreateCategory(
                guild,
                '──── 🎭 WILLKOMMEN 🎭 ────',
                ['Willkommen']
            );

            const communityCategory = await getOrCreateCategory(
                guild,
                '──── 💬 COMMUNITY 💬 ────',
                ['Community', 'Treffpunkt', 'Chats']
            );

            const voiceCategory = await getOrCreateCategory(
                guild,
                '──── 🔊 VOICE 🔊 ────',
                ['Voice', 'Sprachkanäle', 'Sprachchannel']
            );

            const leaderboardCategory = await getOrCreateCategory(
                guild,
                '──── 🏆 LEADERBOARD 🏆 ────',
                ['Leaderboard', 'Leaderboards', 'Ranglisten']
            );

            const rulesChannel = await getOrCreateTextChannel(
                guild,
                '📜┃regeln',
                'Regeln lesen und verifizieren',
                ['regeln'],
                moinCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🔴┃live',
                'Live-Ankündigungen',
                ['live'],
                contentCategory
            );

            await getOrCreateTextChannel(
                guild,
                '📺┃neue-videos',
                'Neue Videos',
                ['neue-videos', 'videos'],
                contentCategory
            );

            await getOrCreateTextChannel(
                guild,
                '✂️┃clips-und-highlights',
                'Clips und Highlights',
                ['clips-und-highlights', 'clips', 'highlights'],
                contentCategory
            );

            const welcomeChannel = await getOrCreateTextChannel(
                guild,
                '👋┃willkommen',
                'Willkommen auf dem Server',
                ['willkommen'],
                welcomeCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🎭┃rollen-auswahl',
                'Rollen auswählen',
                ['rollen', 'rollen-auswahl', '🎭┃rollen'],
                welcomeCategory
            );

            await getOrCreateTextChannel(
                guild,
                '💬┃allgemein',
                'Allgemeiner Community-Chat',
                ['allgemein'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🍕┃essen-bilder',
                'Bilder von Essen und Getränken',
                ['essen-bilder', 'food', 'essen'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🐾┃tier-bilder',
                'Bilder von Tieren und Haustieren',
                ['tier-bilder', 'tiere', 'haustiere'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '📸┃allgemein-bilder',
                'Allgemeine Bilder und Fotos',
                ['allgemein-bilder', 'bilder', 'fotos'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '💭┃zitate',
                'Zitate und Sprüche',
                ['zitate'],
                communityCategory
            );

            await getOrCreateVoiceChannel(
                guild,
                '➕┃channel-erstellen',
                ['channel-erstellen'],
                voiceCategory
            );

            await getOrCreateVoiceChannel(
                guild,
                '🔒┃privaten-channel-erstellen',
                ['privaten-channel-erstellen', 'premium-channel-erstellen'],
                voiceCategory
            );

            await getOrCreateVoiceChannel(
                guild,
                '😴┃afk',
                ['afk'],
                voiceCategory
            );


            const legacyWaitingChannel = guild.channels.cache.find(
                channel => channel.type === ChannelType.GuildVoice
                    && ['⏳┃wartebereich', 'wartebereich', 'waiting-room', 'waiting-for-moving'].includes(channel.name)
            );

            if (legacyWaitingChannel && legacyWaitingChannel.members.size === 0) {
                await legacyWaitingChannel.delete('Replaced by per-private-room waiting channels').catch(() => {});
            }

            await getOrCreateTextChannel(
                guild,
                '🏆┃leaderboard',
                'Server-Leaderboard',
                ['leaderboard'],
                leaderboardCategory
            );

            await applyVisibility(
                guild,
                verifiedRole,
                welcomeChannel,
                rulesChannel
            );

            const oldMessages = await rulesChannel.messages.fetch({ limit: 50 }).catch(() => null);

            if (oldMessages) {
                const oldPanels = oldMessages.filter(message =>
                    message.author.id === client.user.id
                    && message.components.some(row =>
                        row.components.some(component => component.customId === 'verify_user')
                    )
                );

                for (const message of oldPanels.values()) {
                    await message.delete().catch(() => {});
                }
            }

            const verifyButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_user')
                    .setLabel('Verifizieren')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success)
            );

            const verificationMessage = await rulesChannel.send({
                embeds: [buildRulesEmbed(guild)],
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
            }, { source: 'newwelcome_setup' });

            await InteractionHelper.safeEditReply(interaction, {
                content:
                    '✅ **Server-Struktur & New Welcome eingerichtet.**\n' +
                    'Kategorien, Channels, Regel-Embed und Verifizierung wurden aktualisiert.'
            });

            logger.info('[NewWelcome] Setup completed', {
                guildId: guild.id,
                welcomeChannelId: welcomeChannel.id,
                rulesChannelId: rulesChannel.id,
                verifiedRoleId: verifiedRole.id
            });
        } catch (error) {
            logger.error('[NewWelcome] Setup failed', {
                guildId: interaction.guildId,
                error: error.message,
                stack: error.stack
            });

            await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: 'Beim neuen Welcome-Setup ist ein Fehler aufgetreten.'
            });
        }
    }
};
