import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';

/** Shared user data access, used by several modules. */
export const userRepository = {
  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  /** Fetch or throw NOT_FOUND — handy in authed flows where the user must exist. */
  async getOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    return user;
  },

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },
};
