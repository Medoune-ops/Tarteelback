/**
 * Configuration de l'API backend.
 *
 * L'URL de base est lue depuis la variable d'environnement Expo
 * `EXPO_PUBLIC_API_URL` (exposée au bundle car préfixée `EXPO_PUBLIC_`).
 * En dev, définir dans un fichier `.env` à la racine du front :
 *
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
 *
 * ⚠️ Sur un appareil physique, `localhost` pointe vers le téléphone, pas vers
 * ta machine : utilise l'IP LAN de l'ordinateur (ou un tunnel ngrok).
 * Le simulateur iOS accepte `http://localhost:3000` ; l'émulateur Android
 * utilise `http://10.0.2.2:3000`.
 */

/** URL de base du backend, sans slash final. */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

/** Durée (ms) avant d'abandonner une requête réseau. */
export const API_TIMEOUT_MS = 15_000;
