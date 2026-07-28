import type { FastifyInstance, FastifyReply } from 'fastify';
import { termsFr, privacyFr, termsEn, privacyEn } from './legal.content.js';

/**
 * Pages publiques CGU / politique de confidentialité (FR + EN), servies en
 * HTML statique pour être liées depuis l'app mobile (privacy.tsx) et les
 * stores. Pas de paiement mentionné tant que ce n'est pas disponible sur les
 * stores — voir legal.content.ts pour le détail de cette contrainte.
 */

function page(lang: 'fr' | 'en', title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Tarteel</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto;
    padding: 32px 20px 64px; background: #F4F5F9; color: #1B2333; line-height: 1.6; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 28px; }
  p, li { font-size: 15px; color: #333; }
  .meta { color: #8A8F99; font-size: 13px; margin-top: 0; }
  ul { padding-left: 20px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function sendHtml(reply: FastifyReply, html: string) {
  return reply.type('text/html; charset=utf-8').send(html);
}

export async function legalRoutes(app: FastifyInstance) {
  app.get('/terms', { schema: { tags: ['legal'], summary: 'Conditions d\'utilisation (FR)' } }, (_req, reply) =>
    sendHtml(reply, page('fr', 'Conditions d\'utilisation', termsFr)));

  app.get('/privacy', { schema: { tags: ['legal'], summary: 'Politique de confidentialité (FR)' } }, (_req, reply) =>
    sendHtml(reply, page('fr', 'Politique de confidentialité', privacyFr)));

  app.get('/terms/en', { schema: { tags: ['legal'], summary: 'Terms of use (EN)' } }, (_req, reply) =>
    sendHtml(reply, page('en', 'Terms of Use', termsEn)));

  app.get('/privacy/en', { schema: { tags: ['legal'], summary: 'Privacy policy (EN)' } }, (_req, reply) =>
    sendHtml(reply, page('en', 'Privacy Policy', privacyEn)));
}
