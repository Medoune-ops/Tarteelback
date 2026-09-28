/**
 * Messages de rappel — textes fournis par l'utilisateur, repris À L'IDENTIQUE,
 * tous, sans aucune modification. Un message est tiré au hasard à chaque envoi
 * pour ne jamais se répéter.
 *
 * NE PAS reformuler/raccourcir/éditer ces textes.
 */

import { env } from '../../config/env.js';

export interface ReminderMessage {
  /** Titre court de la notification. */
  title: string;
  /** Corps = le message exact fourni par l'utilisateur. */
  body: string;
}

/** Le titre affiché en tête de chaque notification de rappel.
 *  Format demandé : titre « Tarteel » (sans emoji) + le message complet dans le
 *  corps. */
export const REMINDER_TITLE = 'Tarteel';

/**
 * Tous les messages, mot pour mot, dans l'ordre fourni. Aucune édition.
 */
export const REMINDER_MESSAGES: string[] = [
  "Tu as le temps de scroller des heures, mais pas 5 minutes pour réciter.",
  "Tu recharges ton téléphone chaque nuit, mais ton âme attend depuis des jours.",
  "“Demain je commence” — c’est ce que tu dis depuis des années.",
  "Tu attends d’être prêt. Le Coran t’attend, lui.",
  "Chaque sourate que tu repousses, c’est une lumière que tu éteins toi-même.",
  "Tu mémorises des paroles de chansons, mais le Coran “c’est trop difficile”.",
  "L’excuse du manque de temps ne tient pas face à celui qui voit tout.",
  "Tu es occupé Mais pour combien de temps encore ?",
  "La dunya ne te rendra jamais ce que le Coran peut te donner.",
  "Ta mémoire fonctionne parfaitement. Tu choisis juste quoi y mettre.",
  "4 heures d’écran par jour. 0 minute pour le coran.",
  "Tu consultes ton téléphone 100 fois par jour. Le Coran attend sa première.",
  "Chaque notification reçoit ta réponse. Allah attend la sienne.",
  "Tu vieillis. Chaque jour sans le Coran est un jour perdu pour toujours.",
  "Le Ramadan revient chaque année. Toi, peut-être pas.",
  "Tu remets à demain ce que la mort peut prendre ce soir.",
  "Tu te dis musulman, mais le Livre de l’Islam te connaît à peine.",
  "Le Coran ne te manque pas. C’est toi qui lui manques.",
  "Pas le temps ? Ou pas la priorité ?",
  "Occupé pour Allah. Disponible pour tout le monde.",
  "Ton enfant te demandera un jour de lui lire le Coran. Tu sauras quoi répondre ?",
  "2h sur ton téléphone. Pas 10 minutes pour Allah.",
  "Tu écoutes tout le monde. Écoute-Le, Lui.",
  "Des enfants de 7 ans mémorisent. Toi tu attends quoi ?",
  "Tu cherches la paix partout. Elle est dans ce Livre que tu n’ouvres pas.",
  "Tu te sens vide parfois. Tu sais pourquoi.",
  "Un verset par jour change une vie.",
  "Le regret de l’Akhira n’a pas de remède.",
  "Tu consommes sans fin parce que rien ne te rassasie. Tu cherches au mauvais endroit.",
  "Tu cherches qui tu es. Le Coran te le dit dès la première page.",
  "Tu lis des livres de développement personnel. Le premier self-help c’est le Coran.",
  "Tu mérites la paix. Mais tu fuis ce qui la donne.",
  "La tranquillité que tu achètes ne dure pas. Celle du Coran, si.",
  "Un verset suffit parfois à calmer ce que rien d’autre n’a pu.",
  "Perdu dans la vie ? Le Coran est le seul GPS qui ne recalcule jamais dans le mauvais sens.",
  "La douleur que tu noies dans le bruit — le Coran peut la guérir en silence.",
  "Revenir au Coran, c’est revenir à toi.",
  "Tu portes des choses lourdes. Le Coran n’est pas un poids de plus — c’est ce qui allège.",
  "Ce que les gens t’ont fait, Allah l’a vu. Il t’a laissé un Livre pour t’en relever.",
  "Tu peux être entouré de monde et mourir de solitude. Le Coran, lui, ne part jamais.",
  "Tu es épuisé de courir après ce monde. Pose-toi. Ouvre le Livre.",
  "La fatigue de l’âme ne se guérit pas avec du sommeil. Tu le sais déjà.",
  "Tu t’es construit une identité entière sans le Coran dedans. Quelque chose cloche, non ?",
  "Tu portes un prénom musulman, une histoire musulmane, un héritage musulman. Et le Livre de cet héritage te connaît à peine.",
  "Il y a des douleurs que la psychologie ne peut pas atteindre. Le Coran, si.",
  "Tu as tout essayé pour aller mieux. Tout sauf l’essentiel.",
  "La guérison que tu cherches depuis des années commence par Bismillah.",
  "Tu veux être aimé inconditionnellement. Cet amour existe. Il t’attend dans chaque verset.",
  "Tu cherches quelqu’un qui te comprend vraiment. Allah te connaît mieux que tu ne te connais.",
  "Le Coran n’a pas été révélé pour les anges. Il a été révélé pour toi.",
  "Le Coran ne te juge pas pour ton absence. Il se réjouit de ton retour.",
  "Revenir après longtemps, c’est peut-être la plus belle forme d’amour qu’on puisse offrir à Allah.",
  "Tu n’as pas à être parfait pour ouvrir ce Livre. Tu as juste à ouvrir ce Livre.",
  "Tu n’as pas à expliquer ton absence. Ouvre juste le Livre.",
  "Peu importe combien de temps tu es parti. La porte n’a pas de verrou.",
  "Le Coran ne te demande pas où tu étais. Il te demande juste d’être là maintenant.",
  "Qu’est-ce que tu vas transmettre à tes enfants si toi-même tu n’as rien reçu du coran?",
  "Tes parents ont porté cette religion jusqu’à toi. Tu la poses là ?",
  "Un verset. Juste un. Ce soir.",
  "Tu n’as pas besoin d’un plan. Tu as besoin d’une sourate.",
];

