import { AppError } from '../../core/errors.js';
import { MAX_HEARTS } from '../../core/hearts.js';
import { adminUsersRepository } from './adminUsers.repository.js';
import { serializeAdminUser } from './adminUsers.serializer.js';
import type { ListUsersQuery } from './adminUsers.schemas.js';

export const adminUsersService = {
  async list(query: ListUsersQuery) {
    const { rows, total } = await adminUsersRepository.list(query.q, query.status, query.page, query.pageSize);
    return {
      users: rows.map((r) => serializeAdminUser(r)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    };
  },

  async ban(userId: string, reason: string | undefined) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const now = new Date();
    const updated = await adminUsersRepository.ban(userId, reason, now);
    // A ban must also kill any session the user is currently using.
    await adminUsersRepository.revokeAllSessions(userId, now);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async unban(userId: string) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const updated = await adminUsersRepository.unban(userId);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async grantHearts(userId: string, amount: number) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const newHearts = Math.min(MAX_HEARTS, user.hearts + amount);
    const updated = await adminUsersRepository.grantHearts(userId, newHearts);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async grantGems(userId: string, amount: number) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const updated = await adminUsersRepository.grantGems(userId, amount);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async grantPremium(userId: string, durationDays: number | 'lifetime') {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    let premiumUntil: Date | null = null;
    if (durationDays !== 'lifetime') {
      premiumUntil = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    }
    const updated = await adminUsersRepository.grantPremium(userId, premiumUntil);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },
};
