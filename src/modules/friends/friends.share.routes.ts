import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import { normalizeFriendCode } from '../../core/friends.js';
import { friendsRepository } from './friends.repository.js';

/**
 * Page de partage publique d'un code ami, ouverte quand quelqu'un clique un
 * lien `…/f/CODE` (depuis un navigateur, hors app). Elle renvoie vers le
 * deep link `tarteel://add?code=CODE` qui ouvre l'app sur l'écran d'ajout.
 * Ne requiert pas d'auth ; masquée (404) si la fonctionnalité amis est off.
 */

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function page(opts: { title: string; heading: string; body: string; deepLink?: string; code?: string }): string {
  const { title, heading, body, deepLink, code } = opts;
  const redirect = deepLink
    ? `<script>setTimeout(function(){location.href=${JSON.stringify(deepLink)};}, 300);</script>`
    : '';
  const cta = deepLink
    ? `<a class="cta" href="${escapeHtml(deepLink)}">Ouvrir Tarteel</a>`
    : '';
  const codeBlock = code ? `<div class="code">${escapeHtml(code)}</div>` : '';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="Rejoins-moi sur Tarteel, apprends le Coran en t'amusant." />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center;
    justify-content: center; min-height: 100vh; margin: 0; background: #F4F5F9; color: #1B2333; text-align: center; }
  main { padding: 28px; max-width: 420px; }
  .emoji { font-size: 44px; }
  h1 { font-size: 22px; margin: 8px 0; }
  p { color: #6B7078; }
  .code { font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #6B4DFF;
    margin: 18px 0; background: #fff; border-radius: 16px; padding: 16px; }
  .cta { display: inline-block; margin-top: 10px; background: #6B4DFF; color: #fff;
    text-decoration: none; font-weight: 700; padding: 14px 28px; border-radius: 14px; }
</style>
</head>
<body>
<main>
  <div class="emoji">🤝</div>
  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(body)}</p>
  ${codeBlock}
  ${cta}
</main>
${redirect}
</body>
</html>`;
}

function sendHtml(reply: FastifyReply, status: number, html: string) {
  return reply.status(status).type('text/html; charset=utf-8').send(html);
}

export async function friendsShareRoutes(app: FastifyInstance) {
  app.get(
    '/:code',
    { schema: { tags: ['friends'], summary: 'Page de partage publique (redirige vers l\'app)' } },
    async (req, reply) => {
      if (!env.FRIENDS_ENABLED) {
        return sendHtml(reply, 404, page({ title: 'Introuvable', heading: 'Page introuvable', body: '' }));
      }
      const raw = (req.params as { code: string }).code ?? '';
      const code = normalizeFriendCode(raw);
      const deepLink = `tarteel://add?code=${encodeURIComponent(code)}`;

      if (!CODE_RE.test(code)) {
        return sendHtml(reply, 400, page({
          title: 'Code invalide',
          heading: 'Code invalide',
          body: 'Ce lien de partage ne semble pas valide.',
          code,
        }));
      }

      const owner = await friendsRepository.findCodeOwner(code);
      if (!owner) {
        return sendHtml(reply, 404, page({
          title: 'Code inconnu',
          heading: 'Code inconnu',
          body: 'Ce code ami n\'existe plus.',
          code,
        }));
      }

      return sendHtml(reply, 200, page({
        title: 'Ajoute-moi sur Tarteel',
        heading: 'Ajoute-moi sur Tarteel',
        body: 'Ouvre l\'app pour devenir mon ami, ou partage ce code :',
        deepLink,
        code,
      }));
    },
  );
}