/**
 * Traduction anglaise des messages ci-dessus, dans le MÊME ordre (même index =
 * même message), pour les comptes dont la langue n'est pas le français. Les
 * textes français restent la source : on ne les modifie pas.
 */
export const REMINDER_MESSAGES_EN: string[] = [
  "You have hours to scroll, but not 5 minutes to recite.",
  "You charge your phone every night, but your soul has been waiting for days.",
  "“I’ll start tomorrow” — that’s what you’ve been saying for years.",
  "You’re waiting to be ready. The Quran is waiting for you.",
  "Every surah you put off is a light you switch off yourself.",
  "You memorise song lyrics, but the Quran is “too hard”.",
  "The “no time” excuse doesn’t hold up before the One who sees everything.",
  "You’re busy. But for how much longer?",
  "The dunya will never give you what the Quran can.",
  "Your memory works perfectly. You just choose what to put in it.",
  "4 hours of screen time a day. 0 minutes for the Quran.",
  "You check your phone 100 times a day. The Quran is still waiting for its first.",
  "Every notification gets your reply. Allah is still waiting for His.",
  "You’re getting older. Every day without the Quran is a day lost forever.",
  "Ramadan comes back every year. You might not.",
  "You put off until tomorrow what death could take tonight.",
  "You call yourself a Muslim, but the Book of Islam barely knows you.",
  "The Quran doesn’t miss you. You’re the one missing it.",
  "No time? Or not a priority?",
  "Busy for Allah. Available for everyone else.",
  "One day your child will ask you to read them the Quran. Will you know what to say?",
  "2 hours on your phone. Not 10 minutes for Allah.",
  "You listen to everyone. Listen to Him.",
  "7-year-olds are memorising. What are you waiting for?",
  "You look for peace everywhere. It’s in the Book you never open.",
  "Sometimes you feel empty. You know why.",
  "One verse a day changes a life.",
  "Regret in the Akhirah has no cure.",
  "You keep consuming because nothing fills you. You’re looking in the wrong place.",
  "You’re searching for who you are. The Quran tells you from the very first page.",
  "You read self-help books. The first self-help is the Quran.",
  "You deserve peace. But you run from what gives it.",
  "The calm you buy doesn’t last. The Quran’s does.",
  "Sometimes one verse is enough to soothe what nothing else could.",
  "Lost in life? The Quran is the only GPS that never reroutes the wrong way.",
  "The pain you drown in noise — the Quran can heal it in silence.",
  "Coming back to the Quran is coming back to yourself.",
  "You’re carrying heavy things. The Quran isn’t one more weight — it’s what lightens the load.",
  "What people did to you, Allah saw. He left you a Book to rise from it.",
  "You can be surrounded by people and die of loneliness. The Quran never leaves.",
  "You’re exhausted from chasing this world. Stop. Open the Book.",
  "Tiredness of the soul isn’t cured by sleep. You already know that.",
  "You built a whole identity without the Quran in it. Something’s off, isn’t it?",
  "You carry a Muslim name, a Muslim story, a Muslim heritage. And the Book of that heritage barely knows you.",
  "Some pain is beyond the reach of psychology. Not beyond the Quran.",
  "You’ve tried everything to feel better. Everything except what matters most.",
  "The healing you’ve been looking for for years starts with Bismillah.",
  "You want to be loved unconditionally. That love exists. It’s waiting for you in every verse.",
  "You’re looking for someone who truly understands you. Allah knows you better than you know yourself.",
  "The Quran wasn’t revealed for the angels. It was revealed for you.",
  "The Quran doesn’t judge you for being away. It rejoices at your return.",
  "Coming back after a long time may be the most beautiful kind of love you can offer Allah.",
  "You don’t have to be perfect to open this Book. You just have to open this Book.",
  "You don’t have to explain where you’ve been. Just open the Book.",
  "No matter how long you’ve been gone, the door has no lock.",
  "The Quran doesn’t ask where you were. It only asks you to be here now.",
  "What will you pass on to your children if you received nothing from the Quran yourself?",
  "Your parents carried this faith all the way to you. Are you going to set it down?",
  "One verse. Just one. Tonight.",
  "You don’t need a plan. You need a surah.",
];

/** Messages par langue ; toute autre langue retombe sur DEFAULT_LANG. */
const MESSAGES_BY_LANG: Record<string, string[]> = { fr: REMINDER_MESSAGES, en: REMINDER_MESSAGES_EN };

/** Pick a (deterministic-testable) random message. */
function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** A reminder in the user's language (`user.language`, e.g. "fr", "en",
 *  "fr-FR"): a random message from the list, verbatim. */
export function dailyReminder(lang: string, rng: () => number = Math.random): ReminderMessage {
  const code = lang.slice(0, 2).toLowerCase();
  const messages = MESSAGES_BY_LANG[code] ?? MESSAGES_BY_LANG[env.DEFAULT_LANG] ?? REMINDER_MESSAGES_EN;
  return { title: REMINDER_TITLE, body: pick(messages, rng) };
}
