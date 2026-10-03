// birthdayService.js – Geburtstage: Box mit den nächsten Geburtstagen + tägliche Gratulation (Wiener Zeit).

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js';
import { getGuildBirthdays, setBirthday as dbSetBirthday, deleteBirthday as dbDeleteBirthday } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { BIRTHDAY_ROLE } from './rankService.js';

const TIME_ZONE = 'Europe/Vienna';
const UPCOMING_LIMIT = 5;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const CONGRATS = [
  '🎉 Alles Gute zum Geburtstag, {user}! Lass dich heute ordentlich feiern! 🥳',
  '🎂 Die ganze Taverne stößt auf {user} an! Prost und alles Gute zum Geburtstag! 🍻',
  '🎈 Happy Birthday, {user}! Level up im echten Leben! 🎮',
  '🥳 Heute ist der große Tag von {user}! Alles Liebe und Gute zum Geburtstag! 🎁',
  '🎊 {user} hat Geburtstag! Kuchen für alle – und fleißig gratulieren! 🍰',
  '🍺 Der Wirt schenkt heute aufs Haus aus – {user} hat Geburtstag! Alles Gute! 🎉',
  '🍻 Krüge hoch! Heute feiern wir {user}! Alles Gute zum Geburtstag! 🥳',
  '🕯️ Ein Jahr mehr am Stammtisch – alles Gute zum Geburtstag, {user}! 🎂',
  '🎶 Der Barde spielt heute nur für {user}! Happy Birthday! 🎉',
  '🍾 Die Runde geht heute auf {user}s Geburtstag! Prost und alles Gute! 🍻',
  '📜 Der Herold verkündet: Heute ist {user}s Ehrentag! 🎉',
  '🍰 Der Koch hat extra einen Kuchen gebacken – für {user}! Alles Gute! 🎂',
  '🪙 Ein Säckchen Gold für das Geburtstagskind {user}! 🎉',
  '🔥 Am Kamin wird heute auf {user} angestoßen! Alles Gute! 🍻',
  '🛡️ Alle Stammgäste der Taverne gratulieren {user} zum Geburtstag! 🍻',
  '🥂 Gläser klirren – {user} hat Geburtstag! 🎉',
  '🍖 Festmahl in der Taverne – zu Ehren von {user}! Alles Gute! 🥳',
  '🗝️ Heute gehört die Taverne {user} – alles Gute zum Geburtstag! 🍻',
  '🌟 Ein Jahr voller Abenteuer liegt hinter {user} – auf das nächste! 🎂',
  '🕯️ Heute brennen in der Taverne extra viele Kerzen – für {user}! 🎂',
  '🍺 Freibier am Tresen – {user} wird heute gefeiert! 🎉',
  '🎁 Der Wirt hat ein Geschenk unter der Theke versteckt – für {user}! 🥳',
  '🪑 Heute sitzt {user} am Ehrenplatz am Stammtisch! Alles Gute! 🎂',
  '🎶 Die ganze Taverne singt für {user}: Happy Birthday! 🍻',
  '🍷 Auf {user}! Möge dein neues Lebensjahr so gut sein wie das beste Fass im Keller! 🎉',
  '🔔 Die Tavernenglocke läutet – {user} hat Geburtstag! 🥳',
  '📜 Im Gästebuch steht heute in großen Buchstaben: Alles Gute, {user}! 🎂',
  '🍻 Ein Hoch auf {user}! Heute wird bis zur letzten Runde gefeiert! 🎉',
  '🧁 Kuchen, Krüge und gute Laune – alles für {user}! Happy Birthday! 🥳',
  '🗺️ Ein neues Kapitel der Reise beginnt – alles Gute, {user}! 🎂'
];

function panelKey(guildId) {
  return `guild:${guildId}:geburtstage:panel`;
}

function lastRunKey(guildId) {
  return `guild:${guildId}:geburtstage:lastrun`;
}

// ---------- Datum (Wiener Zeit) ----------

export function viennaToday(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map(part => [part.type, Number(part.value)])
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// 29. Februar wird in Nicht-Schaltjahren am 28. Februar gefeiert.
function celebrationDay(month, day, year) {
  return month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
}

export function isValidBirthday(day, month) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate(); // 2024 = Schaltjahr → 29.02. erlaubt
  return day <= daysInMonth;
}

export function formatBirthday(day, month) {
  return `${day}. ${MONTHS[month - 1]}`;
}

function daysUntil(today, month, day) {
  const start = Date.UTC(today.year, today.month - 1, today.day);
  let year = today.year;
  let target = Date.UTC(year, month - 1, celebrationDay(month, day, year));
  if (target < start) {
    year += 1;
    target = Date.UTC(year, month - 1, celebrationDay(month, day, year));
  }
  return Math.round((target - start) / 86_400_000);
}

export async function getUpcomingBirthdays(client, guildId, today = viennaToday(), limit = UPCOMING_LIMIT) {
  const birthdays = (await getGuildBirthdays(client, guildId)) || {};
  return Object.entries(birthdays)
    .map(([userId, data]) => ({ userId, month: data.month, day: data.day, inDays: daysUntil(today, data.month, data.day) }))
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, limit);
}

