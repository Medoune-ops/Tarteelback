import type { FastifyInstance } from 'fastify';
import { audioController } from './audio.controller.js';

/**
 * Fichiers audio transcodés pour l'écoute hors-ligne (mode Tajwid). Public,
 * pas d'auth — même logique que content.routes.ts (contenu déjà public dans
 * l'app). Le client (app mobile) télécharge ces fichiers une fois via
 * expo-file-system et les rejoue localement, voir constants/audioDownload.ts
 * côté front.
 */
export async function audioRoutes(app: FastifyInstance) {
  app.get(
    '/sudais/manifest',
    { schema: { tags: ['audio'], summary: 'Manifest des 114 fichiers Sudais (64kbps) pour le mode hors-ligne' } },
    audioController.manifest,
  );

  app.get(
    '/sudais/:numero',
    { schema: { tags: ['audio'], summary: 'Fichier audio Sudais (64kbps) par numéro de sourate (1-114)' } },
    audioController.file,
  );
}
