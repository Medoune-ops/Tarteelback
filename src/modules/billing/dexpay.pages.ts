import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Pages HTML minimales pour success_url/failure_url — presque jamais
 * visitées en mode popup SDK (le popup se ferme via postMessage/onSuccess
 * sans navigation), mais DexPay peut y rediriger en repli (`mobile:
 * 'redirect'`, ou navigateur sans JS). Ne créditent RIEN : la seule source
 * de vérité reste le webhook (dexpay.webhook.ts).
 */

function page(title: string, message: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center;
    justify-content: center; min-height: 100vh; margin: 0; background: #F4F5F9; color: #1B2333; }
  main { text-align: center; padding: 24px; }
  h1 { font-size: 20px; }
  p { color: #6B7078; }
</style>
</head>
<body>
<main><h1>${title}</h1><p>${message}</p></main>
</body>
</html>`;
}

function sendHtml(reply: FastifyReply, html: string) {
  return reply.type('text/html; charset=utf-8').send(html);
}

export async function dexpayPagesRoutes(app: FastifyInstance) {
  app.get('/dexpay/success', { schema: { tags: ['billing'], summary: 'Page de repli après paiement (redirection mobile)' } }, (_req, reply) =>
    sendHtml(reply, page('Paiement réussi', 'Vous pouvez fermer cette fenêtre et revenir sur Tarteel.')));

  app.get('/dexpay/failure', { schema: { tags: ['billing'], summary: 'Page de repli après échec/annulation du paiement' } }, (_req, reply) =>
    sendHtml(reply, page('Paiement non abouti', 'Le paiement a échoué ou a été annulé. Vous pouvez réessayer depuis Tarteel.')));
}