// ---------- Box im Channel ----------

export async function buildBirthdayPanel(client, guildId, today = viennaToday()) {
  const upcoming = await getUpcomingBirthdays(client, guildId, today);
  const lines = upcoming.map(entry => {
    if (entry.inDays === 0) return `🥳 **Heute!** <@${entry.userId}> hat Geburtstag!`;
    const when = entry.inDays === 1 ? 'morgen' : `in ${entry.inDays} Tagen`;
    return `🎈 <@${entry.userId}> – ${formatBirthday(entry.day, entry.month)} · ${when}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xFF69B4)
    .setTitle('🎂 GEBURTSTAGE')
    .setDescription([
      'Trag deinen Geburtstag ein, damit wir dir an deinem Tag gratulieren können! 🎉',
      'Nur Tag und Monat – dein Alter bleibt dein Geheimnis. 🤫',
      '',
      '📅 **Die nächsten Geburtstage**',
      lines.length > 0 ? lines.join('\n') : '*Noch niemand eingetragen – sei der Erste!*'
    ].join('\n'))
    .setFooter({ text: 'Wird täglich aktualisiert' });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('geburtstag:set').setLabel('Eintragen / ändern').setEmoji('🎂').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('geburtstag:remove').setLabel('Entfernen').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [buttons] };
}

export async function savePanelRef(client, guildId, message) {
  await client.db.set(panelKey(guildId), { channelId: message.channelId, messageId: message.id });
}

export async function getPanelChannel(client, guild) {
  const ref = await client.db.get(panelKey(guild.id));
  return ref?.channelId ? guild.channels.cache.get(ref.channelId) || null : null;
}

export async function refreshBirthdayPanel(client, guild) {
  const ref = await client.db.get(panelKey(guild.id));
  if (!ref?.channelId || !ref?.messageId) return;

  const channel = guild.channels.cache.get(ref.channelId);
  const message = await channel?.messages.fetch(ref.messageId).catch(() => null);
  if (message) {
    await message.edit(await buildBirthdayPanel(client, guild.id));
  }
}

// ---------- Eintragen / Entfernen ----------

export async function saveBirthday(client, guild, userId, day, month) {
  const ok = await dbSetBirthday(client, guild.id, userId, month, day);
  if (ok) await refreshBirthdayPanel(client, guild).catch(() => {});
  return ok;
}

export async function removeBirthday(client, guild, userId) {
  const birthdays = (await getGuildBirthdays(client, guild.id)) || {};
  if (!birthdays[userId]) return false;
  await dbDeleteBirthday(client, guild.id, userId);
  await refreshBirthdayPanel(client, guild).catch(() => {});
  return true;
}

// ---------- Tägliche Gratulation ----------

async function congratulate(channel, member) {
  const text = CONGRATS[Math.floor(Math.random() * CONGRATS.length)].replace('{user}', member.toString());
  const message = await channel.send({
    content: text,
    allowedMentions: { users: [member.id] },
    embeds: [
      new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('🎉 HAPPY BIRTHDAY! 🎂')
        .setDescription(`Heute feiern wir **${member.displayName}**! Gratuliert im Thread unten. 👇`)
        .setThumbnail(member.user.displayAvatarURL())
    ]
  });

  // Channel ist schreibgeschützt → Gratulationen landen im Thread, die Box oben bleibt sichtbar.
  await message.startThread({ name: `🎉 Gratulationen für ${member.displayName}`.slice(0, 100) }).catch(() => {});
}

export async function checkBirthdays(client) {
  if (!client?.db) return;
  const today = viennaToday();
  const todayId = `${today.year}-${today.month}-${today.day}`;

  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await getPanelChannel(client, guild);
      if (!channel) continue;

      // Pro Tag nur einmal gratulieren, auch nach einem Neustart.
      if ((await client.db.get(lastRunKey(guild.id))) === todayId) continue;
      await client.db.set(lastRunKey(guild.id), todayId);

      // 🎂 Geburtstagskind: gestern vergebene Rolle wieder weg, heute neu vergeben.
      const birthdayRole = guild.roles?.cache?.find(role => role.name === BIRTHDAY_ROLE.name && !role.managed) || null;
      if (birthdayRole) {
        await guild.members.fetch().catch(() => null);
        for (const member of birthdayRole.members.values()) {
          await member.roles.remove(birthdayRole, 'Geburtstag vorbei').catch(() => {});
        }
      }

      const birthdays = (await getGuildBirthdays(client, guild.id)) || {};
      for (const [userId, data] of Object.entries(birthdays)) {
        if (data.month !== today.month || celebrationDay(data.month, data.day, today.year) !== today.day) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        await congratulate(channel, member);
        if (birthdayRole) await member.roles.add(birthdayRole, 'Hat heute Geburtstag').catch(() => {});
      }

      await refreshBirthdayPanel(client, guild);
    } catch (error) {
      logger.error('[Geburtstage] Daily check failed', { guildId: guild.id, error: error.message });
    }
  }
}
