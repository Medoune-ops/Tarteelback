import { adminUsersService } from '../adminUsers/adminUsers.service.js';
import { adminGiftsRepository } from './adminGifts.repository.js';
import type { BulkGrantInput } from './adminGifts.schemas.js';

const CONCURRENCY = 10;

/** Runs `fn` over `items` with at most `limit` in flight, collecting per-item outcomes. */
async function runBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor++;
      if (item === undefined) continue;
      try {
        await fn(item);
        succeeded++;
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { succeeded, failed };
}

export const adminGiftsService = {
  /**
   * Grants the same gift (hearts/gems/premium) to every user in a segment or
   * an explicit id list, reusing adminUsersService's per-user grant logic
   * (heart cap, gem ledger, PendingGift + push notification) so a bulk grant
   * behaves identically to N individual grants from the user's fiche.
   */
  async bulkGrant(input: BulkGrantInput) {
    const userIds = 'segment' in input.target
      ? await adminGiftsRepository.idsForSegment(input.target.segment)
      : await adminGiftsRepository.existingIds(input.target.userIds);

    const grantOne = async (userId: string) => {
      if (input.gift.kind === 'hearts') {
        await adminUsersService.grantHearts(userId, input.gift.amount);
      } else if (input.gift.kind === 'gems') {
        await adminUsersService.grantGems(userId, input.gift.amount);
      } else {
        await adminUsersService.grantPremium(userId, input.gift.durationDays);
      }
    };

    const { succeeded, failed } = await runBounded(userIds, CONCURRENCY, grantOne);
    return { targeted: userIds.length, succeeded, failed };
  },
};
