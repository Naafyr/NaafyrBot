// welcome.js

import { logger } from './logger.js';

const DEFAULT_TEMPLATES = {
    welcome: 'Hey {user}, willkommen auf **{server}**! 👋',
    goodbye: '{user.tag} has left the server.'
};

const RANDOM_WELCOME_TEMPLATES = [
    'Hey {user}, willkommen auf **{server}**! 👋',
    '{user} ist jetzt auch am Start. Willkommen! 🎉',
    'Da ist ja jemand Neues: {user}. Mach’s dir gemütlich.',
    '🎮 Ein neuer Spieler ist der Lobby beigetreten: {user}',
    '⚔️ Ein neuer Mitspieler wurde gefunden: {user}',
    '💾 Neuer Spielstand geladen: {user}',
    '🏆 Achievement freigeschaltet: {user} ist da.',
    '❤️ {user} ist gespawnt. Hoffentlich mit genug HP.',
    '🎲 Der Matchmaker hat uns {user} zugeteilt.',
    '💰 Seltener Loot gefunden: {user}',
    '✨ Legendärer Drop! {user} ist erschienen.',
    '📦 Mysteriöse Kiste geöffnet… darin war {user}.',
    '🧰 Inventar aktualisiert: +1 {user}',
    '🗡️ Ein neuer Abenteurer schließt sich der Gruppe an: {user}',
    '🌿 Ein wildes {user} ist erschienen!',
    '⭐ Ein seltenes {user} taucht auf!',
    '👀 Oh? {user} nähert sich.',
    '🌸 Ein neuer Charakter betritt den Arc: {user}',
    '📖 Neues Kapitel begonnen – {user} ist jetzt dabei.',
    '⚔️ {user} ist der Party beigetreten. Der Plot kann weitergehen.',
    '🎬 Neue Folge gestartet: Willkommen {user}!',
    '🚨 Alarm! {user} hat den Server gefunden.',
    '👀 Wer hat {user} reingelassen?',
    '📢 Kurze Durchsage: {user} ist jetzt unser Problem.',
    '🛒 Bestellung angekommen: 1× {user}',
    '🧪 Experiment erfolgreich. {user} lebt.',
    '🚪 Die Tür war wohl nicht abgeschlossen. Willkommen {user}.',
    '🔍 Wir haben {user} gefunden. Keine Ahnung, wo.',
    '🌙 Etwas bewegt sich im Nebel… ach, nur {user}.',
    '🌌 {user} ist aus irgendeinem Portal hier gelandet.'
];

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
