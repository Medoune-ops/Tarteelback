import type { FastifyInstance } from 'fastify';
import { authRoutes } from './modules/auth/auth.routes.js';
import { meRoutes } from './modules/me/me.routes.js';
import { contentRoutes } from './modules/content/content.routes.js';
import { adminRoutes } from './modules/content/admin.routes.js';
import { lessonRoutes, lessonFlatRoutes } from './modules/lessons/lesson.routes.js';
import { leagueRoutes } from './modules/leagues/league.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { dexpayWebhookRoutes } from './modules/billing/dexpay.webhook.js';
import { dexpayPagesRoutes } from './modules/billing/dexpay.pages.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { rewardRoutes } from './modules/rewards/reward.routes.js';
import { gemRoutes } from './modules/gems/gem.routes.js';
import { revisionRoutes } from './modules/revision/revision.routes.js';
import { referralRoutes } from './modules/referral/referral.routes.js';
import { householdRoutes } from './modules/household/household.routes.js';
import { supportRoutes } from './modules/support/support.routes.js';
import { adminAuthRoutes } from './modules/adminAuth/adminAuth.routes.js';
import { adminUsersRoutes } from './modules/adminUsers/adminUsers.routes.js';
import { adminContentRoutes } from './modules/adminContent/adminContent.routes.js';
import { adminMonetisationRoutes } from './modules/adminMonetisation/adminMonetisation.routes.js';
import { adminAnalyticsRoutes } from './modules/adminAnalytics/adminAnalytics.routes.js';
import { adminGiftsRoutes } from './modules/adminGifts/adminGifts.routes.js';
import { adminSupportRoutes } from './modules/adminSupport/adminSupport.routes.js';
import { adminConfigRoutes } from './modules/adminConfig/adminConfig.routes.js';
import { publicConfigRoutes } from './modules/adminConfig/publicConfig.routes.js';

/** Mounts every feature module. */
export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(contentRoutes); // /sections, /sourates, /lessons (GET)
  // Réglages produit globaux (lecture publique, pas d'auth) — l'app les lit
  // au démarrage pour savoir si l'UI de paiement doit rester masquée.
  await app.register(publicConfigRoutes);
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(lessonRoutes, { prefix: '/lessons' });
  await app.register(lessonFlatRoutes, { prefix: '/lesson' });
  await app.register(leagueRoutes, { prefix: '/leagues' });
  await app.register(billingRoutes, { prefix: '/billing' });
  // Webhook DexPay — PAS de Bearer token (signature HMAC vérifiée à la place),
  // monté séparément de billingRoutes pour ne pas hériter de son hook `authenticate`.
  await app.register(dexpayWebhookRoutes, { prefix: '/billing' });
  // Pages HTML de repli success_url/failure_url — publiques, jamais authentifiées.
  await app.register(dexpayPagesRoutes, { prefix: '/billing' });
  await app.register(notificationRoutes, { prefix: '/me/notifications' });
  // Rewards mounted under /me so the front's GET /me/podiums etc. line up.
  await app.register(rewardRoutes, { prefix: '/me' });
  // Gem economy (balance, heart refill, streak freezes, double XP, review gate).
  await app.register(gemRoutes, { prefix: '/me' });
  // SRS des sourates apprises (score, prochaine révision).
  await app.register(revisionRoutes, { prefix: '/me' });
  // Parrainage (code de partage + redeem → cœurs bonus).
  await app.register(referralRoutes, { prefix: '/me' });
  // Plan familial (foyer : owner + jusqu'à 5 membres, premium partagé).
  await app.register(householdRoutes, { prefix: '/me' });
  // Support (Paramètres → Support) : message texte libre, visible en back-office.
  await app.register(supportRoutes, { prefix: '/me' });
  // Back-office web admin panel: separate population/auth from mobile `/auth`
  // and from `/admin` (which is mobile-app content management) — see
  // plugins/adminAuth.ts for why the JWT is fully isolated.
  await app.register(adminAuthRoutes, { prefix: '/backoffice/auth' });
  // User moderation & grants (list/search, ban, grant hearts/gems/premium).
  await app.register(adminUsersRoutes, { prefix: '/backoffice/users' });
  // Content overview: sections with lesson/completion stats, publish toggle.
  await app.register(adminContentRoutes, { prefix: '/backoffice/content' });
  // Monetization: premium/MRR/ARPU KPIs and the transaction ledger.
  await app.register(adminMonetisationRoutes, { prefix: '/backoffice/monetisation' });
  // Analytics: signups/DAU/WAU/streak/rétention KPIs + signups timeseries.
  await app.register(adminAnalyticsRoutes, { prefix: '/backoffice/analytics' });
  // Bulk gifting: grant hearts/gems/premium to a segment or a list of users at once.
  await app.register(adminGiftsRoutes, { prefix: '/backoffice/gifts' });
  // Messages support (réclamations/suggestions) envoyés depuis Paramètres → Support.
  await app.register(adminSupportRoutes, { prefix: '/backoffice/support' });
  // Réglages produit globaux (ex: masquer les paiements sans redéploiement).
  await app.register(adminConfigRoutes, { prefix: '/backoffice/config' });
}
