import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';

import { updateWelcomeConfig } from '../../../utils/database.js';
import { patchGuildConfig } from '../../../services/config/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';
import { sortCategories } from '../../../utils/categoryOrder.js';

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

        // Nur Rollen MIT Zugang (z. B. Game-Rollen) machen einen Channel "role-gated".
        // Ein reines Verbot (z. B. "Keine Stream-Pings") darf Verifizierten den Channel nicht wegnehmen.
        return overwrite.allow.has(PermissionFlagsBits.ViewChannel);
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
        .setTitle('📜 HAUSORDNUNG DER TAVERNE')
        .setDescription([
            `Willkommen in der **${guild.name}**! 🍺`,
            'Bevor du dir einen Platz am Tresen suchst, lies dir kurz die Hausordnung durch.',
            '',
            '🤝 **§1 – Benimm dich wie ein Gast**',
            'Sei freundlich und respektvoll. Wer pöbelt, beleidigt oder Streit sucht, sitzt schneller vor der Tür, als er „Prost“ sagen kann.',
            '',
            '🚫 **§2 – Kein Gebrüll am Tresen**',
            'Kein Spam – weder Nachrichten, Emojis, Bilder, Sounds noch Erwähnungen.',
            '',
            '📢 **§3 – Keine Flugblätter an der Wand**',
            'Werbung für eigene Server, Kanäle oder Streams nur mit Erlaubnis vom Wirt.',
            '',
            '🔞 **§4 – Was nicht in eine Taverne gehört, bleibt draußen**',
            'Keine extremistischen, diskriminierenden, sexuellen oder sonst problematischen Inhalte.',
            '',
            '🙅 **§5 – Lass die anderen in Ruhe trinken**',
            'Nerv oder bedräng niemanden. Respektiere, wenn Leute gerade miteinander reden oder spielen.',
            '',
            '🎙️ **§6 – Zimmerlautstärke im Voice**',
            'Kein absichtliches Schreien, kein Soundboard-Spam, keine Ohrenschmerz-Geräusche.',
            '',
            '🎥 **§7 – Was in der Taverne gesagt wird …**',
            '… bleibt in der Taverne. Aufnahmen nur, wenn alle Beteiligten Bescheid wissen.',
            '',
            '📂 **§8 – Jeder Krug an seinen Platz**',
            'Nutze die passenden Channels – Bilder zu Bildern, Clips zu Clips.',
            '',
            '📌 **§9 – Das Gesetz des Landes gilt auch hier**',
            'Es gelten die [Discord-Nutzungsbedingungen](https://discord.com/terms) und [Community-Richtlinien](https://discord.com/guidelines), Mindestalter 13 Jahre.',
            '',
            '🍻 **EINTRITT IN DIE TAVERNE**',
            '',
            'Mit einem Klick auf **✅ Verifizieren** bestätigst du, dass du die Hausordnung gelesen hast.',
            '',
            'Danach darfst du dir einen Platz suchen – aus 🧭 Reisender wird 🍺 Gast.'
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
                '▬▬▬ 🚪 EINGANG 🚪 ▬▬▬',
                ['▬▬▬ 👋 MOIN 👋 ▬▬▬', 'Moin', 'Start', 'Start Hier']
            );

            const contentCategory = await getOrCreateCategory(
                guild,
                '▬▬▬ 🔔 GLOCKE 🔔 ▬▬▬',
                ['▬▬▬ 🎬 CONTENT 🎬 ▬▬▬', 'Content']
            );

            const welcomeCategory = await getOrCreateCategory(
                guild,
                '▬▬▬ 🛎️ EMPFANG 🛎️ ▬▬▬',
                ['▬▬▬ 🎭 WILLKOMMEN 🎭 ▬▬▬', 'Willkommen']
            );

            const communityCategory = await getOrCreateCategory(
                guild,
                '▬▬▬ 🍻 STAMMTISCH 🍻 ▬▬▬',
                ['▬▬▬ 💬 COMMUNITY 💬 ▬▬▬', 'Community', 'Treffpunkt', 'Chats']
            );

            const voiceCategory = await getOrCreateCategory(
                guild,
                '▬▬▬ 🛏️ ZIMMER 🛏️ ▬▬▬',
                ['▬▬▬ 🔊 VOICE 🔊 ▬▬▬', 'Voice', 'Sprachkanäle', 'Sprachchannel']
            );

            const leaderboardCategory = await getOrCreateCategory(
                guild,
                '▬▬▬ 🏆 EHRENTAFEL 🏆 ▬▬▬',
                ['▬▬▬ 🏆 LEADERBOARD 🏆 ▬▬▬', 'Leaderboard', 'Leaderboards', 'Ranglisten']
            );

            const rulesChannel = await getOrCreateTextChannel(
                guild,
                '📜┃hausordnung',
                'Hausordnung lesen und eintreten',
                ['📜┃regeln', 'regeln', 'hausordnung'],
                moinCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🔴┃live',
                'Live-Ankündigungen',
                ['live'],
                contentCategory
            );

            const videosChannel = await getOrCreateTextChannel(
                guild,
                '📺┃neue-videos',
                'Neue Videos',
                ['neue-videos', 'videos'],
                contentCategory
            );

            const shortsChannel = await getOrCreateTextChannel(
                guild,
                '📱┃neue-shorts',
                'Neue YouTube Shorts',
                ['neue-shorts', 'shorts'],
                contentCategory
            );

            if (shortsChannel.position !== videosChannel.position + 1) {
                await shortsChannel.setPosition(videosChannel.position + 1).catch(() => {});
            }

            await getOrCreateTextChannel(
                guild,
                '✂️┃clips-und-highlights',
                'Clips und Highlights',
                ['clips-und-highlights', 'clips', 'highlights'],
                contentCategory
            );

            const welcomeChannel = await getOrCreateTextChannel(
                guild,
                '📜┃gästebuch',
                'Wer neu in die Taverne kommt, wird hier eingetragen',
                ['👋┃willkommen', 'willkommen', 'gästebuch'],
                welcomeCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🎒┃ausrüstung',
                'Such dir deine Games und Pings aus',
                ['🎭┃rollen-auswahl', 'rollen', 'rollen-auswahl', '🎭┃rollen', 'ausrüstung'],
                welcomeCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🍺┃tresen',
                'Der Tresen – hier quatschen alle',
                ['💬┃allgemein', 'allgemein', 'tresen'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🍖┃aus-der-küche',
                'Was gibt es heute? Bilder von Essen und Getränken',
                ['🍕┃essen-bilder', 'essen-bilder', 'food', 'essen', 'aus-der-küche'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🐾┃haustiere',
                'Zeig deine Haustiere',
                ['🐾┃tier-bilder', 'tier-bilder', 'tiere', 'haustiere'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🖥️┃setups',
                'Zeig dein PC- und Gaming-Setup',
                ['setups', 'setup'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🖼️┃bilderwand',
                'Bilder und Fotos aller Art',
                ['📸┃allgemein-bilder', 'allgemein-bilder', 'bilder', 'fotos', 'bilderwand'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '🍺┃kneipenweisheiten',
                'Zitate und Sprüche – Rechtsklick auf eine Nachricht → Apps → Als Zitat speichern',
                ['💭┃zitate', 'zitate', 'kneipenweisheiten'],
                communityCategory
            );

            await getOrCreateTextChannel(
                guild,
                '💡┃vorschläge',
                'Ideen für den Server – jeder Vorschlag bekommt 👍/👎 und einen Thread',
                ['vorschläge', 'vorschlaege'],
                communityCategory
            );

            await getOrCreateVoiceChannel(
                guild,
                '➕┃tisch-nehmen',
                ['➕┃channel-erstellen', 'channel-erstellen', 'tisch-nehmen'],
                voiceCategory
            );

            await getOrCreateVoiceChannel(
                guild,
                '🔒┃zimmer-mieten',
                ['🔒┃privaten-channel-erstellen', 'privaten-channel-erstellen', 'premium-channel-erstellen', 'zimmer-mieten'],
                voiceCategory
            );

            await getOrCreateVoiceChannel(
                guild,
                '😴┃schlafkammer',
                ['😴┃afk', 'afk', 'schlafkammer'],
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
                '🏆┃ehrentafel',
                'Wer in der Taverne am aktivsten ist',
                ['🏆┃leaderboard', 'leaderboard', 'ehrentafel'],
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

            await sortCategories(guild);

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
