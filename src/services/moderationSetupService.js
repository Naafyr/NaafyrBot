import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { getGuildConfig, updateGuildConfig } from './config/guildConfig.js';
import { logEvent } from './loggingService.js';
import { logger } from '../utils/logger.js';

export const MOD_CATEGORY_NAME = '──── 🛡️ MODERATION 🛡️ ────';
export const MOD_LOG_NAME = '📝┃mod-log';

const NEW_ACCOUNT_DAYS = 7;
const RAID_JOINS = 10;
const RAID_WINDOW_MS = 60_000;
const RAID_ALERT_COOLDOWN_MS = 10 * 60_000;

// ---------- Kategorie + Channel (nur Admins) ----------

export async function ensureModLogChannel(guild) {
  // Admins sehen alles automatisch → @everyone ausblenden reicht.
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
  ];

  let category = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === MOD_CATEGORY_NAME);
  if (!category) {
    category = await guild.channels.create({ name: MOD_CATEGORY_NAME, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: 'NaafyrBot Moderation' });
  }

  let channel = guild.channels.cache.find(candidate => candidate.type === ChannelType.GuildText && candidate.name === MOD_LOG_NAME);
  if (!channel) {
    channel = await guild.channels.create({
      name: MOD_LOG_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Auto-Mod, gelöschte/bearbeitete Nachrichten, Mod-Aktionen, Leaves, Warnungen',
      permissionOverwrites: overwrites,
      reason: 'NaafyrBot Moderation'
    });
  } else {
    if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false });
    await channel.permissionOverwrites.set(overwrites);
  }

  return channel;
}

export const TEST_CHANNEL_NAME = '🧪┃test';

// Eigener Spam-/Test-Channel für Admins in der Mod-Kategorie.
export async function ensureTestChannel(guild, modLog) {
  const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === TEST_CHANNEL_NAME);
  if (existing) return { channel: existing, created: false };

  const channel = await guild.channels.create({
    name: TEST_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: modLog.parentId,
    topic: 'Zum Testen und Rumspammen – nur für Admins',
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
    ],
    reason: 'NaafyrBot Test-Channel'
  });
  return { channel, created: true };
}

// Discords Standard-Kategorien beim Server-Erstellen ("Textkanäle" → #allgemein, "Sprachkanäle" → Allgemein).
// Nur exakte Original-Namen – unsere eigenen Channels (💬┃allgemein, ──── 🔊 VOICE 🔊 ────) bleiben unberührt.
const DEFAULT_CATEGORY_NAMES = new Set(['textkanäle', 'text channels', 'sprachkanäle', 'voice channels', 'voice']);
const DEFAULT_CHANNEL_NAMES = new Set(['allgemein', 'general']);

export async function removeDiscordDefaults(guild, { keepChannelId = null } = {}) {
  const removed = [];
  const categories = guild.channels.cache.filter(channel =>
    channel.type === ChannelType.GuildCategory && DEFAULT_CATEGORY_NAMES.has(channel.name.toLowerCase())
  );

  for (const category of categories.values()) {
    const children = guild.channels.cache.filter(channel => channel.parentId === category.id);

    for (const child of children.values()) {
      if (!DEFAULT_CHANNEL_NAMES.has(child.name.toLowerCase()) || child.id === keepChannelId) continue;
      await child.delete('Discord-Standardchannel entfernt').then(() => removed.push(`${category.name} → ${child.name}`)).catch(() => {});
    }

    // Kategorie nur löschen, wenn wirklich nichts anderes mehr drin ist.
    const remaining = guild.channels.cache.filter(channel => channel.parentId === category.id);
    if (remaining.size === 0) {
      await category.delete('Discord-Standardkategorie entfernt').then(() => removed.push(category.name)).catch(() => {});
    }
  }

  // Die Standard-Voice "Allgemein" kann auch in einer umbenannten Kategorie stecken (z. B. ──── 🔊 VOICE 🔊 ────).
  const defaultVoices = guild.channels.cache.filter(channel =>
    channel.type === ChannelType.GuildVoice &&
    DEFAULT_CHANNEL_NAMES.has(channel.name.toLowerCase()) &&
    channel.members.size === 0
  );
  for (const voice of defaultVoices.values()) {
    await voice.delete('Discord-Standard-Voice entfernt').then(() => removed.push(`🔊 ${voice.name}`)).catch(() => {});
  }

  return removed;
}

// ---------- Logging-Konfiguration ----------

export async function configureLogging(client, guildId, channelId) {
  const config = await getGuildConfig(client, guildId);
  const logging = {
    ...config.logging,
    enabled: true,
    channels: { ...(config.logging?.channels || {}), audit: channelId },
    enabledEvents: {
      ...(config.logging?.enabledEvents || {}),
      // Joins stehen schon in 👋┃willkommen, Zähler-Updates wären nur Spam.
      'member.join': false,
      'counter.update': false,
      'counter.config': false
    }
  };
  await updateGuildConfig(client, guildId, { logging });
}

// ---------- Auto-Mod (Discords eingebauter AutoMod) ----------

const INVITE_RULE_NAME = 'NaafyrBot: Discord-Einladungen';

