// welcome.js

import { logger } from './logger.js';

const DEFAULT_TEMPLATES = {
    welcome: 'Hey {user}, willkommen auf **{server}**! 👋',
    goodbye: '{user.tag} has left the server.'
};

const RANDOM_WELCOME_TEMPLATES = [
    '🗡️ Ein neuer Abenteurer schließt sich der Gruppe an: {user}',
    '🧭 Neue Quest entdeckt: {user} kennenlernen.',
    '🏕️ {user} hat offenbar beschlossen, hier sein Lager aufzuschlagen.',
    '🗺️ {user} hat tatsächlich den Weg hierher gefunden. Respekt.',
    '🔮 Die Prophezeiung war wahr. {user} ist da.',
    '🪄 Beschwörung erfolgreich: {user} wurde dem Server hinzugefügt.',
    '🧭 Neuer Reisender entdeckt: {user} hat den Weg zu uns gefunden.',
    '🏰 Die Tore gehen auf – willkommen, {user}.',
    '🪑 Noch ein Platz weniger frei. Willkommen {user}.',
    '🚪 Die Tür war wohl nicht abgeschlossen. Willkommen {user}.',
    '👀 Oh? {user} nähert sich.',
    '👀 Wer hat {user} reingelassen?',
    '📢 Kurze Durchsage: {user} ist jetzt unser Problem.',
    '🧃 {user} ist da. Irgendwer holt bitte Snacks.',
    '🧨 Das kann entweder gut gehen oder sehr lustig werden. Willkommen {user}.',
    '🛎️ Ding Dong. Lieferung für den Server: {user}.',
    '🔍 Wir haben {user} gefunden. Keine Ahnung, wo.',
    '🛒 Bestellung angekommen: 1× {user}',
    '🧩 Ein neues Teil im Chaos: {user}.',
    '🚨 Alarm! {user} hat den Server gefunden.',
    '🍺 Die Tür der Taverne knarrt… {user} tritt ein.',
    '🔥 Ein Reisender wärmt sich am Kamin: {user}.',
    '🛏️ Der Wirt hat noch ein Zimmer frei – für {user}.',
    '🍻 Noch ein Krug bitte! {user} ist angekommen.',
    '🎒 Staubig von der langen Reise: {user} ist da.',
    '🐴 Ein Pferd wird vor der Taverne angebunden… {user} ist angekommen.',
    '📜 Neuer Eintrag im Gästebuch: {user}.',
    '🎶 Der Barde stimmt ein Lied an – für {user}!',
    '🍖 Leg noch was auf den Grill, {user} ist da!',
    '🕯️ Eine Kerze mehr am Fenster – willkommen, {user}.',
    '🪙 {user} wirft eine Münze auf die Theke. Willkommen!',
    '🗝️ Der Wirt reicht {user} einen Zimmerschlüssel.',
    '🌧️ Draußen regnet\'s – gut, dass {user} reingekommen ist.',
    '⚔️ {user} lehnt das Schwert an die Wand und setzt sich dazu.',
    '🧙 Ein Fremder mit Kapuze… ach, es ist {user}!',
    '🍺 Der Stammtisch rückt zusammen – Platz für {user}.',
    '📯 Hört, hört! {user} ist in der Taverne eingetroffen.',
    '🛡️ Ein neuer Abenteurer kehrt in der Taverne ein: {user}.',
    '🗺️ {user} hat die Taverne auf der Karte gefunden.',
    '🍻 Prost! Auf unseren neuen Gast {user}!',
    '🧳 {user} stellt das Gepäck ab und bleibt eine Weile.',
    '🌅 Nach langer Reise erreicht {user} endlich die Taverne.',
    '🐉 Gerüchte am Tresen: {user} soll angekommen sein.',
    '🍞 Frisches Brot und ein Krug Met für {user}!',
    '🔔 Die Glocke über der Tür bimmelt – {user} ist da.',
    '🪵 Noch ein Holzscheit ins Feuer, {user} bleibt über Nacht.',
    '🧾 Der Wirt schreibt {user} schon mal einen Deckel an.',
    '🏹 Ein Wanderer aus fernen Landen hat zu uns gefunden: {user}.',
    '🍺 Ein frisch gezapftes Bier wartet schon auf {user}.',
    '🪑 Der Wirt rückt einen Stuhl zurecht – setz dich, {user}!'
]

function replaceAll(message, token, value) {
    if (value === undefined || value === null) {
        return message;
    }
    return message.split(token).join(String(value));
}

export function truncateForEmbedField(value, maxLength = 1024) {
    const text = String(value ?? '').trim();
    if (!text) {
        return '—';
    }
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function formatWelcomeMessage(message, data) {
    if (typeof message !== 'string') return '';
    if (!message) return '';
    if (!data || typeof data !== 'object') return message;

    const user = data?.user;
    const guild = data?.guild;

    if (!user || typeof user !== 'object') {
        logger.warn('Invalid user object passed to formatWelcomeMessage');
    }
    if (!guild || typeof guild !== 'object') {
        logger.warn('Invalid guild object passed to formatWelcomeMessage');
    }

    const tokens = {
        '{user}': user?.toString?.() || 'User',
        '{user.mention}': user?.toString?.() || 'User',
        '{user.tag}': user?.tag || 'Unknown#0000',
        '{user.username}': user?.username || 'Unknown',
        '{username}': user?.username || 'Unknown',
        '{user.discriminator}': user?.discriminator || '0000',
        '{user.id}': user?.id || 'unknown',
        '{server}': guild?.name || 'Server',
        '{server.name}': guild?.name || 'Server',
        '{guild.name}': guild?.name || 'Server',
        '{guild.id}': guild?.id || 'unknown',
        '{guild.memberCount}': guild?.memberCount?.toString?.() || '0',
        '{memberCount}': guild?.memberCount?.toString?.() || '0',
        '{membercount}': guild?.memberCount?.toString?.() || '0'
    };

    let result = message;
    for (const [token, value] of Object.entries(tokens)) {
        if (value === undefined || value === null) continue;
        result = replaceAll(result, token, String(value));
    }

    return result;
}

export function getRandomWelcomeMessage() {
    return RANDOM_WELCOME_TEMPLATES[Math.floor(Math.random() * RANDOM_WELCOME_TEMPLATES.length)];
}

export function getDefaultWelcomeMessage() {
    return DEFAULT_TEMPLATES.welcome;
}

export function getDefaultGoodbyeMessage() {
    return DEFAULT_TEMPLATES.goodbye;
}
