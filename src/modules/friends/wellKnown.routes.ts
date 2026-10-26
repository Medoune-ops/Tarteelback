import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

/**
 * Fichiers d'association app ↔ domaine, pour qu'un lien ou un QR d'invitation
 * (`<PUBLIC_WEB_URL>/f/<jeton>`) ouvre l'app directement quand elle est
 * installée, au lieu de la page web.
 *
 *  - iOS : /.well-known/apple-app-site-association (universal links)
 *  - Android : /.well-known/assetlinks.json (App Links vérifiés)
 *
 * Ces fichiers doivent être servis sur le domaine de PUBLIC_WEB_URL, en HTTPS,
 * sans redirection. L'app doit déclarer ce domaine (app.json :
 * ios.associatedDomains et android.intentFilters avec autoVerify).
 */
export async function wellKnownRoutes(app: FastifyInstance) {
  const sec = { tags: ['friends'] as const };

  app.get('/.well-known/apple-app-site-association', { schema: { ...sec, summary: 'Universal links iOS' } }, async (_req, reply) => {
    if (!env.APPLE_TEAM_ID) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not configured' } });
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, max-age=3600')
      .send({
        applinks: {
          apps: [],
          details: [
            {
              appIDs: [`${env.APPLE_TEAM_ID}.${env.IOS_BUNDLE_ID}`],
              components: [{ '/': '/f/*', comment: 'Invitation entre amis' }],
              // Ancien format, encore lu par iOS 12 et moins.
              appID: `${env.APPLE_TEAM_ID}.${env.IOS_BUNDLE_ID}`,
              paths: ['/f/*'],
            },
          ],
        },
      });
  });

  app.get('/.well-known/assetlinks.json', { schema: { ...sec, summary: 'App Links Android' } }, async (_req, reply) => {
    if (env.ANDROID_SHA256_FINGERPRINTS.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not configured' } });
    }
    return reply
      .header('content-type', 'application/json')
      .header('cache-control', 'public, max-age=3600')
      .send([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: env.ANDROID_PACKAGE,
            sha256_cert_fingerprints: env.ANDROID_SHA256_FINGERPRINTS,
          },
        },
      ]);
  });
}
