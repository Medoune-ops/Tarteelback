/**
 * Messages de rappel — textes fournis par l'utilisateur, repris À L'IDENTIQUE,
 * tous, sans aucune modification. Un message est tiré au hasard à chaque envoi
 * pour ne jamais se répéter.
 *
 * NE PAS reformuler/raccourcir/éditer ces textes.
 */

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

/** Pick a (deterministic-testable) random message. */
function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** A daily reminder: a random message from the user's list, verbatim. */
export function dailyReminder(rng: () => number = Math.random): ReminderMessage {
  return { title: REMINDER_TITLE, body: pick(REMINDER_MESSAGES, rng) };
}
