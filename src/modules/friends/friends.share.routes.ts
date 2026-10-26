import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { friendsConfigGate } from './friends.gate.js';
import { friendsRepository } from './friends.repository.js';
import { userRepository } from '../me/user.repository.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Page publique /f/:token (aucune authentification).
 * Affiche "Rejoins-moi sur Tarteel" avec le nom de l'invitant et les liens stores.
 * Toute valeur dynamique est échappée (sécurité XSS).
 */
export async function friendsShareRoutes(app: FastifyInstance) {
  app.addHook('preHandler', friendsConfigGate);
  app.get('/:token', async (req, reply) => {
    const token = String((req.params as { token?: string })?.token ?? '').trim();
    const invite = token ? await friendsRepository.findInviteByTokenHash(hashToken(token)) : null;
    const now = new Date();

    let owner: Awaited<ReturnType<typeof userRepository.getOrThrow>> | null = null;
    let kind: string | null = null;
    let invalidReason: 'expired' | 'invalid' = 'invalid';
    let isValid = false;

    if (invite && !invite.revokedAt) {
      if (invite.expiresAt.getTime() <= now.getTime() || invite.uses >= invite.maxUses) {
        invalidReason = 'expired';
      } else {
        try {
          const u = await userRepository.getOrThrow(invite.userId);
          if (u.bannedAt) {
            invalidReason = 'invalid';
          } else if (invite.kind === 'link' && !u.friendsDiscoverable) {
            invalidReason = 'invalid';
          } else {
            owner = u;
            kind = invite.kind;
            isValid = true;
          }
        } catch {
          invalidReason = 'invalid';
        }
      }
    }

    const base = env.PUBLIC_WEB_URL.replace(/\/+$/, '');
    const title = 'Rejoins-moi sur Tarteel';
    const ogImage = `${base}/og-image.png`;

    let bodyHtml: string;
    if (isValid && owner) {
      const displayName = escapeHtml(owner.displayName);
      const initials = escapeHtml(owner.avatarInitials);
      bodyHtml = `
        <div class="card">
          <div class="avatar">${initials}</div>
          <h1>${title}</h1>
          <p class="subtitle">${displayName} t'invite à rejoindre Tarteel.</p>
          <div class="stores">
            <a class="btn" href="https://apps.apple.com" rel="noopener noreferrer">App Store</a>
            <a class="btn" href="https://play.google.com/store" rel="noopener noreferrer">Google Play</a>
          </div>
          <p class="hint">Ouvre le lien dans l’app si elle est installée.</p>
        </div>
      `;
    } else {
      const message =
        invalidReason === 'expired'
          ? 'Ce lien a expiré ou a atteint sa limite d’utilisation.'
          : 'Lien invalide.';
      bodyHtml = `
        <div class="card">
          <h1>${title}</h1>
          <p class="subtitle">${escapeHtml(message)}</p>
        </div>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="Rejoins Tarteel et apprends le Coran." />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:type" content="website" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;700&family=Nunito:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    body { margin:0; font-family:'Nunito',sans-serif; background:#f7f3ee; color:#1f2937; display:flex; min-height:100vh; align-items:center; justify-content:center; }
    .card { background:#fff; border-radius:20px; padding:40px 32px; max-width:420px; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,.08); }
    h1 { font-family:'Baloo 2',cursive; font-size:28px; margin:0 0 8px; }
    .subtitle { margin:0 0 24px; color:#4b5563; }
    .avatar { width:64px; height:64px; border-radius:50%; background:#10b981; color:#fff; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:700; margin:0 auto 16px; }
    .stores { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
    .btn { display:inline-block; padding:12px 20px; border-radius:12px; background:#10b981; color:#fff; text-decoration:none; font-weight:700; }
    .hint { font-size:12px; color:#6b7280; margin-top:16px; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;

    reply.type('text/html; charset=utf-8');
    return reply.send(html);
  });
}
