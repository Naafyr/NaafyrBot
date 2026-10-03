import { ChannelType, EmbedBuilder } from 'discord.js';
import { RANKS } from './rankService.js';
import { CATEGORIES as LEADERBOARD } from './leaderboardService.js';
import { logger } from '../utils/logger.js';

// 📖┃tavernenführer im EMPFANG: erklärt den Server. Eine Nachricht mit 7 Boxen, wird bei /setup willkommen aktualisiert.
export const GUIDE_CHANNEL_NAME = '📖┃tavernenführer';
const guideKey = guildId => `guild:${guildId}:guide:message`;

const rankLine = rank => `${rank.name.split(' ')[0]} **${rank.name.slice(rank.name.indexOf(' ') + 1)}**: ab ${rank.days} Tagen + ${rank.messages} Nachrichten *oder* ${rank.voiceHours} Std. Voice`;
const podium = roles => `🥇 ${roles[0]} · 🥈 ${roles[1]} · 🥉 ${roles[2]}`;

export function buildGuideEmbeds() {
  const box = (color, title, lines) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(lines.join('\n'));
  return [
    box(0xF1C40F, '🍺 Willkommen in der Taverne', [
      'Schön, dass du da bist! Das hier ist Naafyrs Taverne – ein Ort zum Quatschen, Zocken und Abhängen, vor und nach dem Stream.',
      'Hier unten erfährst du, wo was ist und wie alles funktioniert. Nimm dir einen Krug und lies kurz rein. 🍻'
    ]),
    box(0x8B5A2B, '🗺️ Wo ist was?', [
      '**📊 AUSHANG** – Mitglieder, Online & Boosts',
      '**🚪 EINGANG** – 📜 hausordnung',
      '**🔔 GLOCKE** – 🔴 live · 📺 neue Videos · 📱 Shorts · ✂️ Clips',
      '**🏆 EHRENTAFEL** – die Aktivsten der Taverne',
      '**🛎️ EMPFANG** – 📜 gästebuch (wer neu ist) · 📖 tavernenführer · 🎒 ausrüstung',
      '**🍻 STAMMTISCH** – 🍺 tresen (Hauptchat) · 🍖 aus-der-küche · 🐾 tierische-gäste · ⚒️ die-schmiede (Setups) · 🖼️ bilderwand · 🍺 kneipenweisheiten · 📮 briefkasten-vom-wirt · 🎂 geburtstage',
      '**🛏️ ZIMMER** – eigene Voice-Räume',
      '**🎲 SPIELTISCHE / 📰 NEUIGKEITEN** – Chats & Patch-Notes zu deinen Games (je nach Ausrüstung)'
    ]),
    box(0xE07B39, '🍻 Ränge', [
      'Je länger du da bist und je mehr du mitmachst, desto weiter steigst du auf:',
      '🧭 **Reisender**: gerade angekommen',
      `${RANKS[0].name.split(' ')[0]} **${RANKS[0].name.slice(RANKS[0].name.indexOf(' ') + 1)}**: nach dem Eintreten`,
      ...RANKS.slice(1).map(rankLine),
      '',
      '🎂 **Geburtstagskind**: gibt\'s an deinem Geburtstag, 24 Stunden lang.',
      '💎 **Ehrengast**: vergibt nur der Wirt.',
      '*Ränge werden automatisch alle 10 Minuten aktualisiert.*'
    ]),
    box(0x3498DB, '🛏️ Eigene Räume', [
      '➕ **tisch-nehmen** – Join und du bekommst deinen **eigenen offenen Raum**.',
      '🔒 **zimmer-mieten** – Join und du bekommst einen **privaten Raum** mit ⏳ Wartebereich davor.',
      'Im Chat deines Raums findest du die **Steuerung**: privat/öffentlich, sichtbar/unsichtbar, Limit, Umbenennen, Spiel wählen, jemanden rauswerfen.',
      'Gehst du raus, übernimmt, wer als Nächstes reingekommen ist. Ist der Raum leer, verschwindet er.',
      '😴 Wer 30 Minuten nichts sagt, wandert in die **Schlafkammer**.'
    ]),
    box(0x9B59B6, '🏆 Ehrentafel', [
      'Gezählt wird pro Woche, Monat und für immer. Die **Top 3 des Monats** bekommen eine eigene Rolle:',
      '',
      '🍺 **Tresenredner** – die meisten Nachrichten *(Spam und nur Emojis zählen nicht)*',
      podium(LEADERBOARD.chat.roles),
      '',
      '🪑 **Sitzfleisch** – die meiste Zeit im Voice *(nur mit mind. 2 Leuten, nicht stumm/taub, nicht in der Schlafkammer)*',
      podium(LEADERBOARD.voice.roles),
      '',
      '🎨 **Hofmaler** – die meisten Bilder in den Bilder-Channels',
      podium(LEADERBOARD.photo.roles)
    ]),
    box(0x2ECC71, '🎒 Ausrüstung & Pings', [
      'In 🎒 **ausrüstung** wählst du deine **Games** – dann siehst du die passenden Chats an den 🎲 Spieltischen und die 📰 Patch-Notes.',
      'Zu viele Pings? Dort kannst du **Live-Pings** und **Video-Pings** abschalten – dann siehst du diese Channels nicht mehr.'
    ]),
    box(0xFF73FA, '🎂 Kleine Extras', [
      '🎂 **Geburtstag** – in 🎂 geburtstage eintragen, dann gratuliert die ganze Taverne.',
      '🍺 **Kneipenweisheiten** – Rechtsklick auf eine Nachricht → **Apps** → **Als Zitat speichern**.',
      '📮 **Briefkasten vom Wirt** – Ideen für den Server. Jeder Vorschlag bekommt 👍/👎 und einen Thread.'
    ])
  ];
}

// Postet den Führer oder bearbeitet die vorhandene Nachricht (keine Doppel).
export async function postTavernGuide(client, guild) {
  const channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === GUIDE_CHANNEL_NAME);
  if (!channel) return null;
  const payload = { embeds: buildGuideEmbeds() };
  const stored = await client.db?.get?.(guideKey(guild.id)).catch(() => null);
  const existing = stored?.messageId ? await channel.messages.fetch(stored.messageId).catch(() => null) : null;
  if (existing) {
    await existing.edit(payload);
    return existing;
  }
  const sent = await channel.send(payload);
  await client.db?.set?.(guideKey(guild.id), { messageId: sent.id }).catch(() => {});
  logger.info('[Tavernenführer] gepostet', { guildId: guild.id });
  return sent;
}
