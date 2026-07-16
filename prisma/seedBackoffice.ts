/**
 * Seed the very first back-office owner account. There is no self-signup and
 * no "promote to owner" API endpoint by design (see schema.prisma's
 * AdminUser doc comment) — this script is the only way to create one.
 *
 * Credentials are read from the environment, never hardcoded here (this file
 * is committed to the repo): set OWNER_EMAIL / OWNER_NAME / OWNER_PASSWORD in
 * your local .env (not .env.example — keep real secrets out of that file)
 * before running `npm run seed:backoffice`.
 *
 * Idempotent: re-running it updates the existing owner's name/password rather
 * than creating a duplicate (upsert on the unique email).
 */
import 'dotenv/config';
import { PrismaClient, AdminModule } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD in your .env before running this script.`,
    );
  }
  return value;
}

async function main() {
  const ownerEmail = requireEnv('OWNER_EMAIL').toLowerCase();
  const ownerName = requireEnv('OWNER_NAME');
  const ownerPassword = requireEnv('OWNER_PASSWORD');
  if (ownerPassword.length < 8) {
    throw new Error('OWNER_PASSWORD must be at least 8 characters.');
  }

  const passwordHash = await argon2.hash(ownerPassword, { type: argon2.argon2id });

  const owner = await prisma.adminUser.upsert({
    where: { email: ownerEmail },
    update: { displayName: ownerName, passwordHash, isOwner: true, disabledAt: null },
    create: {
      email: ownerEmail,
      displayName: ownerName,
      passwordHash,
      isOwner: true,
    },
  });

  // The owner implicitly has full access everywhere in the UI (see
  // plugins/adminAuth.ts requireAdminOwner + the front's "Accès total"
  // badge) — these rows exist mainly so /backoffice/auth/team returns a
  // complete, consistent picture rather than an owner with no permission rows.
  await prisma.adminPermission.deleteMany({ where: { adminUserId: owner.id } });
  await prisma.adminPermission.createMany({
    data: Object.values(AdminModule).map((module) => ({
      adminUserId: owner.id,
      module,
      canView: true,
      canEdit: true,
    })),
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Back-office owner ready: ${ownerEmail} (${owner.id})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