function alertActions(channelId, customMessage) {
  return [
    { type: AutoModerationActionType.BlockMessage, metadata: { customMessage } },
    { type: AutoModerationActionType.SendAlertMessage, metadata: { channel: channelId } }
  ];
}

// Spam, Massen-Erwähnungen und Wortlisten darf es nur je einmal pro Server geben → vorhandene Regel anpassen.
async function upsertRule(guild, existingRules, match, data) {
  const existing = existingRules.find(match);
  if (existing) {
    await existing.edit({ name: data.name, actions: data.actions, triggerMetadata: data.triggerMetadata, enabled: true, reason: 'NaafyrBot Auto-Mod' });
    return 'aktualisiert';
  }
  await guild.autoModerationRules.create({ ...data, eventType: AutoModerationRuleEventType.MessageSend, enabled: true, reason: 'NaafyrBot Auto-Mod' });
  return 'angelegt';
}

export async function ensureAutoModRules(guild, alertChannelId) {
  const rules = await guild.autoModerationRules.fetch();
  const canTimeout = guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers);
  const results = [];

  const run = async (label, match, data) => {
    try {
      results.push(`✅ ${label} (${await upsertRule(guild, rules, match, data)})`);
    } catch (error) {
      logger.error('[Mod-Setup] AutoMod rule failed', { guildId: guild.id, rule: label, error: error.message });
      results.push(`❌ ${label}: ${error.message}`);
    }
  };

  await run('Fremde Discord-Einladungen',
    rule => rule.name === INVITE_RULE_NAME,
    {
      name: INVITE_RULE_NAME,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      // (?i) = Groß-/Kleinschreibung egal (Discord nutzt Rust-Regex).
      triggerMetadata: { regexPatterns: ['(?i)(discord\\.gg|discord(app)?\\.com/invite|dsc\\.gg)/[a-z0-9-]+'] },
      actions: alertActions(alertChannelId, 'Einladungen zu anderen Servern sind hier nicht erlaubt (Regel 3: Keine Werbung).')
    });

  await run('Massen-Erwähnungen',
    rule => rule.triggerType === AutoModerationRuleTriggerType.MentionSpam,
    {
      name: 'NaafyrBot: Massen-Erwähnungen',
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true },
      actions: [
        ...alertActions(alertChannelId, 'Bitte nicht so viele Leute auf einmal erwähnen (Regel 2: Kein Spam).'),
        ...(canTimeout ? [{ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 600 } }] : [])
      ]
    });

  await run('Spam-Filter',
    rule => rule.triggerType === AutoModerationRuleTriggerType.Spam,
    {
      name: 'NaafyrBot: Spam-Filter',
      triggerType: AutoModerationRuleTriggerType.Spam,
      actions: alertActions(alertChannelId, 'Deine Nachricht wurde als Spam erkannt.')
    });

  await run('Schimpfwort-Filter',
    rule => rule.triggerType === AutoModerationRuleTriggerType.KeywordPreset,
    {
      name: 'NaafyrBot: Schimpfwort-Filter',
      triggerType: AutoModerationRuleTriggerType.KeywordPreset,
      triggerMetadata: {
        presets: [
          AutoModerationRuleKeywordPresetType.Profanity,
          AutoModerationRuleKeywordPresetType.SexualContent,
          AutoModerationRuleKeywordPresetType.Slurs
        ]
      },
      actions: alertActions(alertChannelId, 'Bitte achte auf deine Wortwahl (Regel 1 & 4).')
    });

  return { results, canTimeout };
}

// ---------- Neue Accounts + Raid-Alarm ----------

const recentJoins = new Map();
const lastRaidAlert = new Map();

export async function checkJoinSecurity(member, now = Date.now()) {
  const { guild, user } = member;
  if (user.bot) return;

  const ageDays = (now - user.createdTimestamp) / 86_400_000;
  if (ageDays < NEW_ACCOUNT_DAYS) {
    await logEvent({
      client: member.client,
      guildId: guild.id,
      eventType: 'security.newaccount',
      data: {
        title: '⚠️ Neuer Account beigetreten',
        color: 0xFEE75C,
        lines: [
          `**User:** ${user.toString()} (${user.tag})`,
          `**ID:** \`${user.id}\``,
          `**Account erstellt:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
          `Accounts jünger als ${NEW_ACCOUNT_DAYS} Tage sind oft Fake- oder Spam-Accounts – kurz im Auge behalten.`
        ],
        thumbnail: user.displayAvatarURL(),
        userId: user.id
      }
    });
  }

  const joins = (recentJoins.get(guild.id) || []).filter(time => now - time < RAID_WINDOW_MS);
  joins.push(now);
  recentJoins.set(guild.id, joins);

  if (joins.length >= RAID_JOINS && now - (lastRaidAlert.get(guild.id) || 0) > RAID_ALERT_COOLDOWN_MS) {
    lastRaidAlert.set(guild.id, now);
    await logEvent({
      client: member.client,
      guildId: guild.id,
      eventType: 'security.raid',
      content: '@here',
      data: {
        title: '🚨 Möglicher Raid!',
        color: 0xED4245,
        lines: [
          `**${joins.length} Beitritte** in der letzten Minute.`,
          'Tipp: Server-Einstellungen → Sicherheit → **Beitritte pausieren**, bis es ruhiger wird.'
        ]
      }
    });
  }
}
